// Run from Backend: npm run migrate:vehicle-rates
const pool = require('../config/db');
async function migrate() {
  await require('./migrate_activity_record_id')();
  const [columns] = await pool.query("SHOW COLUMNS FROM CompanySettings LIKE 'VehicleRates'");
  if (!columns.length) await pool.query('ALTER TABLE CompanySettings ADD COLUMN VehicleRates JSON NULL');
  await pool.query(`CREATE TABLE IF NOT EXISTS deliveryvehiclerate (
    VehicleID VARCHAR(50) PRIMARY KEY, CompanyID VARCHAR(20) NOT NULL,
    VehicleName VARCHAR(100) NOT NULL, CapacityLabel VARCHAR(100) NOT NULL,
    MaxWeightKg DECIMAL(12,2) NOT NULL, BaseRate DECIMAL(12,2) NOT NULL,
    PerKm DECIMAL(12,2) NOT NULL, MinSubtotalForFree DECIMAL(12,2) NOT NULL DEFAULT 0,
    FreeDistanceKm DECIMAL(10,1) NOT NULL DEFAULT 5, Enabled TINYINT(1) NOT NULL DEFAULT 1,
    KEY (CompanyID))`);
  console.log('Vehicle rate settings ready.');
}
if (require.main === module) migrate().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
}).finally(() => pool.end());
module.exports = migrate;
