// Explicit, evidence-based repair of a legacy COD completion. Never reruns fulfillment or stock changes.
const pool=require('../config/db');
const {createHash}=require('crypto');
const {audit}=require('../utils/deliveryLifecycle');
async function reconcile(orderNo) {
  if(!orderNo) throw new Error('Specify the order number to reconcile.');
  const conn=await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows]=await conn.query(`SELECT d.*,o.OrderNo,o.TotalAmount,u.CompanyID FROM Delivery d
      JOIN Sales s ON s.SaleID=d.SaleID JOIN User u ON u.UserID=s.UserID JOIN \`Order\` o ON o.OrderID=s.OrderID
      WHERE o.OrderNo=:orderNo FOR UPDATE`,{orderNo});
    const row=rows[0];
    if(!row || row.PaymentMethod!=='Cash on Delivery' || row.DeliveryStatus!=='Delivered') throw new Error('Requires a delivered COD order.');
    const [actions]=await conn.query("SELECT UserID,Details FROM DeliveryAction WHERE DeliveryID=:id AND Action='complete' ORDER BY CreatedAt",{id:row.DeliveryID});
    if(actions.length!==1) throw new Error('Requires exactly one saved completion record.');
    const details=typeof actions[0].Details==='string'?JSON.parse(actions[0].Details):actions[0].Details;
    const collected=details.amountCollected;
    if(typeof collected!=='number' || !Number.isFinite(collected) || collected<Number(row.TotalAmount)) throw new Error('Completion record does not prove full collection; manual verification required.');
    const [payments]=await conn.query("SELECT AmountPaid FROM Payment WHERE SaleID=:saleId AND PaymentType='Sale' FOR UPDATE",{saleId:row.SaleID});
    const paid=payments.reduce((sum,p)=>sum+Math.round(Number(p.AmountPaid)*100),0);
    const balance=Math.max(0,Math.round(Number(row.TotalAmount)*100)-paid)/100;
    if(!balance) {await conn.commit();return {orderNo,alreadyPaid:true};}
    const paymentId='COD-'+createHash('sha256').update(row.DeliveryID).digest('hex').slice(0,16);
    await conn.query(`INSERT INTO Payment(PaymentID,PaymentType,SaleID,PaymentMethod,AmountPaid,ReferenceNo,Remarks)
      VALUES(:paymentId,'Sale',:saleId,'Cash on Delivery',:balance,:orderNo,'Reconciled from saved delivery collection audit')`,{paymentId,saleId:row.SaleID,balance,orderNo});
    const repair={paymentId,amount:balance,source:'Saved completion collection',recordedBy:actions[0].UserID};
    await conn.query(`INSERT INTO DeliveryAction(DeliveryID,RequestID,RequestHash,UserID,Action,Details)
      VALUES(:id,'reconcile-cod-v1',:hash,:userId,'payment-reconciliation',:details)`,{id:row.DeliveryID,hash:createHash('sha256').update(JSON.stringify(repair)).digest('hex'),userId:actions[0].UserID,details:JSON.stringify(repair)});
    await audit(conn,{userId:actions[0].UserID},row,'Reconciled recorded COD collection',repair);
    await conn.commit();return {orderNo,paymentId,amount:balance,paymentStatus:'Paid'};
  }catch(error){await conn.rollback();throw error;}finally{conn.release();}
}
if(require.main===module) reconcile(process.argv[2]).then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(error.message);process.exitCode=1;}).finally(()=>pool.end());
module.exports=reconcile;
