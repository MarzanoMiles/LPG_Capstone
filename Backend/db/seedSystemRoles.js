const {entities, quote} = require('../utils/entityIds');
const roles = ['Administrator','Operations Supervisor','Assistant Operations Supervisor',
 'Store Supervisor','Assistant Store Supervisor','Stockman','Head Maintenance','Drivers','Helpers','Customer'];

async function seedSystemRoles(pool) {
 const conn = await pool.getConnection();
 let locked = false;
 try {
  const [[lock]] = await conn.query("SELECT GET_LOCK('gastrack_system_seed',10) AS acquired");
  if (Number(lock.acquired) !== 1) throw new Error('System seed is already running.');
  locked = true;
  await conn.query('CREATE TABLE IF NOT EXISTS SetupSeedHistory (SeedKey VARCHAR(64) PRIMARY KEY, AppliedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)');
  await conn.beginTransaction();
  const [applied] = await conn.query("SELECT SeedKey FROM SetupSeedHistory WHERE SeedKey='system-roles-v1' FOR UPDATE");
  if (applied.length) {
   await conn.commit();
   return 'System setup already recorded. Existing edits and deletions preserved.';
  }
  // Existing installations must never receive replacement seed records, even if
  // a user deleted all roles. Include history tables when checking for data.
  const [tables] = await conn.query("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE'");
  const businessTables = new Set([...Object.keys(entities), 'Product','ProductHistory','SupplierHistory','CompanySettings','Transfer','TransferDetail'].map(t=>t.toLowerCase()));
  let existing = false;
  for (const {TABLE_NAME: table} of tables) {
   if (!businessTables.has(table.toLowerCase())) continue;
   const [rows] = await conn.query(`SELECT 1 FROM ${quote(table)} LIMIT 1`);
   if (rows.length) { existing = true; break; }
  }
  if (!existing) {
   for (let i=0;i<roles.length;i++) await conn.query('INSERT INTO Role (RoleID,RoleName) VALUES (:id,:name)',{id:'RL-'+String(i+1).padStart(3,'0'),name:roles[i]});
  }
  await conn.query("INSERT INTO SetupSeedHistory (SeedKey) VALUES ('system-roles-v1')");
  await conn.commit();
  return existing ? 'Existing installation detected. No business records or roles were changed; setup recorded.' : 'Initialized 10 system roles. Create company, users and business records through the app.';
 } catch (error) {
  await conn.rollback();
  throw error;
 } finally {
  try { if (locked) await conn.query("SELECT RELEASE_LOCK('gastrack_system_seed')"); }
  finally { conn.release(); }
 }
}
module.exports = {seedSystemRoles};
