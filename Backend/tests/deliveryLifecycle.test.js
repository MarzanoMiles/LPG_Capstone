const {test}=require('node:test');
const assert=require('node:assert/strict');
const life=require('../utils/deliveryLifecycle');
const user={userId:'U1',companyId:'C1',roleName:'Administrator'};
const settings={MaxDeliveryAttempts:3,BusinessDays:'Monday,Tuesday,Wednesday,Thursday,Friday',OpeningTime:'08:00:00',ClosingTime:'17:00:00',AllowIssueRefund:0};
function fixture(overrides={},paid=0) {
  const row={DeliveryID:'D1',SaleID:'S1',OrderID:'O1',OrderNo:'ORD-2026-001',OrderStatus:'Preparing',DeliveryStatus:'Preparing',DeliveredByUserID:'U1',PaymentMethod:'GCash',TotalAmount:100,AttemptCount:0,...overrides};
  const queries=[];let commits=0,rollbacks=0;
  const conn={async beginTransaction(){},async commit(){commits++;},async rollback(){rollbacks++;},release(){},async query(sql,params){
    queries.push({sql,params});
    if(sql.includes('SELECT d.*'))return [[row]];
    if(sql.includes('SELECT * FROM CompanySettings'))return [[settings]];
    if(sql.includes('SELECT AmountPaid,PaymentMethod FROM Payment'))return [[{AmountPaid:paid}]];
    if(sql.includes('SELECT RequestHash'))return [[...(row.previous?[{RequestHash:row.previous}]:[])]];
    if(sql.includes('SELECT ProductID,Quantity FROM OrderDetails'))return [[{ProductID:'P1',Quantity:2}]];
    if(sql.includes('SELECT t.InventoryID'))return [[{InventoryID:'I1',ProductID:'P1',CompanyID:'C1',TransactionType:'Stock Out',Quantity:2}]];
    if(sql.includes('SELECT InventoryID FROM Inventory'))return [[{InventoryID:'I1'}]];
    return [[]];
  }};
  return {row,queries,pool:{getConnection:async()=>conn},get commits(){return commits;},get rollbacks(){return rollbacks;}};
}
test('dispatch requires driver, eligibility and remaining attempts',()=>{
  const row=fixture().row;
  assert.equal(life.transition(row,'dispatch',3),'Out for Delivery');
  for(const change of [{DeliveredByUserID:null},{AttemptCount:3},{DeliveryStatus:'Delivered'},{OrderStatus:'Cancelled'}])assert.throws(()=>life.transition({...row,...change},'dispatch',3));
});
test('retry schedules next business opening across weekends',()=>{
  assert.equal(life.nextAttempt(settings,new Date('2026-10-16T08:00:00Z')),'2026-10-19 08:00:00');
  assert.throws(()=>life.nextAttempt({...settings,BusinessDays:''}));
});
test('dispatch does not increment attempts or change payment',async()=>{
  const f=fixture();await life.execute(f.pool,user,'D1','dispatch',{requestId:'dispatch-1'});
  assert.equal(f.commits,1);assert.ok(!f.queries.some(q=>/UPDATE Payment|AttemptCount=/.test(q.sql)));
});
test('failed attempt increments exactly once and preserves assigned driver',async()=>{
  const f=fixture({DeliveryStatus:'Out for Delivery'});
  await life.execute(f.pool,user,'D1','fail',{requestId:'attempt-1',notes:'Customer unavailable'});
  const update=f.queries.find(q=>q.sql.includes('AttemptCount=:attempts'));
  assert.equal(update.params.attempts,1);assert.equal(update.params.status,'Failed Attempt');assert.ok(update.params.scheduled);
  assert.ok(!f.queries.some(q=>q.sql.includes('SET DeliveredByUserID')));
});
test('final unpaid failure cancels and restores only original warehouse stock',async()=>{
  const f=fixture({DeliveryStatus:'Out for Delivery',AttemptCount:2});
  await life.execute(f.pool,user,'D1','fail',{requestId:'attempt-3',notes:'Third failed visit'});
  assert.equal(f.queries.find(q=>q.sql.includes('AttemptCount=:attempts')).params.status,'Cancelled');
  assert.equal(f.queries.find(q=>q.sql.includes('StockOnHand = StockOnHand +')).params.qty,2);
  assert.ok(!f.queries.some(q=>/INSERT INTO RefundLedger|UPDATE Payment/.test(q.sql)));
});
test('selected failure reason accepts optional notes and is saved in the journal',async()=>{
  const f=fixture({DeliveryStatus:'Out for Delivery'});
  await life.execute(f.pool,user,'D1','fail',{requestId:'reason-only-1',reason:'Customer Unreachable',notes:''});
  const entry=f.queries.find(q=>q.sql.includes('INSERT INTO DeliveryAction'));
  assert.equal(JSON.parse(entry.params.details).reason,'Customer Unreachable');
  assert.equal(f.commits,1);
});
test('Other requires notes and invalid reasons are rejected without applying an attempt',async()=>{
  for(const reason of ['Other (Specify in Notes)','Invalid reason']) {
    const f=fixture({DeliveryStatus:'Out for Delivery'});
    await assert.rejects(life.execute(f.pool,user,'D1','fail',{requestId:'invalid-reason-1',reason,notes:''}),e=>e.statusCode===400);
    assert.ok(!f.queries.some(q=>q.sql.includes('AttemptCount=:attempts')));
  }
});
test('final paid failure preserves payment and requires explicit settlement',async()=>{
  const f=fixture({DeliveryStatus:'Out for Delivery',AttemptCount:2},100);
  await life.execute(f.pool,user,'D1','fail',{requestId:'attempt-3',notes:'Customer unavailable'});
  assert.equal(f.queries.find(q=>q.sql.includes('AttemptCount=:attempts')).params.status,'Delivery Failed');
  assert.ok(!f.queries.some(q=>/INSERT INTO RefundLedger|UPDATE Payment|SET SettledAt/.test(q.sql)));
});
test('manager can settle without refund after stock was already restored',async()=>{
  const f=fixture({DeliveryStatus:'Delivery Failed',OrderStatus:'Delivery Failed',AttemptCount:3,RestockedAt:'2026-10-15'},100);
  await life.execute(f.pool,user,'D1','settle',{requestId:'settlement-1',quote:{eligibleAmount:100,cancellationFee:0,refundAmount:0}});
  assert.ok(f.queries.some(q=>q.sql.includes('SET SettledAt')));
  assert.ok(!f.queries.some(q=>/StockOnHand = StockOnHand \+|INSERT INTO RefundLedger|UPDATE Payment/.test(q.sql)));
});
test('completion requires return answer; No changes no inventory or payment',async()=>{
  const invalid=fixture({DeliveryStatus:'Out for Delivery'});
  await assert.rejects(life.execute(invalid.pool,user,'D1','complete',{requestId:'complete-1'}));assert.equal(invalid.rollbacks,1);
  const f=fixture({DeliveryStatus:'Out for Delivery'});
  await life.execute(f.pool,user,'D1','complete',{requestId:'complete-1',emptyCylinderReturned:false});
  assert.ok(f.queries.some(q=>q.sql.includes('DeliveryDate=NOW()')));
  assert.ok(!f.queries.some(q=>/UPDATE Inventory|UPDATE Payment/.test(q.sql)));
});
test('drivers cannot manage deliveries or act on another driver assignment',async()=>{
  const f=fixture({DeliveryStatus:'Out for Delivery',DeliveredByUserID:'OTHER'});
  const driver={...user,roleName:'Drivers'};
  for(const action of ['dispatch','settle','cancel','complete','fail'])await assert.rejects(life.execute(f.pool,driver,'D1',action,{requestId:'driver-1',emptyCylinderReturned:false,notes:'No one home'}),e=>e.statusCode===403);
});
test('COD completion records only the balance, retaining excess cash as change',async()=>{
  const f=fixture({DeliveryStatus:'Out for Delivery',PaymentMethod:'Cash on Delivery'},25);
  await life.execute(f.pool,user,'D1','complete',{requestId:'cod-complete-1',emptyCylinderReturned:false,amountCollected:100});
  const payment=f.queries.find(q=>q.sql.includes('INSERT INTO Payment('));
  assert.equal(payment.params.amount,75);
  assert.match(payment.params.paymentId,/^COD-[a-f0-9]{16}$/);
  const journal=f.queries.find(q=>q.sql.includes('INSERT INTO DeliveryAction'));
  assert.equal(JSON.parse(journal.params.details).changeDue,25);
});
test('COD completion rejects missing or insufficient cash without payment or completion writes',async()=>{
  for(const amountCollected of [undefined,0,99]) {
    const f=fixture({DeliveryStatus:'Out for Delivery',PaymentMethod:'Cash on Delivery'});
    await assert.rejects(life.execute(f.pool,user,'D1','complete',{requestId:'cod-short-1',emptyCylinderReturned:false,amountCollected}),e=>e.statusCode===400);
    assert.ok(!f.queries.some(q=>q.sql.includes('INSERT INTO Payment(')||q.sql.includes('DeliveryDate=NOW()')));
  }
});
test('missing payment method cannot silently complete a legacy delivery',async()=>{
  const f=fixture({DeliveryStatus:'Out for Delivery',PaymentMethod:null});
  await assert.rejects(life.execute(f.pool,user,'D1','complete',{requestId:'missing-method-1',emptyCylinderReturned:false}),e=>e.statusCode===409);
  assert.ok(!f.queries.some(q=>q.sql.includes('DeliveryDate=NOW()')||q.sql.includes('INSERT INTO Payment(')));
});
test('idempotency key repeats no writes; conflicting payload is rejected',async()=>{
  const body={requestId:'dispatch-1'};
  const hash=require('crypto').createHash('sha256').update(JSON.stringify({action:'dispatch',...body})).digest('hex');
  const f=fixture({previous:hash});
  assert.equal((await life.execute(f.pool,user,'D1','dispatch',body)).alreadyApplied,true);
  assert.ok(!f.queries.some(q=>/UPDATE|INSERT/.test(q.sql.replace('FOR UPDATE',''))));
  await assert.rejects(life.execute(f.pool,user,'D1','dispatch',{...body,notes:'different'}),e=>e.statusCode===409);
});

test('unpaid cancellation restores original inventory once and preserves payment',async()=>{
  const f=fixture({DeliveryStatus:'Preparing'});
  await life.execute(f.pool,user,'D1','cancel',{requestId:'cancel-unpaid-1'});
  const increments=f.queries.filter(q=>q.sql.includes('StockOnHand = StockOnHand +'));
  assert.equal(increments.length,1);
  assert.deepEqual(increments[0].params,{qty:2,id:'I1'});
  assert.ok(f.queries.some(q=>q.sql.includes("DeliveryStatus='Cancelled'")));
  assert.ok(f.queries.some(q=>q.sql.includes('RestockedAt=NOW()')));
  assert.ok(!f.queries.some(q=>/INSERT INTO Payment|INSERT INTO RefundLedger|StockOnHand = StockOnHand -/.test(q.sql)));
  assert.equal(f.commits,1);
});

test('cancellation after restoration cannot increment inventory again',async()=>{
  const f=fixture({DeliveryStatus:'Failed Attempt',RestockedAt:'2026-10-15'});
  await life.execute(f.pool,user,'D1','cancel',{requestId:'cancel-restocked-1'});
  assert.ok(!f.queries.some(q=>q.sql.includes('UPDATE Inventory')));
  assert.equal(f.commits,1);
});

test('retry failure leaves stock deducted until final cancellation',async()=>{
  const f=fixture({DeliveryStatus:'Out for Delivery',AttemptCount:0});
  await life.execute(f.pool,user,'D1','fail',{requestId:'retry-stock-1',notes:'Customer unavailable'});
  assert.ok(!f.queries.some(q=>q.sql.includes('UPDATE Inventory')));
  assert.equal(f.queries.find(q=>q.sql.includes('AttemptCount=:attempts')).params.status,'Failed Attempt');
});
