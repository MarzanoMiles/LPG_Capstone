// Stop application writers before applying this migration.
const pool = require('../config/db');
const quote = value => '`'+value.replace(/`/g,'``')+'`';
const fields = ['UserID','CompanyID','RoleID','WarehouseID','BranchID','FirstName','LastName','Email','Status','ModuleAccess','CreatedAt'];
async function migrate() {
 const conn = await pool.getConnection();
 try {
  await conn.query(`CREATE TABLE IF NOT EXISTS UserHistory (
   UserID VARCHAR(20) PRIMARY KEY, CompanyID VARCHAR(20) NOT NULL, RoleID VARCHAR(20) NOT NULL,
   WarehouseID VARCHAR(20) NULL, BranchID VARCHAR(20) NULL,
   FirstName VARCHAR(50) NOT NULL, LastName VARCHAR(50) NOT NULL, Email VARCHAR(150) NOT NULL,
   Status VARCHAR(20) NOT NULL, ModuleAccess JSON NULL, CreatedAt DATETIME NOT NULL
  )`);
  const names=fields.map(quote).join(',');
  for(const event of ['INSERT','UPDATE']) {
   const trigger='user_history_'+event.toLowerCase();
   const [found]=await conn.query('SELECT TRIGGER_NAME FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND TRIGGER_NAME=:trigger',{trigger});
   if(!found.length) await conn.query(`CREATE TRIGGER ${quote(trigger)} AFTER ${event} ON User FOR EACH ROW
    INSERT INTO UserHistory (${names}) VALUES (${fields.map(f=>'NEW.'+quote(f)).join(',')})
    ON DUPLICATE KEY UPDATE ${fields.filter(f=>f!=='UserID').map(f=>quote(f)+'=NEW.'+quote(f)).join(',')}`);
  }
  await conn.query(`INSERT INTO UserHistory (${names}) SELECT ${names} FROM User
   ON DUPLICATE KEY UPDATE ${fields.filter(f=>f!=='UserID').map(f=>quote(f)+'=VALUES('+quote(f)+')').join(',')}`);
  // Password-reset tokens belong to the live account and are removed on delete.
  // Operational records keep their exact IDs and now reference the identity archive.
  const [refs]=await conn.query(`SELECT TABLE_NAME,COLUMN_NAME,CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
   WHERE REFERENCED_TABLE_SCHEMA=DATABASE() AND LOWER(REFERENCED_TABLE_NAME)='user' AND LOWER(TABLE_NAME)<>'passwordresettoken'`);
  for(const ref of refs) await conn.query(`ALTER TABLE ${quote(ref.TABLE_NAME)} DROP FOREIGN KEY ${quote(ref.CONSTRAINT_NAME)},
   ADD CONSTRAINT ${quote('uh_'+ref.TABLE_NAME+'_'+ref.COLUMN_NAME)} FOREIGN KEY (${quote(ref.COLUMN_NAME)}) REFERENCES UserHistory(UserID)`);
  await conn.query(`UPDATE UserIdSequence SET NextValue=GREATEST(NextValue,(SELECT COALESCE(MAX(CAST(SUBSTRING(UserID,3) AS UNSIGNED)),0)+1 FROM UserHistory WHERE UserID REGEXP '^U-[0-9]+$')) WHERE SequenceID=1`);
  await conn.beginTransaction();
  const [tokens]=await conn.query("SHOW TABLES LIKE 'passwordresettoken'");
  if(tokens.length) await conn.query("DELETE t FROM PasswordResetToken t JOIN User u ON u.UserID=t.UserID WHERE u.Status='Deleted'");
  const [deleted]=await conn.query("DELETE FROM User WHERE Status='Deleted'");
  await conn.commit();
  console.log(`UserHistory ready without credentials; removed ${deleted.affectedRows} previously deleted accounts from User. Transactions preserved.`);
 } catch(error) {await conn.rollback();throw error;}
 finally {conn.release();}
}
if(require.main===module)migrate().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>pool.end());
module.exports=migrate;
