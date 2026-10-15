const {test}=require("node:test");
const assert=require("node:assert/strict");
const {resolvePickupCustomer}=require("../utils/pickupCustomer");
test("pickup checkout resolves nested POS customer ID into the order/sale customer",async()=>{
 const conn={async query(sql,p){assert.equal(p.id,"CUST-007");return [[{CustomerID:"CUST-007",CustomerName:"Maria Santos",ContactNo:"09123456789"}]];}};
 assert.equal(await resolvePickupCustomer(conn,{pickupDetails:{customerId:"CUST-007",customerName:"Untrusted input"}}),"CUST-007");
 assert.equal(await resolvePickupCustomer(conn,{customerId:"CUST-007"}),"CUST-007");
});
test("pickup checkout rejects missing, conflicting, unknown or unnamed customers rather than using walk-in",async()=>{
 const empty={async query(){return [[]];}};
 for(const body of [{},{pickupDetails:{customerName:"Name only"}},{customerId:"CUST-001",pickupDetails:{customerId:"CUST-002"}},{customerId:"CUST-404"}])await assert.rejects(resolvePickupCustomer(empty,body));
 for(const customer of [{CustomerID:"CUST-1",CustomerName:"",ContactNo:"09123456789"},{CustomerID:"CUST-1",CustomerName:"Walk-in",ContactNo:"WALKIN"}])await assert.rejects(resolvePickupCustomer({async query(){return [[customer]];}},{customerId:"CUST-1"}));
});
