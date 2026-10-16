const assert = require('node:assert/strict');
const pool = require('../config/db');
async function check() {
  const [ping] = await pool.query('SELECT 1 AS connected');
  assert.equal(ping[0].connected,1);
  const [tables] = await pool.query("SELECT TABLE_NAME,ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('PurchaseOrder','PurchaseOrderItem','Inventory','InventoryTransaction')");
  assert.equal(tables.length,4);
  assert.ok(tables.every(table=>table.ENGINE==='InnoDB'),'Workflow tables must support transactions');
  const [columns] = await pool.query('SHOW COLUMNS FROM PurchaseOrder');
  for (const name of ['WarehouseID','PaymentMethod','PaymentReference','AmountPaid','PaymentEmailSentAt','RequestKey']) assert.ok(columns.some(column=>column.Field===name),`Missing ${name}`);
  assert.equal(columns.find(column=>column.Field==='AmountPaid').Type.toLowerCase(),'decimal(12,2)');
  const [itemColumns] = await pool.query('SHOW COLUMNS FROM PurchaseOrderItem');
  assert.ok(itemColumns.some(column=>column.Field==='ReceivedQuantity'));
  const checks = {
    invalidItemCosts: 'SELECT COUNT(*) AS n FROM PurchaseOrderItem WHERE UnitCost < 0 OR Subtotal <> ROUND(Quantity * UnitCost,2)',
    invalidReceivedQuantities: 'SELECT COUNT(*) AS n FROM PurchaseOrderItem WHERE ReceivedQuantity < 0 OR ReceivedQuantity > Quantity',
    mismatchedOrderTotals: 'SELECT COUNT(*) AS n FROM PurchaseOrder po JOIN (SELECT PurchaseOrderID,SUM(Subtotal) total FROM PurchaseOrderItem GROUP BY PurchaseOrderID) i ON i.PurchaseOrderID=po.PurchaseOrderID WHERE po.TotalAmount<>i.total',
    paidWithoutPayment: "SELECT COUNT(*) AS n FROM PurchaseOrder WHERE Status='Paid' AND (AmountPaid IS NULL OR AmountPaid<=0 OR PaymentMethod NOT IN ('GCash','Card','Bank Transfer') OR PaymentMethod IS NULL OR NULLIF(TRIM(PaymentReference),'') IS NULL)",
    receivedWithOutstandingItems: "SELECT COUNT(DISTINCT po.PurchaseOrderID) AS n FROM PurchaseOrder po JOIN PurchaseOrderItem i ON i.PurchaseOrderID=po.PurchaseOrderID WHERE po.Status='Received' AND i.ReceivedQuantity<>i.Quantity",
    orphanItems: 'SELECT COUNT(*) AS n FROM PurchaseOrderItem i LEFT JOIN PurchaseOrder po ON po.PurchaseOrderID=i.PurchaseOrderID LEFT JOIN ProductHistory p ON p.ProductID=i.ProductID WHERE po.PurchaseOrderID IS NULL OR p.ProductID IS NULL',
    missingSupplierHistory: 'SELECT COUNT(*) AS n FROM PurchaseOrder po LEFT JOIN SupplierHistory s ON s.SupplierID=po.SupplierID WHERE s.SupplierID IS NULL',
    missingActiveDestination: "SELECT COUNT(*) AS n FROM PurchaseOrder po JOIN User u ON u.UserID=po.CreatedByUserID LEFT JOIN Warehouse w ON w.WarehouseID=po.WarehouseID AND w.CompanyID=u.CompanyID WHERE po.Status IN ('Sent','Approved','Paid','Out for Delivery') AND (w.WarehouseID IS NULL OR w.Status<>'Active')",
  };
  let failed=false;
  for (const [name,sql] of Object.entries(checks)) {
    const [[result]]=await pool.query(sql);
    console.log(`${name}: ${result.n}`);
    if(Number(result.n))failed=true;
  }
  const [statuses]=await pool.query('SELECT Status,COUNT(*) AS count FROM PurchaseOrder GROUP BY Status');
  console.log('Order statuses:',JSON.stringify(statuses));
  assert.equal(failed,false,'Database consistency checks found issues');
  const [[sample]] = await pool.query('SELECT po.PurchaseOrderID,u.CompanyID FROM PurchaseOrder po JOIN User u ON u.UserID=po.CreatedByUserID LIMIT 1');
  if (sample) {
    const router = require('../routes/purchaseOrderRoutes');
    const invoke = path => new Promise((resolve,reject) => {
      const route=router.stack.find(layer=>layer.route?.path===path && layer.route.methods.get).route;
      route.stack.at(-1).handle({params:{id:sample.PurchaseOrderID},user:{companyId:sample.CompanyID}}, {json:resolve,set(){},send:resolve}, reject);
    });
    assert.ok(Array.isArray(await invoke('/')));
    const detail=await invoke('/:id');
    assert.equal(detail.PurchaseOrderID,sample.PurchaseOrderID);
    assert.ok(Array.isArray(detail.items));
    assert.ok(Array.isArray(detail.deliveries));
    const pdf=await invoke('/:id/document');
    assert.equal(pdf.subarray(0,4).toString(),'%PDF');
    console.log('Live list, details, delivery history and PDF database queries passed.');
  }
  console.log('Database connection, transactional tables, schema and purchase order consistency checks passed.');
}
if(require.main===module)check().catch(error=>{console.error(error.message);process.exitCode=1;}).finally(()=>pool.end());
module.exports=check;
