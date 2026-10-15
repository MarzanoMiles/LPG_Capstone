const {test}=require("node:test");
const assert=require("node:assert/strict");
const {expiration,validateSchedule,transition,evaluate}=require("../utils/pickupLifecycle");
const settings={BusinessDays:"Monday,Tuesday,Wednesday,Thursday,Friday",OpeningTime:"09:00:00",ClosingTime:"17:00:00",PickupExpirationDays:2};
test("expiration skips weekend and uses settings closing time",()=>{
 assert.equal(expiration("2026-10-16 10:00:00",settings).toISOString(),"2026-10-20T09:00:00.000Z");
 assert.equal(expiration("2026-10-16 10:00:00",{...settings,PickupExpirationDays:1,ClosingTime:"15:00:00"}).toISOString(),"2026-10-19T07:00:00.000Z");
 assert.throws(()=>expiration("2026-10-16 10:00:00",{...settings,BusinessDays:""}));
});
test("creation validates future schedules, real dates, business days and settings hours",()=>{
 const now=new Date("2026-01-01T00:00:00Z");
 assert.equal(validateSchedule({pickupDate:"2026-10-16",pickupTime:"09:00"},settings,now),"2026-10-16 09:00:00");
 for(const details of [{pickupDate:"2026-10-17",pickupTime:"10:00"},{pickupDate:"2026-10-16",pickupTime:"08:59"},{pickupDate:"2026-02-30",pickupTime:"10:00"},{pickupDate:"2025-10-16",pickupTime:"10:00"}]) assert.throws(()=>validateSchedule(details,settings,now));
});
test("transition matrix rejects unpaid, skipped, reversed and expired actions; duplicates are no-ops",()=>{
 assert.equal(transition("Preparing","Ready for Pickup",true),true);
 assert.equal(transition("Ready for Pickup","Completed",true),true);
 for(const state of ["Preparing","Ready for Pickup"]) assert.equal(transition(state,"Cancelled",true),true);
 for(const state of ["Ready for Pickup","Completed","Cancelled"]) assert.equal(transition(state,state,true),false);
 for(const [from,to] of [["Preparing","Completed"],["Completed","Cancelled"],["Unclaimed","Cancelled"],["Cancelled","Ready for Pickup"],["Ready for Pickup","Preparing"]]) assert.throws(()=>transition(from,to,true));
 assert.throws(()=>transition("Preparing","Ready for Pickup",false));
});
test("query evaluation expires at exact deadline, scopes company and performs no stock/refund writes",async()=>{
 for(const [now,expected] of [["2026-10-20T08:59:59Z",0],["2026-10-20T09:00:00Z",1]]) {
  const writes=[];
  const conn={async query(sql,params){
   if(sql.startsWith("SELECT *")) {assert.equal(params.companyId,"C-1");return [[settings]];}
   if(sql.startsWith("SELECT o.")) {assert.match(sql,/CompanyID=:companyId/);assert.match(sql,/SUM\(p.AmountPaid\)/);return [[{OrderID:"O-1",PickupScheduledAt:"2026-10-16 10:00:00"}]];}
   writes.push(sql);return [{}];
  }};
  await evaluate(conn,"C-1",new Date(now));assert.equal(writes.length,expected);
  for(const sql of writes) {assert.match(sql,/PickupStatus='Unclaimed'/);assert.doesNotMatch(sql,/Inventory|Refund|DELETE/);}
 }
});
