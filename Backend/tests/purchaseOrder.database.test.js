const {test}=require('node:test');
const assert=require('node:assert/strict');
test('live supplier delivery stock-in rolls back inventory and movement together', {skip:process.env.RUN_PO_DATABASE_TESTS!=='1'}, async()=>{
  const pool=require('../config/db');
  const {recordStockIn}=require('../utils/inventoryMovements');
  const {pricePurchaseOrderItems}=require('../utils/purchaseOrderCosts');
  const {randomBytes}=require('node:crypto');
  const conn=await pool.getConnection();
  const transactionId=`T-${randomBytes(9).toString('hex')}`;
  let inventory;
  try {
    await conn.beginTransaction();
    const [[row]]=await conn.query(`SELECT i.InventoryID,i.StockOnHand,u.UserID FROM Inventory i JOIN Warehouse w ON w.WarehouseID=i.WarehouseID JOIN User u ON u.CompanyID=w.CompanyID LIMIT 1 FOR UPDATE`);
    assert.ok(row,'An inventory row and company user are required for this live check');
    inventory=row;
    const [[product]]=await conn.query("SELECT ProductID,SupplierID,CostPrice FROM Product WHERE Status='Active' AND SupplierID IS NOT NULL LIMIT 1");
    assert.ok(product);
    const priced=await pricePurchaseOrderItems(conn,product.SupplierID,[{productId:product.ProductID,qty:2,unitCost:0}]);
    assert.equal(priced.pricedItems[0].unitCost,Number(product.CostPrice));
    assert.equal(priced.totalCents,Math.round(Number(product.CostPrice)*100)*2);
    await recordStockIn(conn,{inventoryId:row.InventoryID,quantity:1,userId:row.UserID,reason:'Supplier Delivery',referenceNo:'PO-ROLLBACK-CHECK',remarks:'Rollback-only database verification',transactionId});
    const [[updated]]=await conn.query('SELECT StockOnHand FROM Inventory WHERE InventoryID=:id',{id:row.InventoryID});
    assert.equal(Number(updated.StockOnHand),Number(row.StockOnHand)+1);
    const [[movement]]=await conn.query('SELECT Reason,Quantity FROM InventoryTransaction WHERE TransactionID=:id',{id:transactionId});
    assert.equal(movement.Reason,'Supplier Delivery');
    assert.equal(Number(movement.Quantity),1);
    await conn.rollback();
    const [[restored]]=await conn.query('SELECT StockOnHand FROM Inventory WHERE InventoryID=:id',{id:row.InventoryID});
    assert.equal(Number(restored.StockOnHand),Number(inventory.StockOnHand));
    const [movements]=await conn.query('SELECT TransactionID FROM InventoryTransaction WHERE TransactionID=:id',{id:transactionId});
    assert.equal(movements.length,0);
  } finally {await conn.rollback();conn.release();await pool.end();}
});
