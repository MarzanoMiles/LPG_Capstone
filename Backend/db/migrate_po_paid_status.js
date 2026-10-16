const pool = require('../config/db');
async function migrate() {
  const [result] = await pool.query("UPDATE PurchaseOrder SET Status='Paid' WHERE Status='Approved' AND AmountPaid > 0 AND PaymentMethod IS NOT NULL AND NULLIF(TRIM(PaymentReference),'') IS NOT NULL");
  console.log(`Updated ${result.affectedRows} paid purchase orders.`);
}
if (require.main === module) migrate().catch(error=>{console.error(error.message);process.exitCode=1;}).finally(()=>pool.end());
module.exports=migrate;
