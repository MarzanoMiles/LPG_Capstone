const pool = require('../config/db');
async function migrate() {
  const [columns] = await pool.query("SHOW COLUMNS FROM Delivery LIKE 'VehicleRateSnapshot'");
  if (!columns.length) await pool.query('ALTER TABLE Delivery ADD COLUMN VehicleRateSnapshot JSON NULL');
  console.log('Delivery vehicle snapshots ready. Existing fees and transactions preserved.');
}
if (require.main === module) migrate().catch(error => {
  console.error(error.message); process.exitCode = 1;
}).finally(() => pool.end());
module.exports = migrate;
