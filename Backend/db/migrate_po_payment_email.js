const pool = require('../config/db');
async function migrate() {
  const [columns] = await pool.query('SHOW COLUMNS FROM PurchaseOrder');
  if (!columns.some(column => column.Field === 'PaymentEmailSentAt')) {
    await pool.query('ALTER TABLE PurchaseOrder ADD COLUMN PaymentEmailSentAt DATETIME NULL');
  }
  console.log('Purchase order payment email tracking ready.');
}
if (require.main === module) migrate().catch(error => {console.error(error.message);process.exitCode=1;}).finally(() => pool.end());
module.exports = migrate;
