const ApiError = require("./apiError");
const { calculateRefund } = require("./financialRules");
const { recordStockIn } = require("./inventoryMovements");
const enabled = value => [true,1,"1","true"].includes(value);
function requirePermission(user) {
  if (!["admin","administrator","manager","operations supervisor"].includes(String(user.roleName).trim().toLowerCase())) throw new ApiError(403,"Only administrators and managers can settle pickups.");
}
function validatePayout(body) {
  const {refundMethod,accountName,accountNumber,payoutReferenceNo} = body;
  if (!["GCash","Card","Bank Transfer"].includes(refundMethod)) throw new ApiError(400,"Choose GCash, Card, or Bank Transfer.");
  if (typeof accountName !== "string" || !accountName.trim() || accountName.trim().length > 150) throw new ApiError(400,"Enter an account name (maximum 150 characters).");
  // Keep the value a string from input to database; never coerce account numbers.
  if (typeof accountNumber !== "string") throw new ApiError(400,"Account/mobile number must be a string.");
  const number=accountNumber.trim();
  const valid = refundMethod === "GCash" ? /^(09[0-9]{9}|[+]639[0-9]{9})$/.test(number) : refundMethod === "Card" ? /^[0-9]{12,19}$/.test(number) : /^[0-9]{6,34}$/.test(number);
  if (!valid) throw new ApiError(400, refundMethod === "GCash" ? "GCash requires an 11-digit 09 mobile number or +639 format." : refundMethod === "Card" ? "Card account number must contain 12 to 19 digits." : "Bank account number must contain 6 to 34 digits.");
  if (payoutReferenceNo != null && (typeof payoutReferenceNo !== "string" || payoutReferenceNo.trim().length > 50)) throw new ApiError(400,"Payout reference must be a string of at most 50 characters.");
  return {refundMethod,accountName:accountName.trim(),accountNumber:number,payoutReferenceNo:payoutReferenceNo?.trim() || null};
}
function financials(paid, settings) {
  if (!enabled(settings.AllowIssueRefund)) throw new ApiError(409,"Refunds are disabled in Financial & Tax Rules.");
  const normalized={...settings,AllowIssueRefund:true,EnableCancellationFee:enabled(settings.EnableCancellationFee)};
  if (normalized.EnableCancellationFee && (!["Fixed","Percentage"].includes(settings.CancellationFeeType) || !Number.isFinite(Number(settings.CancellationFeeValue)) || Number(settings.CancellationFeeValue)<0 || (settings.CancellationFeeType==="Percentage" && Number(settings.CancellationFeeValue)>100))) throw new ApiError(409,"Invalid cancellation fee configuration.");
  return calculateRefund(paid,normalized,true);
}
async function context(conn,user,orderId) {
  requirePermission(user);
  const [orders]=await conn.query(`SELECT o.*, o.customer_name AS CustomerName FROM \`Order\` o LEFT JOIN Customer c ON c.CustomerID=o.CustomerID
    WHERE o.OrderID=:orderId AND o.OrderType='Pickup' AND EXISTS (SELECT 1 FROM Sales s JOIN UserHistory u ON u.UserID=s.UserID WHERE s.OrderID=o.OrderID AND u.CompanyID=:companyId) FOR UPDATE`, {orderId,companyId:user.companyId});
  const order=orders[0];
  if (!order) throw new ApiError(404,"Pickup order not found.");
  const [existing]=await conn.query("SELECT OrderID FROM PickupSettlement WHERE OrderID=:orderId",{orderId});
  if (existing.length || !Number(order.PickupSettlementPending)) throw new ApiError(409,"Order is already settled or has no pending settlement.");
  if (!["Unclaimed","Cancelled"].includes(order.PickupStatus)) throw new ApiError(409,"Only Unclaimed or Cancelled pickups can be settled.");
  const [refunds]=await conn.query("SELECT RefundID FROM RefundLedger WHERE OrderID=:orderId",{orderId});
  if (refunds.length) throw new ApiError(409,"A refund already exists for this order; review before settlement.");
  const [payments]=await conn.query(`SELECT p.AmountPaid FROM Payment p JOIN Sales s ON s.SaleID=p.SaleID
    WHERE s.OrderID=:orderId AND p.PaymentType='Sale' FOR UPDATE`,{orderId});
  const cents=payments.reduce((sum,p)=>sum+Math.round(Number(p.AmountPaid)*100),0);
  const paid=cents/100;
  if (!Number.isSafeInteger(cents) || paid < Number(order.TotalAmount)) throw new ApiError(409,"Pickup must be fully paid before settlement.");
  const [rows]=await conn.query("SELECT * FROM CompanySettings WHERE CompanyID=:companyId FOR UPDATE",{companyId:user.companyId});
  if (!rows[0]) throw new ApiError(409,"Financial settings are missing.");
  return {order,settings:rows[0],...financials(paid,rows[0])};
}
async function restoreOrderInventory(conn,user,order) {
  const [items]=await conn.query("SELECT ProductID, Quantity FROM OrderDetails WHERE OrderID=:orderId FOR UPDATE",{orderId:order.OrderID});
  const [movements]=await conn.query(`SELECT t.InventoryID, i.ProductID, w.CompanyID, t.Quantity FROM InventoryTransaction t
    JOIN Inventory i ON i.InventoryID=t.InventoryID JOIN Warehouse w ON w.WarehouseID=i.WarehouseID
    WHERE t.ReferenceNo=:orderNo AND t.TransactionType='Stock Out' AND t.Reason='Sale'
    ORDER BY t.InventoryID, t.TransactionID FOR UPDATE`,{orderNo:order.OrderNo});
  const expected=new Map(),actual=new Map(),inventory=new Map();
  for (const item of items) expected.set(item.ProductID,(expected.get(item.ProductID)||0)+Number(item.Quantity));
  for (const movement of movements) {
    if (movement.CompanyID!==user.companyId || !Number.isSafeInteger(Number(movement.Quantity)) || Number(movement.Quantity)<=0) throw new ApiError(409,"Invalid original stock movement; inventory review required.");
    actual.set(movement.ProductID,(actual.get(movement.ProductID)||0)+Number(movement.Quantity));
    inventory.set(movement.InventoryID,(inventory.get(movement.InventoryID)||0)+Number(movement.Quantity));
  }
  if (!expected.size || expected.size!==actual.size || [...expected].some(([id,qty])=>!Number.isSafeInteger(qty) || qty<=0 || actual.get(id)!==qty)) throw new ApiError(409,"Original stock movements do not match ordered quantities. Review required; no stock was restored.");
  for (const [inventoryId,quantity] of inventory) await recordStockIn(conn,{inventoryId,quantity,userId:user.userId,
    reason:order.PickupStatus === "Unclaimed" ? "Pickup Unclaimed" : "Pickup Cancellation",referenceNo:"SETTLE-"+order.OrderID,remarks:"Restock & Settle "+order.OrderNo});
}
async function settle(pool,user,orderId,body) {
  requirePermission(user);
  const payout=validatePayout(body);
  const conn=await pool.getConnection();
  try {
    await conn.beginTransaction();
    const data=await context(conn,user,orderId);
    if (!body.quote || ["eligibleAmount","cancellationFee","refundAmount"].some(key=>typeof body.quote[key]!=="number" || body.quote[key]!==data[key])) throw new ApiError(409,"Settlement amounts changed. Reload and review the latest quote.");
    await restoreOrderInventory(conn,user,data.order);
    const params={orderId,companyId:user.companyId,userId:user.userId,orderNo:data.order.OrderNo,resolvedStatus:data.order.PickupStatus,
      ...payout,eligibleAmount:data.eligibleAmount,cancellationFee:data.cancellationFee,refundAmount:data.refundAmount,
      feeEnabled:Number(enabled(data.settings.EnableCancellationFee)),feeType:data.settings.CancellationFeeType,feeValue:Number(data.settings.CancellationFeeValue)};
    await conn.query(`INSERT INTO PickupSettlement (OrderID,CompanyID,OrderNo,UserID,ResolvedStatus,OriginalPaidAmount,CancellationFee,NetRefundAmount,FeeEnabled,FeeType,FeeValue,RefundMethod,AccountName,AccountNumber,PayoutReferenceNo)
      VALUES (:orderId,:companyId,:orderNo,:userId,:resolvedStatus,:eligibleAmount,:cancellationFee,:refundAmount,:feeEnabled,:feeType,:feeValue,:refundMethod,:accountName,:accountNumber,:payoutReferenceNo)`,params);
    await conn.query(`INSERT INTO RefundLedger (CompanyID,OrderID,UserID,Reason,EligibleAmount,FeeType,FeeValue,CancellationFee,RefundAmount)
      VALUES (:companyId,:orderId,:userId,:resolvedStatus,:eligibleAmount,:feeType,:feeValue,:cancellationFee,:refundAmount)`,params);
    await conn.query("UPDATE `Order` SET PickupSettlementPending=0 WHERE OrderID=:orderId",{orderId});
    await conn.commit();
    return {orderId,resolvedStatus:data.order.PickupStatus,originalPaidAmount:data.eligibleAmount,fee:data.cancellationFee,netRefundAmount:data.refundAmount};
  } catch(err) {await conn.rollback();if(err.code==="ER_DUP_ENTRY") throw new ApiError(409,"Order has already been settled.");throw err;} finally {conn.release();}
}
async function quote(pool,user,orderId) {
  requirePermission(user);
  const conn=await pool.getConnection();
  try {
    await conn.beginTransaction();
    const data=await context(conn,user,orderId);
    await conn.commit();
    return {eligibleAmount:data.eligibleAmount,cancellationFee:data.cancellationFee,refundAmount:data.refundAmount,accountName:data.order.CustomerName || ""};
  } catch(err) {await conn.rollback();throw err;} finally {conn.release();}
}
module.exports={validatePayout,financials,quote,settle,restoreOrderInventory};
