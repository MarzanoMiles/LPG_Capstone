const {test}=require("node:test");
const assert=require("node:assert/strict");
const {financials,validatePayout,settle,quote}=require("../utils/pickupSettlement");
const settings={AllowIssueRefund:1,EnableCancellationFee:1,CancellationFeeType:"Fixed",CancellationFeeValue:50};
const user={userId:"U1",companyId:"C1",roleName:"Administrator"};
const payout={refundMethod:"GCash",accountName:"Customer",accountNumber:"09123456789",payoutReferenceNo:"00001"};
function database({status="Unclaimed",pending=1,owner=true,mismatch=false,failAt="",refund=false}={}) {
 let state={stock:{I1:4,I2:5},settlements:[],refunds:refund?[{}]:[],pending,movements:[]},backup;
 let gate=Promise.resolve(),unlock;
 const db={get state(){return state;},queries:[],async getConnection(){
  let release;
  return {
   async beginTransaction(){const prior=gate;gate=new Promise(resolve=>{release=resolve;});await prior;backup=structuredClone(state);unlock=release;},
   async commit(){backup=null;unlock();unlock=null;},
   async rollback(){if(backup)state=backup;backup=null;if(unlock)unlock();unlock=null;},release(){},
   async query(sql,p){
    db.queries.push(sql);
    if(sql.startsWith('INSERT INTO EntityIdSequence'))return [{insertId:db.queries.filter(q=>q.startsWith('INSERT INTO EntityIdSequence')).length}];
    if(sql.includes("SELECT o.*"))return [owner?[{OrderID:"O1",OrderNo:"ORD-2026-001",PickupStatus:status,PickupSettlementPending:state.pending,TotalAmount:200,CustomerName:"Customer"}]:[]];
    if(sql.startsWith("SELECT OrderID FROM PickupSettlement"))return [state.settlements];
    if(sql.startsWith("SELECT RefundID"))return [state.refunds];
    if(sql.startsWith("SELECT p.AmountPaid"))return [[{AmountPaid:"200.00"}]];
    if(sql.startsWith("SELECT * FROM CompanySettings"))return [[settings]];
    if(sql.startsWith("SELECT ProductID"))return [[{ProductID:"P1",Quantity:3}]];
    if(sql.startsWith("SELECT t.InventoryID"))return [[{InventoryID:"I1",ProductID:"P1",CompanyID:"C1",Quantity:1},{InventoryID:"I2",ProductID:"P1",CompanyID:"C1",Quantity:mismatch?1:2}]];
    if(sql.startsWith("SELECT InventoryID"))return [[{InventoryID:p.id}]];
    if(sql.startsWith("UPDATE Inventory")){state.stock[p.id]+=p.qty;return [{}];}
    if(sql.includes("INSERT INTO InventoryTransaction")){state.movements.push(p);if(failAt==="movement")throw Error("Movement failure");return [{}];}
    if(sql.includes("INSERT INTO PickupSettlement")){state.settlements.push(p);return [{}];}
    if(sql.includes("INSERT INTO RefundLedger")){if(failAt==="refund")throw Error("Ledger failure");state.refunds.push(p);return [{}];}
    if(sql.startsWith("UPDATE `Order`")){state.pending=0;return [{}];}
    throw Error("Unexpected SQL: "+sql);
   }
  };
 }};
 return db;
}
const body={...payout,quote:{eligibleAmount:200,cancellationFee:50,refundAmount:150}};
test("settlement financials cover disabled/zero/fixed/percentage/capped fees and decimal rounding",()=>{
 assert.deepEqual(financials(200,settings),{eligibleAmount:200,cancellationFee:50,refundAmount:150});
 for(const disabled of [0,false,"0","false"])assert.equal(financials(200,{...settings,EnableCancellationFee:disabled}).cancellationFee,0);
 assert.equal(financials(200,{...settings,CancellationFeeValue:0}).refundAmount,200);
 assert.equal(financials(200,{...settings,CancellationFeeValue:500}).refundAmount,0);
 assert.equal(financials(123.45,{...settings,CancellationFeeType:"Percentage",CancellationFeeValue:10}).refundAmount,111.1);
 assert.throws(()=>financials(200,{...settings,CancellationFeeValue:-1}));
 assert.throws(()=>financials(200,{...settings,AllowIssueRefund:0}),e=>e.statusCode===409);
});
test("payout format validation preserves leading zeros and rejects numeric/coerced inputs",()=>{
 assert.equal(validatePayout(payout).accountNumber,"09123456789");
 for(const [method,number] of [["Card","0012345678901234"],["Bank Transfer","0001234567"],["GCash","+639123456789"]])assert.equal(validatePayout({...payout,refundMethod:method,accountNumber:number}).accountNumber,number);
 for(const data of [{accountNumber:9123456789},{accountNumber:"123"},{accountNumber:"09123abc789"},{refundMethod:"Cash"},{accountName:" "},{refundMethod:"Card",accountNumber:"123456"},{refundMethod:"Bank Transfer",accountNumber:"abc123456"}])assert.throws(()=>validatePayout({...payout,...data}));
});
test("settles both eligible statuses, restores original split inventories and saves payout/financial audit",async()=>{
 for(const status of ["Unclaimed","Cancelled"]){
  const db=database({status});const preview=await quote(db,user,"O1");assert.equal(preview.accountName,"Customer");
  const result=await settle(db,user,"O1",body);
  assert.deepEqual(db.state.stock,{I1:5,I2:7});assert.equal(db.state.pending,0);
  assert.equal(db.state.settlements[0].accountNumber,"09123456789");assert.equal(db.state.settlements[0].resolvedStatus,status);
  assert.equal(db.state.refunds.length,1);assert.equal(result.netRefundAmount,150);
  assert.equal(db.state.movements.length,2);assert.ok(db.state.movements.every(m=>m.ref==="SETTLE-O1"));
  await assert.rejects(settle(db,user,"O1",body),e=>e.statusCode===409);assert.deepEqual(db.state.stock,{I1:5,I2:7});
 }
});
test("rollback undoes all stock, audit and pending changes after movement or ledger failure",async()=>{
 for(const failAt of ["movement","refund"]){
  const db=database({failAt});const before=structuredClone(db.state);
  await assert.rejects(settle(db,user,"O1",body));assert.deepEqual(db.state,before);
 }
});
test("rejects permissions, ownership, ineligible state, existing refund, mismatch and stale quote",async()=>{
 const denied=database();await assert.rejects(settle(denied,{...user,roleName:"Staff"},"O1",body),e=>e.statusCode===403);assert.equal(denied.queries.length,0);
 for(const options of [{owner:false},{status:"Completed"},{pending:0},{refund:true},{mismatch:true}]){
  const db=database(options);const before=structuredClone(db.state);await assert.rejects(settle(db,user,"O1",body));assert.deepEqual(db.state,before);
 }
 const db=database();await assert.rejects(settle(db,user,"O1",{...body,quote:{...body.quote,cancellationFee:0}}),e=>e.statusCode===409);assert.equal(db.state.movements.length,0);
});
test("concurrent submissions serialize on order and only one restores inventory",async()=>{
 const db=database();const results=await Promise.allSettled([settle(db,user,"O1",body),settle(db,user,"O1",body)]);
 assert.equal(results.filter(r=>r.status==="fulfilled").length,1);assert.deepEqual(db.state.stock,{I1:5,I2:7});assert.equal(db.state.settlements.length,1);
 assert.ok(db.queries.some(sql=>sql.includes("CompanyID=:companyId") && sql.includes("FOR UPDATE")));
});
