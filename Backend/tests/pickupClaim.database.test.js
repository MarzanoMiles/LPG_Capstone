const {test}=require("node:test");
const assert=require("node:assert/strict");
const {randomBytes}=require("node:crypto");
// Opt-in: all fixtures and stock changes are rolled back, even on assertion failure.
test("MySQL claim transaction: Yes/No, original sale/payment, retry and stock rollback",{skip:process.env.RUN_PICKUP_DB_TESTS!=="1"},async()=>{
 const pool=require("../config/db");
 const {complete}=require("../utils/pickupClaim");
 const conn=await pool.getConnection();
 try {
  await conn.beginTransaction();
  const [users]=await conn.query("SELECT u.UserID,u.CompanyID FROM User u JOIN CompanySettings cs ON cs.CompanyID=u.CompanyID LIMIT 1");
  const [customers]=await conn.query("SELECT CustomerID FROM Customer LIMIT 1");
  const [products]=await conn.query("SELECT p.ProductID FROM Product p JOIN Category c ON c.CategoryID=p.CategoryID WHERE c.Category='Cylinder' AND p.Status='Active' LIMIT 1");
  assert.ok(users.length && customers.length && products.length,"Requires seeded user, customer, active Cylinder and settings");
  const user={userId:users[0].UserID,companyId:users[0].CompanyID,roleName:"Administrator"};
  const [warehouses]=await conn.query("SELECT WarehouseID FROM Warehouse WHERE CompanyID=:companyId AND Status='Active' LIMIT 1",{companyId:user.companyId});assert.ok(warehouses.length,"Requires active warehouse");
  const warehouseId=warehouses[0].WarehouseID,productId=products[0].ProductID;
  const adapter={async getConnection(){return {query:conn.query.bind(conn),beginTransaction:()=>conn.query("SAVEPOINT pickup_test"),async commit(){},rollback:()=>conn.query("ROLLBACK TO SAVEPOINT pickup_test"),release(){}};}};
  for(const returned of [false,true]) {
   const id="TEST-"+randomBytes(6).toString("hex"),saleId="S-"+randomBytes(7).toString("hex"),paymentId="P-"+randomBytes(7).toString("hex");
   await conn.query("INSERT INTO `Order` (OrderID,CustomerID,OrderNo,OrderType,OrderStatus,TotalAmount,PickupStatus,PickupScheduledAt) VALUES (:id,:customerId,:id,'Pickup','Ready for Pickup',100,'Ready for Pickup','2099-12-01 10:00:00')",{id,customerId:customers[0].CustomerID});
   await conn.query("INSERT INTO Sales (SaleID,OrderID,CustomerID,UserID,SaleNo,TotalAmount) VALUES (:saleId,:id,:customerId,:userId,:saleId,100)",{saleId,id,customerId:customers[0].CustomerID,userId:user.userId});
   await conn.query("INSERT INTO Payment (PaymentID,PaymentType,SaleID,PaymentMethod,AmountPaid,ReferenceNo) VALUES (:paymentId,'Sale',:saleId,'Cash',100,'UNCHANGED-REFERENCE')",{paymentId,saleId});
   const stock=async()=>{const [rows]=await conn.query("SELECT COALESCE(SUM(StockOnHand),0) AS qty FROM Inventory WHERE WarehouseID=:warehouseId AND ProductID=:productId",{warehouseId,productId});return Number(rows[0].qty);};
   const before=await stock();
   const body={emptyCylinderReturned:returned,warehouseId,returnedCylinders:returned?[{productId,qty:2}]:[]};
   const result=await complete(adapter,user,id,body);assert.equal(result.saleId,saleId);assert.equal(await stock(),before+(returned?2:0));
   assert.equal((await complete(adapter,user,id,body)).alreadyCompleted,true);assert.equal(await stock(),before+(returned?2:0));
   const [[order]]=await conn.query("SELECT PickupStatus FROM `Order` WHERE OrderID=:id",{id});assert.equal(order.PickupStatus,"Completed");
   const [[sales]]=await conn.query("SELECT COUNT(*) AS count FROM Sales WHERE OrderID=:id",{id});assert.equal(Number(sales.count),1);
   const [[payment]]=await conn.query("SELECT AmountPaid,ReferenceNo FROM Payment WHERE PaymentID=:paymentId",{paymentId});assert.equal(Number(payment.AmountPaid),100);assert.equal(payment.ReferenceNo,"UNCHANGED-REFERENCE");
  }
 }finally{await conn.rollback();conn.release();await pool.end();}
});
