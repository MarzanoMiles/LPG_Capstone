const router=require('express').Router();
const pool=require('../config/db');
const asyncHandler=require('../utils/asyncHandler');
const ApiError=require('../utils/apiError');
const {authenticate}=require('../middleware/auth');
const life=require('../utils/deliveryLifecycle');
router.use(authenticate);
router.get('/',asyncHandler(async(req,res)=>{
  if(!life.driver(req.user) && !life.operator(req.user)) throw new ApiError(403,'Delivery access denied.');
  const [rows]=await pool.query(`SELECT d.DeliveryID AS deliveryId,d.DRNo AS drNo,o.OrderID AS orderId,o.OrderNo AS id,
    o.OrderType AS type,o.OrderStatus AS status,o.OrderDate AS date,o.TotalAmount AS totalAmount,
    c.CustomerName AS customerName,d.DeliveryStatus AS deliveryStatus,d.AttemptCount AS attempts,
    settings.MaxDeliveryAttempts AS maxAttempts,d.NextAttemptAt AS nextAttemptAt,d.DeliveryAddress AS deliveryAddress,
    d.DeliveredByUserID AS deliveryRiderId,CONCAT(rider.FirstName,' ',rider.LastName) AS deliveryRiderName,
    CASE WHEN COALESCE(pay.amount,0)>=o.TotalAmount THEN 'Paid' ELSE 'Unpaid' END AS paymentStatus,
    COALESCE(d.PaymentMethod,pay.method) AS paymentMethod,
    GREATEST(0,ROUND(o.TotalAmount-COALESCE(pay.amount,0),2)) AS amountToCollect,
    d.RestockedAt AS restockedAt,d.SettledAt AS settledAt
    FROM Delivery d JOIN Sales s ON s.SaleID=d.SaleID JOIN User owner ON owner.UserID=s.UserID
    JOIN \`Order\` o ON o.OrderID=s.OrderID LEFT JOIN Customer c ON c.CustomerID=o.CustomerID
    LEFT JOIN User rider ON rider.UserID=d.DeliveredByUserID JOIN CompanySettings settings ON settings.CompanyID=owner.CompanyID
    LEFT JOIN (SELECT SaleID,SUM(AmountPaid) AS amount,MAX(PaymentMethod) AS method FROM Payment WHERE PaymentType='Sale' GROUP BY SaleID) pay ON pay.SaleID=s.SaleID
    WHERE owner.CompanyID=:companyId AND d.DeliveryStatus<>'Delivered' AND d.SettledAt IS NULL AND NOT (d.DeliveryStatus='Cancelled' AND COALESCE(pay.amount,0)=0) AND (:isDriver=0 OR (d.DeliveredByUserID=:userId AND d.DeliveryStatus IN ('Out for Delivery','Failed Attempt') AND o.OrderStatus NOT IN ('Cancelled','Completed','Delivery Failed') AND d.AttemptCount<settings.MaxDeliveryAttempts))
    ORDER BY d.NextAttemptAt,o.OrderDate DESC`,{companyId:req.user.companyId,userId:req.user.userId,isDriver:Number(life.driver(req.user))});
  res.json(rows.map(row=>({...row,canSettle:life.manager(req.user) && row.paymentStatus==='Paid' && ['Cancelled','Delivery Failed'].includes(row.deliveryStatus) && Number(row.attempts)>=Number(row.maxAttempts) && !row.settledAt})));
}));
router.get('/drivers',asyncHandler(async(req,res)=>{
  if(!life.operator(req.user)) throw new ApiError(403,'Management access required.');
  const [rows]=await pool.query("SELECT u.UserID AS id,CONCAT(u.FirstName,' ',u.LastName) AS name FROM User u JOIN Role r ON r.RoleID=u.RoleID WHERE u.CompanyID=:companyId AND u.Status='Active' AND LOWER(r.RoleName) IN ('driver','drivers')",{companyId:req.user.companyId});
  res.json(rows);
}));
router.get('/:id/return-options',asyncHandler(async(req,res)=>{
  const conn=await pool.getConnection();
  try {
    await conn.beginTransaction();
    const {row}=await life.context(conn,req.user,req.params.id);
    if(!['Out for Delivery','Failed Attempt'].includes(row.DeliveryStatus)) throw new ApiError(409,'Delivery is not active.');
    const [warehouses]=await conn.query("SELECT WarehouseID AS id,WarehouseName AS name FROM Warehouse WHERE CompanyID=:companyId AND Status='Active'",{companyId:req.user.companyId});
    const [products]=await conn.query("SELECT p.ProductID AS id,p.ProductName AS name,b.Brand AS brand,p.UnitValue AS unitValue FROM Product p JOIN Category c ON c.CategoryID=p.CategoryID JOIN Brand b ON b.BrandID=p.BrandID WHERE c.Category='Cylinder' AND p.Status='Active'");
    const [inventoryStocks]=await conn.query("SELECT i.WarehouseID AS warehouseId,i.ProductID AS productId,SUM(i.StockOnHand) AS stock FROM Inventory i JOIN Warehouse w ON w.WarehouseID=i.WarehouseID JOIN Product p ON p.ProductID=i.ProductID JOIN Category c ON c.CategoryID=p.CategoryID WHERE w.CompanyID=:companyId AND w.Status='Active' AND c.Category='Cylinder' GROUP BY i.WarehouseID,i.ProductID",{companyId:req.user.companyId});
    await conn.commit();res.json({warehouses,products,inventoryStocks});
  } catch(e){await conn.rollback();throw e;}finally{conn.release();}
}));
router.put('/:id',asyncHandler(async(req,res)=>{
  if(!life.operator(req.user)) throw new ApiError(403,'Management access required.');
  if(Object.keys(req.body).some(k=>!['deliveredByUserId','remarks'].includes(k))) throw new ApiError(400,'Only assigned driver and notes may be edited.');
  const conn=await pool.getConnection();
  try {
    await conn.beginTransaction();
    const {row}=await life.context(conn,req.user,req.params.id);
    if(['Delivered','Cancelled','Delivery Failed'].includes(row.DeliveryStatus)) throw new ApiError(409,'Terminal deliveries cannot be edited.');
    const rider=Object.hasOwn(req.body,'deliveredByUserId')?req.body.deliveredByUserId:row.DeliveredByUserID;
    const remarks=Object.hasOwn(req.body,'remarks')?req.body.remarks:row.Remarks;
    if(remarks!=null && (typeof remarks!=='string' || remarks.length>255)) throw new ApiError(400,'Notes must be at most 255 characters.');
    if(rider) {
      const [drivers]=await conn.query("SELECT u.UserID FROM User u JOIN Role r ON r.RoleID=u.RoleID WHERE u.UserID=:rider AND u.CompanyID=:companyId AND u.Status='Active' AND LOWER(r.RoleName) IN ('driver','drivers') FOR UPDATE",{rider,companyId:req.user.companyId});
      if(!drivers.length) throw new ApiError(400,'Select an active driver in your company.');
    }
    if(!rider && row.DeliveryStatus==='Out for Delivery') throw new ApiError(409,'An active delivery requires a driver.');
    await conn.query('UPDATE Delivery SET DeliveredByUserID=:rider,Remarks=:remarks WHERE DeliveryID=:id',{id:req.params.id,rider:rider||null,remarks:remarks||null});
    await life.audit(conn,req.user,row,'Assignment / notes',{driverId:rider,notes:remarks});
    await conn.commit();res.json({message:'Delivery updated.'});
  }catch(e){await conn.rollback();throw e;}finally{conn.release();}
}));
router.get('/:id/settlement',asyncHandler(async(req,res)=>res.json(await life.quote(pool,req.user,req.params.id))));
router.post('/:id/:action',asyncHandler(async(req,res)=>{
  if(!['dispatch','complete','fail','settle','cancel'].includes(req.params.action)) throw new ApiError(404,'Unknown delivery action.');
  res.json(await life.execute(pool,req.user,req.params.id,req.params.action,req.body));
}));
module.exports=router;
