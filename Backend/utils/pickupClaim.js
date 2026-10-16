const {createHash}=require("crypto");
const ApiError=require("./apiError");
const {expiration}=require("./pickupLifecycle");
const {receiveEmptyCylinders}=require("./inventoryMovements");
function validateClaim(body) {
  if(typeof body.emptyCylinderReturned!=="boolean")throw new ApiError(400,"Answer Empty Cylinder Returned? Yes or No.");
  const items=body.returnedCylinders ?? [];
  if(!Array.isArray(items))throw new ApiError(400,"Returned cylinders must be an array.");
  if(!body.emptyCylinderReturned && items.length)throw new ApiError(400,"No cannot include cylinder returns.");
  if(body.emptyCylinderReturned && (!items.length || typeof body.warehouseId!=="string" || !body.warehouseId.trim()))throw new ApiError(400,"Yes requires a warehouse and at least one cylinder.");
  const quantities=new Map();
  for(const item of items){
    if(typeof item.productId!=="string" || !item.productId.trim() || !Number.isSafeInteger(item.qty) || item.qty<=0 || item.qty>2147483647)throw new ApiError(400,"Choose valid cylinder products and positive whole-number quantities.");
    const id=item.productId.trim(),qty=(quantities.get(id)||0)+item.qty;
    if(qty>2147483647)throw new ApiError(400,"Cylinder quantity is too large.");
    quantities.set(id,qty);
  }
  const request={emptyCylinderReturned:body.emptyCylinderReturned,warehouseId:body.emptyCylinderReturned?body.warehouseId.trim():null,items:[...quantities].sort(([a],[b])=>a.localeCompare(b)).map(([productId,qty])=>({productId,qty}))};
  return {...request,hash:createHash("sha256").update(JSON.stringify(request)).digest("hex")};
}
async function complete(pool,user,orderId,body) {
  const input=validateClaim(body);
  const conn=await pool.getConnection();
  let committed=false;
  try {
    await conn.beginTransaction();
    const [orders]=await conn.query(`SELECT o.* FROM \`Order\` o WHERE o.OrderID=:orderId AND o.OrderType='Pickup'
      AND EXISTS (SELECT 1 FROM Sales s JOIN UserHistory u ON u.UserID=s.UserID WHERE s.OrderID=o.OrderID AND u.CompanyID=:companyId) FOR UPDATE`,{orderId,companyId:user.companyId});
    const order=orders[0];if(!order)throw new ApiError(404,"Pickup order not found.");
    const [claims]=await conn.query("SELECT * FROM PickupClaim WHERE OrderID=:orderId",{orderId});
    if(claims[0]) {
      if(order.PickupStatus!=="Completed" || claims[0].RequestHash!==input.hash)throw new ApiError(409,"This pickup was already claimed with different return details.");
      await conn.commit();committed=true;
      return {status:"Completed",saleId:claims[0].SaleID,emptyCylinderReference:claims[0].ReturnReferenceNo,alreadyCompleted:true};
    }
    if(order.PickupStatus!=="Ready for Pickup" || Number(order.PickupSettlementPending))throw new ApiError(409,"Only Ready for Pickup orders can be claimed.");
    const [settings]=await conn.query("SELECT * FROM CompanySettings WHERE CompanyID=:companyId FOR UPDATE",{companyId:user.companyId});
    if(!settings[0] || !order.PickupScheduledAt)throw new ApiError(409,"Pickup schedule or settings are missing; manual review required.");
    if(new Date()>=expiration(order.PickupScheduledAt,settings[0])) {
      await conn.query("UPDATE `Order` SET PickupStatus='Unclaimed',OrderStatus='Unclaimed',PickupSettlementPending=1 WHERE OrderID=:orderId",{orderId});
      await conn.commit();committed=true;throw new ApiError(409,"Pickup expired. Restock & Settle is required.");
    }
    // Checkout already created the sale/payment. Finalize that same transaction.
    const [sales]=await conn.query("SELECT s.* FROM Sales s JOIN UserHistory u ON u.UserID=s.UserID WHERE s.OrderID=:orderId AND u.CompanyID=:companyId FOR UPDATE",{orderId,companyId:user.companyId});
    if(sales.length!==1 || Number(sales[0].TotalAmount)!==Number(order.TotalAmount))throw new ApiError(409,"Expected one matching prepaid sale; review required.");
    const sale=sales[0];
    const [payments]=await conn.query("SELECT AmountPaid,ReferenceNo FROM Payment WHERE SaleID=:saleId AND PaymentType='Sale' FOR UPDATE",{saleId:sale.SaleID});
    const paid=payments.reduce((sum,p)=>sum+Math.round(Number(p.AmountPaid)*100),0);
    if(!Number.isSafeInteger(paid) || paid<Math.round(Number(order.TotalAmount)*100))throw new ApiError(409,"Pickup must be fully paid before claim.");
    const [refunds]=await conn.query("SELECT RefundID FROM RefundLedger WHERE OrderID=:orderId",{orderId});
    if(refunds.length)throw new ApiError(409,"A refunded pickup cannot be claimed.");
    let reference=null;
    if(input.emptyCylinderReturned)reference=await receiveEmptyCylinders(conn,{companyId:user.companyId,userId:user.userId,warehouseId:input.warehouseId,items:input.items});
    await conn.query(`INSERT INTO PickupClaim (OrderID,SaleID,UserID,WarehouseID,EmptyCylinderReturned,ReturnReferenceNo,RequestHash)
      VALUES (:orderId,:saleId,:userId,:warehouseId,:returned,:reference,:hash)`,{orderId,saleId:sale.SaleID,userId:user.userId,warehouseId:input.warehouseId,returned:Number(input.emptyCylinderReturned),reference,hash:input.hash});
    await conn.query("UPDATE `Order` SET PickupStatus='Completed',OrderStatus='Completed',PickupSettlementPending=0 WHERE OrderID=:orderId",{orderId});
    await conn.commit();committed=true;
    return {status:"Completed",saleId:sale.SaleID,saleNo:sale.SaleNo,emptyCylinderReference:reference,alreadyCompleted:false};
  }catch(err){if(!committed)await conn.rollback();throw err;}finally{conn.release();}
}
module.exports={validateClaim,complete};
