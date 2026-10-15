const {test}=require("node:test");
const assert=require("node:assert/strict");
const {complete,validateClaim}=require("../utils/pickupClaim");
const user={userId:"U1",companyId:"C1",roleName:"Administrator"};
const no={emptyCylinderReturned:false,returnedCylinders:[]};
const yes={emptyCylinderReturned:true,warehouseId:"W1",returnedCylinders:[{productId:"CY1",qty:2}]};
function database({status="Ready for Pickup",paid=200,owner=true,warehouse=true,cylinder=true,existingInventory=true,fail="",saleCount=1,expired=false}={}) {
 let state={status,stock:4,claims:[],movements:[],sales:[{SaleID:"S1",SaleNo:"SALE-2026-001",TotalAmount:200}],payments:[{AmountPaid:paid,ReferenceNo:"ORIGINAL-REF"}],pending:0};
 let gate=Promise.resolve();const db={queries:[],get state(){return state;},async getConnection(){let before,release;
  return {async beginTransaction(){const previous=gate;gate=new Promise(resolve=>{release=resolve;});await previous;before=structuredClone(state);},async commit(){before=null;release();release=null;},async rollback(){if(before)state=before;before=null;if(release)release();release=null;},release(){},async query(sql,p){
   db.queries.push({sql,p});
   if(sql.startsWith("SELECT o.*"))return [owner?[{OrderID:"O1",OrderType:"Pickup",PickupStatus:state.status,TotalAmount:200,PickupSettlementPending:state.pending,PickupScheduledAt:expired?"2020-01-01 10:00:00":"2099-10-16 10:00:00"}]:[]];
   if(sql.startsWith("SELECT * FROM PickupClaim"))return [state.claims];
   if(sql.startsWith("SELECT * FROM CompanySettings"))return [[{BusinessDays:"Monday,Tuesday,Wednesday,Thursday,Friday",OpeningTime:"09:00:00",ClosingTime:"17:00:00",PickupExpirationDays:2}]];
   if(sql.startsWith("SELECT s.*"))return [saleCount===1?state.sales:saleCount===0?[]:[...state.sales,...state.sales]];
   if(sql.startsWith("SELECT AmountPaid"))return [state.payments];
   if(sql.startsWith("SELECT RefundID"))return [[]];
   if(sql.startsWith("SELECT WarehouseID"))return [warehouse?[{WarehouseID:"W1"}]:[]];
   if(sql.startsWith("SELECT CompanyID"))return [[{CompanyID:"C1"}]];
   if(sql.includes("AS code FROM"))return [[]];
   if(sql.startsWith("SELECT p.ProductID"))return [cylinder?[{ProductID:"CY1"}]:[]];
   if(sql.startsWith("SELECT InventoryID FROM Inventory WHERE WarehouseID"))return [existingInventory?[{InventoryID:"I1"}]:[]];
   if(sql.startsWith("SELECT InventoryID FROM Inventory WHERE InventoryID"))return [[{InventoryID:p.id}]];
   if(sql.startsWith("INSERT INTO Inventory ("))return [{}];
   if(sql.startsWith("UPDATE Inventory")){state.stock+=p.qty;return [{}];}
   if(sql.includes("INSERT INTO InventoryTransaction")){state.movements.push(p);if(fail==="movement")throw Error("movement failure");return [{}];}
   if(sql.includes("INSERT INTO PickupClaim")){state.claims.push({SaleID:p.saleId,ReturnReferenceNo:p.reference,RequestHash:p.hash});if(fail==="claim")throw Error("claim failure");return [{}];}
   if(sql.startsWith("UPDATE `Order`")){state.status=sql.includes("Unclaimed")?"Unclaimed":"Completed";if(state.status==="Unclaimed")state.pending=1;if(fail==="finalize")throw Error("finalize failure");return [{}];}
   throw Error("Unexpected SQL: "+sql);
  }};
 }};return db;
}
test("claim requires explicit answer; Yes validates positive integer cylinder quantities; No rejects hidden returns",()=>{
 for(const value of [{},{emptyCylinderReturned:"yes"},{...yes,returnedCylinders:[]},{...yes,warehouseId:""},{...yes,returnedCylinders:[{productId:"CY1",qty:0}]},{...yes,returnedCylinders:[{productId:"CY1",qty:1.5}]},{...yes,returnedCylinders:[{productId:"CY1",qty:"2"}]},{...no,returnedCylinders:yes.returnedCylinders}])assert.throws(()=>validateClaim(value));
 assert.deepEqual(validateClaim(no).items,[]);
 assert.equal(validateClaim({...yes,returnedCylinders:[{productId:"CY1",qty:1},{productId:"CY1",qty:1}]}).hash,validateClaim(yes).hash);
});
test("No completes existing sale once without inventory or payment writes and exits active status",async()=>{
 const db=database(),sales=structuredClone(db.state.sales),payments=structuredClone(db.state.payments);
 const result=await complete(db,user,"O1",no);assert.equal(result.saleId,"S1");assert.equal(db.state.status,"Completed");assert.equal(db.state.stock,4);assert.equal(db.state.movements.length,0);
 assert.deepEqual(db.state.sales,sales);assert.deepEqual(db.state.payments,payments);assert.equal(db.state.claims.length,1);
 const retry=await complete(db,user,"O1",no);assert.equal(retry.alreadyCompleted,true);assert.equal(db.state.claims.length,1);
 assert.ok(!db.queries.some(q=>/INSERT INTO Sales|UPDATE Sales|INSERT INTO Payment|UPDATE Payment|UPDATE Inventory/.test(q.sql)));
});
test("Yes records accurate Cylinder stock increase at designated warehouse and supports missing inventory",async()=>{
 for(const existingInventory of [true,false]){
  const db=database({existingInventory});const result=await complete(db,user,"O1",yes);
  assert.equal(db.state.stock,6);assert.equal(db.state.movements.length,1);assert.equal(db.state.movements[0].reason,"Empty Cylinder Returned");assert.match(result.emptyCylinderReference,/^ECR-/);
  assert.ok(db.queries.some(q=>q.sql.includes("WarehouseID=:warehouseId") && q.p.warehouseId==="W1"));
  assert.ok(db.queries.some(q=>q.sql.includes("c.Category='Cylinder'")));
  await complete(db,user,"O1",yes);assert.equal(db.state.stock,6);
 }
});
test("claim rejects unauthorized company, invalid state, unpaid, duplicate sales and invalid warehouse/category",async()=>{
 for(const options of [{owner:false},{status:"Preparing"},{status:"Cancelled"},{status:"Unclaimed"},{paid:0},{saleCount:0},{saleCount:2},{warehouse:false},{cylinder:false}]){
  const db=database(options),before=structuredClone(db.state);await assert.rejects(complete(db,user,"O1",yes));assert.deepEqual(db.state,before);
 }
});
test("all stock, claim and status writes roll back on movement, audit or finalization failure",async()=>{
 for(const fail of ["movement","claim","finalize"]){const db=database({fail}),before=structuredClone(db.state);await assert.rejects(complete(db,user,"O1",yes));assert.deepEqual(db.state,before);}
});
test("concurrent identical submissions complete exactly once; conflicting replay is rejected",async()=>{
 const db=database();const results=await Promise.all([complete(db,user,"O1",yes),complete(db,user,"O1",yes)]);
 assert.equal(results.filter(r=>r.alreadyCompleted).length,1);assert.equal(db.state.claims.length,1);assert.equal(db.state.sales.length,1);assert.equal(db.state.movements.length,1);assert.equal(db.state.stock,6);
 await assert.rejects(complete(db,user,"O1",no),e=>e.statusCode===409);
});
test("expired claim becomes Unclaimed without cylinder or sale changes",async()=>{
 const db=database({expired:true});await assert.rejects(complete(db,user,"O1",yes),e=>e.statusCode===409);
 assert.equal(db.state.status,"Unclaimed");assert.equal(db.state.pending,1);assert.equal(db.state.stock,4);assert.equal(db.state.claims.length,0);
});
