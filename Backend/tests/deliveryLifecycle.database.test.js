const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomBytes}=require('crypto');
test('MySQL delivery transactions: paid final failure, restock once, settlement and empty returns',{skip:process.env.RUN_DELIVERY_DB_TESTS!=='1'},async()=>{
  const pool=require('../config/db'),life=require('../utils/deliveryLifecycle');
  const conn=await pool.getConnection();
  const id=()=> 'DT-'+randomBytes(7).toString('hex');
  try {
    await conn.beginTransaction();
    const [[owner]]=await conn.query('SELECT u.UserID,u.CompanyID FROM User u JOIN CompanySettings cs ON cs.CompanyID=u.CompanyID LIMIT 1');
    const [[customer]]=await conn.query('SELECT CustomerID FROM Customer LIMIT 1');
    const [[stock]]=await conn.query("SELECT i.InventoryID,i.ProductID,i.WarehouseID FROM Inventory i JOIN Warehouse w ON w.WarehouseID=i.WarehouseID JOIN Product p ON p.ProductID=i.ProductID JOIN Category c ON c.CategoryID=p.CategoryID WHERE w.CompanyID=:companyId AND w.Status='Active' AND c.Category='Cylinder' AND p.Status='Active' LIMIT 1",{companyId:owner.CompanyID});
    assert.ok(stock,'Requires an active Cylinder SKU and warehouse');
    const user={userId:owner.UserID,companyId:owner.CompanyID,roleName:'Administrator'};
    await conn.query("UPDATE CompanySettings SET MaxDeliveryAttempts=3,AllowIssueRefund=0,BusinessDays='Monday,Tuesday,Wednesday,Thursday,Friday',OpeningTime='08:00:00',ClosingTime='17:00:00' WHERE CompanyID=:companyId",{companyId:user.companyId});
    const adapter={getConnection:async()=>({query:conn.query.bind(conn),beginTransaction:()=>conn.query('SAVEPOINT delivery_test'),commit:async()=>{},rollback:()=>conn.query('ROLLBACK TO SAVEPOINT delivery_test'),release(){}})};
    async function create() {
      const orderId=id(),saleId=id(),deliveryId=id();
      await conn.query("INSERT INTO `Order`(OrderID,OrderNo,CustomerID,OrderType,OrderStatus,TotalAmount) VALUES(:orderId,:orderId,:customerId,'Delivery','Preparing',100)",{orderId,customerId:customer.CustomerID});
      await conn.query('INSERT INTO OrderDetails(OrderDetailID,OrderID,ProductID,Quantity,UnitPrice,Subtotal) VALUES(:detailId,:orderId,:productId,2,50,100)',{detailId:id(),orderId,productId:stock.ProductID});
      await conn.query('INSERT INTO Sales(SaleID,OrderID,CustomerID,UserID,SaleNo,TotalAmount) VALUES(:saleId,:orderId,:customerId,:userId,:saleId,100)',{saleId,orderId,customerId:customer.CustomerID,userId:user.userId});
      await conn.query("INSERT INTO Payment(PaymentID,PaymentType,SaleID,PaymentMethod,AmountPaid) VALUES(:paymentId,'Sale',:saleId,'Cash',100)",{paymentId:id(),saleId});
      await conn.query("INSERT INTO Delivery(DeliveryID,SaleID,DRNo,DeliveredByUserID,DeliveryAddress,DeliveryStatus,PaymentMethod) VALUES(:deliveryId,:saleId,:deliveryId,:userId,'Test address','Preparing','GCash')",{deliveryId,saleId,userId:user.userId});
      return {orderId,saleId,deliveryId};
    }
    const amount=async()=>{const [[r]]=await conn.query('SELECT StockOnHand AS qty FROM Inventory WHERE InventoryID=:id',{id:stock.InventoryID});return Number(r.qty);};
    const f=await create(),before=await amount();
    await conn.query("INSERT INTO InventoryTransaction(TransactionID,InventoryID,UserID,TransactionType,Quantity,Reason,ReferenceNo) VALUES(:id,:inventoryId,:userId,'Stock Out',2,'Sale',:orderNo)",{id:id(),inventoryId:stock.InventoryID,userId:user.userId,orderNo:f.orderId});
    for(let n=1;n<=3;n++) {
      await life.execute(adapter,user,f.deliveryId,'dispatch',{requestId:'dispatch-'+n});
      await life.execute(adapter,user,f.deliveryId,'fail',{requestId:'failure-'+n,notes:'Customer unavailable'});
    }
    assert.equal(await amount(),before+2);
    const [[row]]=await conn.query('SELECT * FROM Delivery WHERE DeliveryID=:id',{id:f.deliveryId});
    assert.equal(row.DeliveryStatus,'Delivery Failed');assert.equal(row.AttemptCount,3);
    const quote=await life.quote(adapter,user,f.deliveryId);
    const settle={requestId:'settlement-1',quote:{eligibleAmount:quote.eligibleAmount,cancellationFee:quote.cancellationFee,refundAmount:quote.refundAmount}};
    await life.execute(adapter,user,f.deliveryId,'settle',settle);
    await life.execute(adapter,user,f.deliveryId,'settle',settle);
    assert.equal(await amount(),before+2);
    const [[refund]]=await conn.query('SELECT COUNT(*) AS n FROM RefundLedger WHERE OrderID=:id',{id:f.orderId});assert.equal(Number(refund.n),0);
    const other=await create(),returnBefore=await amount();
    await life.execute(adapter,user,other.deliveryId,'dispatch',{requestId:'dispatch-1'});
    const complete={requestId:'complete-1',emptyCylinderReturned:true,warehouseId:stock.WarehouseID,returnedCylinders:[{productId:stock.ProductID,qty:2}]};
    await life.execute(adapter,user,other.deliveryId,'complete',complete);
    await life.execute(adapter,user,other.deliveryId,'complete',complete);
    assert.equal(await amount(),returnBefore+2);
    const [[payment]]=await conn.query('SELECT SUM(AmountPaid) AS amount FROM Payment WHERE SaleID=:id',{id:other.saleId});assert.equal(Number(payment.amount),100);
    const [[audit]]=await conn.query('SELECT COUNT(*) AS n FROM UserActivity WHERE RecordID=:id AND UserID=:userId',{id:other.deliveryId,userId:user.userId});assert.equal(Number(audit.n),2);
    const cod=await create();
    await conn.query('DELETE FROM Payment WHERE SaleID=:id',{id:cod.saleId});
    await conn.query("UPDATE Delivery SET PaymentMethod='Cash on Delivery' WHERE DeliveryID=:id",{id:cod.deliveryId});
    await life.execute(adapter,user,cod.deliveryId,'dispatch',{requestId:'dispatch-1'});
    const collected={requestId:'cod-complete-1',emptyCylinderReturned:false,amountCollected:150};
    await life.execute(adapter,user,cod.deliveryId,'complete',collected);
    await life.execute(adapter,user,cod.deliveryId,'complete',collected);
    const [[codPayment]]=await conn.query('SELECT COUNT(*) AS n,SUM(AmountPaid) AS amount FROM Payment WHERE SaleID=:id',{id:cod.saleId});
    assert.equal(Number(codPayment.n),1);assert.equal(Number(codPayment.amount),100);
  } finally {await conn.rollback();conn.release();await pool.end();}
});
