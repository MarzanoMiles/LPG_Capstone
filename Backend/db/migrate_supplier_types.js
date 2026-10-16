const pool = require('../config/db');
async function migrate() {
  const [existing] = await pool.query("SHOW TABLES LIKE 'SupplierType'");
  await pool.query(`CREATE TABLE IF NOT EXISTS SupplierType (
    SupplierTypeID INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    TypeName VARCHAR(80) NOT NULL UNIQUE
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS SupplierTypeAssignment (
    SupplierID VARCHAR(20) PRIMARY KEY,
    SupplierTypeID INT UNSIGNED NOT NULL,
    FOREIGN KEY (SupplierID) REFERENCES Supplier(SupplierID) ON DELETE CASCADE,
    FOREIGN KEY (SupplierTypeID) REFERENCES SupplierType(SupplierTypeID)
  )`);
  if (!existing.length) await pool.query("INSERT INTO SupplierType (TypeName) VALUES ('Manufacturer'), ('Distributor'), ('Wholesaler')");
  // Existing options are configuration defaults, not supplier classifications.
  // Do not reinsert defaults on subsequent migrations after users edit/delete them.
  console.log('Supplier type options and assignments ready. Existing suppliers remain unassigned.');
}
if (require.main === module) migrate().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => pool.end());
module.exports = migrate;
