const pool = require('../config/db');
async function migrate() {
  const [columns] = await pool.query("SHOW COLUMNS FROM UserActivity LIKE 'RecordID'");
  const width = Number(columns[0]?.Type.match(/^varchar\((\d+)\)$/i)?.[1]);
  if (!columns.length) throw new Error('UserActivity.RecordID is missing.');
  if (width && width < 100) await pool.query('ALTER TABLE UserActivity MODIFY COLUMN RecordID VARCHAR(100) NULL');
  console.log('Activity record IDs support full vehicle identifiers.');
}
if (require.main === module) migrate().catch(error => {
  console.error(error.message); process.exitCode = 1;
}).finally(() => pool.end());
module.exports = migrate;
