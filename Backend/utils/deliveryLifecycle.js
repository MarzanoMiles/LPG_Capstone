const {createHash, randomBytes} = require('crypto');
const ApiError = require('./apiError');
const {validateClaim} = require('./pickupClaim');
const {receiveEmptyCylinders, recordStockIn} = require('./inventoryMovements');
const {financials, validatePayout} = require('./pickupSettlement');
const driver = user => ['driver','drivers'].includes(String(user.roleName).trim().toLowerCase());
const manager = user => ['admin','administrator','manager','operations supervisor'].includes(String(user.roleName).trim().toLowerCase());
const operator = user => manager(user) || ['assistant operations supervisor','store supervisor','assistant store supervisor','cashier','staff'].includes(String(user.roleName).trim().toLowerCase());
const enabled = value => [true,1,'1','true'].includes(value);
function nextAttempt(settings, now = new Date()) {
  const days=String(settings.BusinessDays || '').split(',').map(d=>d.trim());
  const names=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  if (!days.some(d=>names.includes(d)) || !settings.OpeningTime || !settings.ClosingTime || settings.OpeningTime >= settings.ClosingTime) throw new ApiError(409,'Configure business days and operating hours in Settings.');
  const local=new Date(now.getTime()+8*3600000);
  // A failed attempt schedules the next business day at opening time.
  for(let i=0;i<7;i++) {
    local.setUTCDate(local.getUTCDate()+1);
    if(days.includes(names[local.getUTCDay()])) return local.toISOString().slice(0,10)+' '+settings.OpeningTime;
  }
}
function transition(row, action, max) {
  if (!Number.isInteger(max) || max<1) throw new ApiError(409,'Configure maximum delivery attempts in Settings.');
  if (['Cancelled','Completed','Delivery Failed'].includes(row.OrderStatus) || ['Delivered','Cancelled','Delivery Failed'].includes(row.DeliveryStatus) || Number(row.AttemptCount)>=max) throw new ApiError(409,'Delivery is terminal or has reached maximum attempts.');
  if(action==='dispatch') {
    if(!row.DeliveredByUserID || !['Preparing','Failed Attempt'].includes(row.DeliveryStatus)) throw new ApiError(409,'Dispatch requires an assigned driver and an eligible delivery.');
    return 'Out for Delivery';
  }
  if(!['complete','fail'].includes(action) || !['Out for Delivery','Failed Attempt'].includes(row.DeliveryStatus)) throw new ApiError(409,'Delivery is not active.');
  // A retry must be dispatched before another failure can be logged.
  if(action==='fail' && row.DeliveryStatus!=='Out for Delivery') throw new ApiError(409,'Dispatch the retry before logging another failed attempt.');
  return action==='complete'?'Delivered':'Failed Attempt';
}
async function context(conn,user,id) {
  const [rows]=await conn.query(`SELECT d.*,o.OrderID,o.OrderNo,o.OrderStatus,o.TotalAmount,o.customer_name AS CustomerName FROM Delivery d
    JOIN Sales s ON s.SaleID=d.SaleID JOIN User owner ON owner.UserID=s.UserID
    JOIN \`Order\` o ON o.OrderID=s.OrderID LEFT JOIN Customer c ON c.CustomerID=o.CustomerID
    WHERE d.DeliveryID=:id AND owner.CompanyID=:companyId FOR UPDATE`,{id,companyId:user.companyId});
  const row=rows[0];
  if(!row) throw new ApiError(404,'Delivery not found.');
  if(driver(user) && row.DeliveredByUserID!==user.userId) throw new ApiError(403,'Delivery is not assigned to you.');
  if(!driver(user) && !operator(user)) throw new ApiError(403,'Delivery access denied.');
  const [settings]=await conn.query('SELECT * FROM CompanySettings WHERE CompanyID=:companyId FOR UPDATE',{companyId:user.companyId});
  if(!settings[0]) throw new ApiError(409,'Company settings are missing.');
  const [payments]=await conn.query("SELECT AmountPaid,PaymentMethod FROM Payment WHERE SaleID=:saleId AND PaymentType='Sale' FOR UPDATE",{saleId:row.SaleID});
  if(!row.PaymentMethod) {
    const methods=[...new Set(payments.map(payment=>payment.PaymentMethod).filter(Boolean))];
    if(methods.length===1) row.PaymentMethod=methods[0];
  }
  const paid=payments.reduce((sum,p)=>sum+Math.round(Number(p.AmountPaid)*100),0)/100;
  return {row,settings:settings[0],paid};
}
async function audit(conn,user,row,action,details) {
  await conn.query(`INSERT INTO UserActivity(UserActivityID,UserID,ActivityType,Module,RecordID,Description)
    VALUES(:uid,:userId,'Update','Order and Delivery — Delivery Management',:id,:description)`,{
    uid:await require('./entityIds').nextEntityId(conn,'UserActivity'),userId:user.userId,id:row.DeliveryID,description:(({dispatch:'Dispatched a delivery.',complete:'Completed a delivery.',fail:'Recorded a failed delivery attempt.',settle:'Settled a delivery.',cancel:'Cancelled a delivery.',Restock:'Restored delivery stock to inventory.','Assignment / notes':'Updated the delivery driver or notes.'})[action] || 'Updated delivery details.')+(action==='fail' && details.reason ? ` Reason: ${details.reason}.` : '')});
}
async function restore(conn,user,row) {
  if(row.RestockedAt) return;
  const [items]=await conn.query('SELECT ProductID,Quantity FROM OrderDetails WHERE OrderID=:orderId FOR UPDATE',{orderId:row.OrderID});
  const [movements]=await conn.query(`SELECT t.InventoryID,i.ProductID,w.CompanyID,t.TransactionType,t.Quantity,t.ReferenceNo
    FROM InventoryTransaction t JOIN Inventory i ON i.InventoryID=t.InventoryID JOIN Warehouse w ON w.WarehouseID=i.WarehouseID
    WHERE (t.ReferenceNo=:orderNo AND t.TransactionType='Stock Out' AND t.Reason='Sale')
      OR (t.ReferenceNo IN (:settleRef,:cancelRef,:deliveryRef) AND t.TransactionType='Stock In')
    ORDER BY t.InventoryID,t.TransactionID FOR UPDATE`,{orderNo:row.OrderNo,settleRef:'SETTLE-'+row.OrderID,cancelRef:'CANCEL-ORDER-'+row.OrderID,deliveryRef:'DEL-RESTOCK-'+row.DeliveryID});
  const expected=new Map(),deducted=new Map(),inventory=new Map();
  for(const item of items) expected.set(item.ProductID,(expected.get(item.ProductID)||0)+Number(item.Quantity));
  for(const move of movements) {
    const quantity=Number(move.Quantity);
    if(move.CompanyID!==user.companyId || !Number.isSafeInteger(quantity) || quantity<=0) throw new ApiError(409,'Invalid original stock movement; inventory review required.');
    if(move.TransactionType==='Stock Out') deducted.set(move.ProductID,(deducted.get(move.ProductID)||0)+quantity);
    inventory.set(move.InventoryID,(inventory.get(move.InventoryID)||0)+(move.TransactionType==='Stock Out'?quantity:-quantity));
  }
  if([...deducted].some(([product,qty])=>!expected.has(product)||qty>expected.get(product)) || [...inventory.values()].some(qty=>qty<0)) throw new ApiError(409,'Stock movement history is inconsistent; inventory review required.');
  for(const [inventoryId,quantity] of inventory) if(quantity) await recordStockIn(conn,{inventoryId,quantity,userId:user.userId,reason:'Delivery Restock',referenceNo:'DEL-RESTOCK-'+row.DeliveryID,remarks:row.OrderNo});
  await conn.query('UPDATE Delivery SET RestockedAt=NOW() WHERE DeliveryID=:id',{id:row.DeliveryID});
  row.RestockedAt=true;
  await audit(conn,user,row,'Restock',{orderId:row.OrderID});
}
async function settlementData(conn,user,id) {
  if(!manager(user)) throw new ApiError(403,'Only administrators and managers can settle deliveries.');
  const data=await context(conn,user,id), {row,settings,paid}=data;
  if(paid<Number(row.TotalAmount) || !['Cancelled','Delivery Failed'].includes(row.DeliveryStatus) || Number(row.AttemptCount)<Number(settings.MaxDeliveryAttempts) || row.SettledAt) throw new ApiError(409,'No pending final-failure settlement.');
  const amounts=enabled(settings.AllowIssueRefund)?financials(paid,settings):{eligibleAmount:paid,cancellationFee:0,refundAmount:0};
  return {...data,...amounts,refundEnabled:enabled(settings.AllowIssueRefund),accountName:row.CustomerName};
}
async function quote(pool,user,id) {
  const conn=await pool.getConnection();
  try {await conn.beginTransaction();const data=await settlementData(conn,user,id);await conn.commit();return {eligibleAmount:data.eligibleAmount,cancellationFee:data.cancellationFee,refundAmount:data.refundAmount,refundEnabled:data.refundEnabled,accountName:data.accountName,restocked:!!data.row.RestockedAt};}
  catch(e){await conn.rollback();throw e;}finally{conn.release();}
}
async function execute(pool,user,id,action,body) {
  if(!operator(user) && !driver(user)) throw new ApiError(403,'Delivery access denied.');
  if(driver(user) && !['complete','fail'].includes(action)) throw new ApiError(403,'Drivers may only confirm delivery or log failed attempts.');
  if(typeof body.requestId!=='string' || !/^[\w-]{8,64}$/.test(body.requestId)) throw new ApiError(400,'A unique requestId is required.');
  const hash=createHash('sha256').update(JSON.stringify({action,...body})).digest('hex');
  const conn=await pool.getConnection();
  try {
    await conn.beginTransaction();
    const {row,settings,paid}=await context(conn,user,id);
    const [previous]=await conn.query('SELECT RequestHash FROM DeliveryAction WHERE DeliveryID=:id AND RequestID=:requestId',{id,requestId:body.requestId});
    if(previous[0]) {
      if(previous[0].RequestHash!==hash) throw new ApiError(409,'Request ID was already used with different details.');
      await conn.commit();return {alreadyApplied:true};
    }
    let status=row.DeliveryStatus,details={};
    if(action==='cancel') {
      if(!['Preparing','Failed Attempt'].includes(row.DeliveryStatus)) throw new ApiError(409,'Only preparing or pending-retry deliveries may be cancelled.');
      if(paid>0) throw new ApiError(409,'Prepaid delivery cancellation requires authorized financial review.');
      await restore(conn,user,row);
      status='Cancelled';
      await conn.query("UPDATE Delivery SET DeliveryStatus='Cancelled',NextAttemptAt=NULL WHERE DeliveryID=:id",{id});
      await conn.query("UPDATE `Order` SET OrderStatus='Cancelled' WHERE OrderID=:orderId",{orderId:row.OrderID});
    } else if(action==='settle') {
      const data=await settlementData(conn,user,id);
      if(!body.quote || ['eligibleAmount','cancellationFee','refundAmount'].some(k=>body.quote[k]!==data[k])) throw new ApiError(409,'Settlement quote changed; review again.');
      await restore(conn,user,row);
      if(data.refundEnabled) {
        const payout=validatePayout(body);
        await conn.query(`INSERT INTO RefundLedger(CompanyID,OrderID,UserID,Reason,EligibleAmount,FeeType,FeeValue,CancellationFee,RefundAmount)
          VALUES(:companyId,:orderId,:userId,'Delivery Failed',:eligibleAmount,:feeType,:feeValue,:cancellationFee,:refundAmount)`,{
          companyId:user.companyId,orderId:row.OrderID,userId:user.userId,...data,feeType:settings.CancellationFeeType,feeValue:settings.CancellationFeeValue});
        details={...payout,eligibleAmount:data.eligibleAmount,cancellationFee:data.cancellationFee,refundAmount:data.refundAmount,feeType:settings.CancellationFeeType,feeValue:settings.CancellationFeeValue};
      } else details={resolution:'Manager settlement without refund',refundAmount:0};
      await conn.query('UPDATE Delivery SET SettledAt=NOW() WHERE DeliveryID=:id',{id});
    } else {
      status=transition(row,action,Number(settings.MaxDeliveryAttempts));
      if(action==='dispatch') {
        await conn.query('UPDATE Delivery SET DeliveryStatus=:status,NextAttemptAt=NULL WHERE DeliveryID=:id',{id,status});
      } else if(action==='complete') {
        if(!row.PaymentMethod) throw new ApiError(409,'Delivery payment method is missing. Resolve the payment method before confirming delivery.');
        const input=validateClaim(body);
        if(body.amountCollected!==undefined && (typeof body.amountCollected!=='number' || !Number.isFinite(body.amountCollected) || body.amountCollected<0 || body.amountCollected>9999999999.99 || Math.abs(body.amountCollected*100-Math.round(body.amountCollected*100))>0.0001)) throw new ApiError(400,'Amount collected must be nonnegative with at most two decimal places.');
        let paymentId=null,changeDue=0;
        if(row.PaymentMethod==='Cash on Delivery') {
          const outstanding=Math.max(0,Math.round(Number(row.TotalAmount)*100)-Math.round(paid*100));
          const collected=Math.round((body.amountCollected ?? 0)*100);
          if(collected<outstanding) throw new ApiError(400,'Amount collected must cover the outstanding COD balance before confirming delivery.');
          if(outstanding>0) {
            // One payment per delivery, committed atomically with completion and its journal.
            paymentId='COD-'+createHash('sha256').update(row.DeliveryID).digest('hex').slice(0,16);
            await conn.query(`INSERT INTO Payment(PaymentID,PaymentType,SaleID,PaymentMethod,AmountPaid,ReferenceNo,Remarks)
              VALUES(:paymentId,'Sale',:saleId,'Cash on Delivery',:amount,:reference,:remarks)`,{
              paymentId,saleId:row.SaleID,amount:outstanding/100,reference:row.OrderNo,remarks:'COD collected on delivery by '+user.userId});
          }
          changeDue=(collected-outstanding)/100;
        } else if(Number(body.amountCollected)>0) throw new ApiError(400,'Only Cash on Delivery orders can collect payment during delivery confirmation.');
        const reference=input.emptyCylinderReturned?await receiveEmptyCylinders(conn,{companyId:user.companyId,userId:user.userId,warehouseId:input.warehouseId,items:input.items}):null;
        details={...input,returnReference:reference,amountCollected:body.amountCollected ?? null,paymentId,changeDue};
        await conn.query('UPDATE Delivery SET DeliveryStatus=:status,DeliveryDate=NOW(),NextAttemptAt=NULL WHERE DeliveryID=:id',{id,status});
        await conn.query("UPDATE `Order` SET OrderStatus='Completed' WHERE OrderID=:orderId",{orderId:row.OrderID});
      } else {
        const reasons=['Recipient Unavailable / No One to Receive','Customer Unreachable','Insufficient Cash on Hand (COD Unpaid)','Premises Inaccessible','Severe Weather / Flooding / Impassable Road','Item Damaged in Transit','Other (Specify in Notes)'];
        if(body.reason!==undefined && !reasons.includes(body.reason)) throw new ApiError(400,'Select a valid failed-attempt reason.');
        if(typeof body.notes!=='string' || body.notes.length>2000) throw new ApiError(400,'Attempt details must be at most 2000 characters.');
        if(!body.notes.trim() && (!body.reason || body.reason==='Other (Specify in Notes)')) throw new ApiError(400,'Provide failed-attempt details; notes are required when selecting Other.');
        const attempts=Number(row.AttemptCount)+1, final=attempts>=Number(settings.MaxDeliveryAttempts);
        status=final?(paid>=Number(row.TotalAmount)?'Delivery Failed':'Cancelled'):'Failed Attempt';
        const scheduled=final?null:nextAttempt(settings);
        await conn.query('UPDATE Delivery SET DeliveryStatus=:status,AttemptCount=:attempts,NextAttemptAt=:scheduled WHERE DeliveryID=:id',{id,status,attempts,scheduled});
        if(final) {
          await conn.query('UPDATE `Order` SET OrderStatus=:status WHERE OrderID=:orderId',{orderId:row.OrderID,status});
          await restore(conn,user,row);
        }
        details={reason:body.reason || null,notes:body.notes.trim(),attempts,nextAttemptAt:scheduled,status};
      }
    }
    await conn.query(`INSERT INTO DeliveryAction(DeliveryID,RequestID,RequestHash,UserID,Action,Details) VALUES(:id,:requestId,:hash,:userId,:action,:details)`,{id,requestId:body.requestId,hash,userId:user.userId,action,details:JSON.stringify(details)});
    await audit(conn,user,row,action,details);
    await conn.commit();return {status};
  } catch(e){await conn.rollback();throw e;}finally{conn.release();}
}
module.exports={driver,manager,operator,nextAttempt,transition,context,execute,quote,audit};
