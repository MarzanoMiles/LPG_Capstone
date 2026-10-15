const pool=require('../config/db');
const {resolveWalkInCustomer}=require('../utils/walkInCustomer');
const {fields}=require('../utils/customerHistory');
async function migrate(){
 const conn=await pool.getConnection();
 try {
  await conn.beginTransaction();
  const [rows]=await conn.query("SELECT * FROM Customer WHERE CustomerID IN ('CUST-001','CUST-004') FOR UPDATE");
  const old=rows.find(r=>r.CustomerID==='CUST-004');
  if(old && old.ContactNo!=='WALKIN')throw Error('CUST-004 is not a walk-in system customer; no changes applied.');
  await resolveWalkInCustomer(conn);
  if(old){
   const originals=['CustomerID','CustomerName','ContactNo','Address','CustomerType'];
   for(const table of ['Order','Sales'])await conn.query(`UPDATE \`${table}\` t JOIN Customer c ON c.CustomerID=t.CustomerID SET ${fields.map((f,i)=>`t.${f}=COALESCE(t.${f},c.${originals[i]})`).join(',')} WHERE t.CustomerID='CUST-004'`);
   for(const table of ['Payment','Delivery'])await conn.query(`UPDATE \`${table}\` t JOIN Sales s ON s.SaleID=t.SaleID SET ${fields.map(f=>`t.${f}=COALESCE(t.${f},s.${f})`).join(',')} WHERE s.CustomerID='CUST-004'`);
   for(const table of ['Order','Sales'])await conn.query(`UPDATE \`${table}\` SET CustomerID='CUST-001' WHERE CustomerID='CUST-004'`);
   await conn.query("DELETE FROM Customer WHERE CustomerID='CUST-004'");
  }
  await conn.commit();console.log('Walk-in customer is CUST-001; CUST-004 removed. Existing snapshots preserved.');
 }catch(e){await conn.rollback();throw e;}finally{conn.release();}
}
if(require.main===module)migrate().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>pool.end());
module.exports=migrate;
