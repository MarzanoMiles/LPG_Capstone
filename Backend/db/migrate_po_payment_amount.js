const pool = require('../config/db');
async function migrate() {
  const [columns] = await pool.query('SHOW COLUMNS FROM PurchaseOrder');
  if (!columns.some(column => column.Field === 'AmountPaid')) {
    await pool.query('ALTER TABLE PurchaseOrder ADD COLUMN AmountPaid DECIMAL(12,2) NULL');
  }
  console.log('Purchase order AmountPaid column ready. Existing payment amounts remain unrecorded.');
}
if (require.main === module) migrate().catch(error => {console.error(error.message);process.exitCode=1;}).finally(() => pool.end());
module.exports = migrate;
