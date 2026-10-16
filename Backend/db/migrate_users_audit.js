const pool = require('../config/db');
async function migrate() {
 const c=await pool.getConnection();
 try {
  await c.query('CREATE TABLE IF NOT EXISTS UserIdSequence (SequenceID INT PRIMARY KEY, NextValue BIGINT NOT NULL)');
  await c.query("INSERT INTO UserIdSequence (SequenceID,NextValue) SELECT 1, COALESCE(MAX(CAST(SUBSTRING(UserID,3) AS UNSIGNED)),0)+1 FROM User WHERE UserID REGEXP '^U-[0-9]+$' ON DUPLICATE KEY UPDATE NextValue=GREATEST(NextValue,VALUES(NextValue))");
  for (const table of ['User','Warehouse']) {
   const [cols]=await c.query(`SHOW COLUMNS FROM \`${table}\``);
   if(!cols.some(x=>x.Field==='BranchID')) await c.query(`ALTER TABLE \`${table}\` ADD BranchID VARCHAR(20) NULL, ADD FOREIGN KEY (BranchID) REFERENCES Branch(BranchID)`);
  }
  const [cols]=await c.query('SHOW COLUMNS FROM UserActivity');
  for(const [name,type] of Object.entries({CompanyID:'VARCHAR(20)',ActorName:'VARCHAR(150)',ActorRole:'VARCHAR(50)',Outcome:"VARCHAR(20) NOT NULL DEFAULT 'Success'"}))
   if(!cols.some(x=>x.Field===name)) await c.query(`ALTER TABLE UserActivity ADD ${name} ${type}`);
  await c.query("DROP TRIGGER IF EXISTS audit_no_update");
  await c.query(`UPDATE UserActivity a JOIN User u ON u.UserID=a.UserID JOIN Role r ON r.RoleID=u.RoleID SET a.CompanyID=COALESCE(a.CompanyID,u.CompanyID),a.ActorName=COALESCE(a.ActorName,CONCAT(u.FirstName,' ',u.LastName)),a.ActorRole=COALESCE(a.ActorRole,r.RoleName)`);
  await c.query('DROP TRIGGER IF EXISTS audit_snapshot');
  await c.query(`CREATE TRIGGER audit_snapshot BEFORE INSERT ON UserActivity FOR EACH ROW BEGIN
   SET NEW.CompanyID=(SELECT CompanyID FROM User WHERE UserID=NEW.UserID);
   SET NEW.ActorName=(SELECT CONCAT(FirstName,' ',LastName) FROM User WHERE UserID=NEW.UserID);
   SET NEW.ActorRole=(SELECT r.RoleName FROM User u JOIN Role r ON r.RoleID=u.RoleID WHERE u.UserID=NEW.UserID);
   SET NEW.Outcome=IF(NEW.Outcome IN ('Success','Failure'),NEW.Outcome,'Success'); END`);
  for(const event of ['UPDATE','DELETE']) {
   await c.query(`DROP TRIGGER IF EXISTS audit_no_${event.toLowerCase()}`);
   await c.query(`CREATE TRIGGER audit_no_${event.toLowerCase()} BEFORE ${event} ON UserActivity FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Audit records are immutable'`);
  }
  console.log('Users and audit migration complete');
 } finally { c.release(); }
}
if(require.main===module) migrate().then(()=>pool.end()).catch(e=>{console.error(e.message);pool.end();process.exitCode=1;});
module.exports=migrate;
