const pool = require('../config/db');
const {fields} = require('../utils/customerHistory');
const quote = value => '`'+value.replace(/`/g,'``')+'`';
async function migrate() {
 const conn=await pool.getConnection();
 try {
  const [customerColumns]=await conn.query('SHOW COLUMNS FROM Customer');
  for(const name of ['FirstName','LastName']) if(!customerColumns.some(c=>c.Field===name)) await conn.query(`ALTER TABLE Customer ADD COLUMN ${name} VARCHAR(75) NULL`);
  if(!customerColumns.some(c=>c.Field==='CompanyName')) await conn.query('ALTER TABLE Customer ADD COLUMN CompanyName VARCHAR(150) NULL');
  await conn.query(`UPDATE Customer SET FirstName=COALESCE(FirstName,SUBSTRING_INDEX(CustomerName,' ',1)), LastName=COALESCE(LastName,CASE WHEN LOCATE(' ',CustomerName)>0 THEN SUBSTRING(CustomerName,LOCATE(' ',CustomerName)+1) ELSE '' END)`);
  const [checks]=await conn.query("SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND LOWER(TABLE_NAME)='customer' AND CONSTRAINT_NAME='customer_type_valid'");
  if(!checks.length) await conn.query("ALTER TABLE Customer ADD CONSTRAINT customer_type_valid CHECK (CustomerType IN ('Residential','Commercial'))");
  const types=['VARCHAR(20)','VARCHAR(150)','VARCHAR(30)','VARCHAR(255)','VARCHAR(20)'];
  for(const table of ['Order','Sales','Payment','Delivery']) {
   const [columns]=await conn.query(`SHOW COLUMNS FROM ${quote(table)}`);
   for(let i=0;i<fields.length;i++) if(!columns.some(c=>c.Field===fields[i])) await conn.query(`ALTER TABLE ${quote(table)} ADD COLUMN ${fields[i]} ${types[i]} NULL`);
  }
  for(const table of ['Order','Sales']) await conn.query(`UPDATE ${quote(table)} t JOIN Customer c ON c.CustomerID=t.CustomerID SET t.historical_customer_id=COALESCE(t.historical_customer_id,c.CustomerID),t.customer_name=COALESCE(t.customer_name,c.CustomerName),t.contact_number=COALESCE(t.contact_number,c.ContactNo),t.address=COALESCE(t.address,c.Address),t.customer_type=COALESCE(t.customer_type,c.CustomerType)`);
  for(const table of ['Payment','Delivery']) await conn.query(`UPDATE ${quote(table)} t JOIN Sales s ON s.SaleID=t.SaleID SET ${fields.map(f=>`t.${f}=COALESCE(t.${f},s.${f})`).join(',')}`);
  // Remove any cascade rules before permitting nullable customer references.
  const [fks]=await conn.query("SELECT TABLE_NAME,COLUMN_NAME,CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE REFERENCED_TABLE_SCHEMA=DATABASE() AND REFERENCED_TABLE_NAME='Customer'");
  for(const fk of fks) {
   const [rules]=await conn.query("SELECT DELETE_RULE FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND CONSTRAINT_NAME=:name",{name:fk.CONSTRAINT_NAME});
   const [columns]=await conn.query(`SHOW COLUMNS FROM ${quote(fk.TABLE_NAME)} LIKE 'CustomerID'`);
   if (rules[0]?.DELETE_RULE==='RESTRICT' && columns[0]?.Null==='YES') continue;
   if(!['order','sales'].includes(fk.TABLE_NAME.toLowerCase()) || fk.COLUMN_NAME!=='CustomerID') throw new Error(`Unexpected customer reference: ${fk.TABLE_NAME}.${fk.COLUMN_NAME}; review before enabling deletion.`);
   await conn.query(`ALTER TABLE ${quote(fk.TABLE_NAME)} DROP FOREIGN KEY ${quote(fk.CONSTRAINT_NAME)}, MODIFY CustomerID VARCHAR(20) NULL, ADD CONSTRAINT ${quote("customer_history_"+fk.TABLE_NAME.toLowerCase())} FOREIGN KEY (CustomerID) REFERENCES Customer(CustomerID) ON DELETE RESTRICT`);
  }
  for(const table of ['Order','Sales','Payment','Delivery']) {
   const trigger='customer_snapshot_'+table.toLowerCase();
   await conn.query(`DROP TRIGGER IF EXISTS ${quote(trigger)}`);
   let source,where,sourceFields;
   if(table==='Order') {source='Customer';where='CustomerID=NEW.CustomerID';sourceFields=['CustomerID','CustomerName','ContactNo','Address','CustomerType'];}
   else if(table==='Sales') {source='`Order`';where='OrderID=NEW.OrderID';sourceFields=fields;}
   else {source='Sales';where='SaleID=NEW.SaleID';sourceFields=fields;}
   const assignments=fields.map((f,i)=>`SET NEW.${f}=COALESCE(NEW.${f},(SELECT ${sourceFields[i]} FROM ${source} WHERE ${where}));`).join('\n');
   const fallback=table==='Sales'?fields.map((f,i)=>`SET NEW.${f}=COALESCE(NEW.${f},(SELECT ${['CustomerID','CustomerName','ContactNo','Address','CustomerType'][i]} FROM Customer WHERE CustomerID=NEW.CustomerID));`).join('\n'):'';
   await conn.query(`CREATE TRIGGER ${quote(trigger)} BEFORE INSERT ON ${quote(table)} FOR EACH ROW BEGIN ${assignments} ${fallback} END`);
  }
  console.log('Customer snapshots and restrictive nullable references ready.');
 } finally {conn.release();}
}
if(require.main===module)migrate().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>pool.end());
module.exports=migrate;

