const pool=require('../config/db');
async function migrate() {
  for(const [table,definitions] of Object.entries({PurchaseOrder:{WarehouseID:'VARCHAR(20) NULL',PaymentMethod:'VARCHAR(30) NULL',PaymentReference:'VARCHAR(100) NULL',AmountPaid:'DECIMAL(12,2) NULL',PaymentEmailSentAt:'DATETIME NULL',RequestKey:'VARCHAR(64) NULL'},PurchaseOrderItem:{ReceivedQuantity:'INT NOT NULL DEFAULT 0'}})) {
    const [columns]=await pool.query(`SHOW COLUMNS FROM ${table}`);
    for(const [name,type] of Object.entries(definitions)) if(!columns.some(c=>c.Field===name)) await pool.query(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
  }
  // Existing completed orders must never become receivable again.
  await pool.query(`UPDATE PurchaseOrderItem i JOIN PurchaseOrder p ON p.PurchaseOrderID=i.PurchaseOrderID SET i.ReceivedQuantity=i.Quantity WHERE p.Status='Received'`);
  const [keys]=await pool.query(`SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='PurchaseOrder' AND COLUMN_NAME='WarehouseID' AND REFERENCED_TABLE_NAME='Warehouse'`);
  if(!keys.length) await pool.query('ALTER TABLE PurchaseOrder ADD CONSTRAINT fk_po_destination FOREIGN KEY (WarehouseID) REFERENCES Warehouse(WarehouseID)');
  console.log('PO workflow fields ready. Legacy destination warehouses remain NULL for manual review.');
}
if(require.main===module) migrate().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>pool.end());
module.exports=migrate;
