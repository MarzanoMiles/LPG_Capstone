const {test}=require("node:test");
const assert=require("node:assert/strict");
const dbPath=require.resolve("../config/db");
let queries=[],writes=0,current="Preparing",owned=true;
const settings={BusinessDays:"Monday,Tuesday,Wednesday,Thursday,Friday",OpeningTime:"09:00:00",ClosingTime:"17:00:00",PickupExpirationDays:2};
const conn={async beginTransaction(){},async commit(){},async rollback(){},release(){},async query(sql,params){
 queries.push({sql,params});
 if(sql.startsWith("SELECT * FROM CompanySettings")) return [[settings]];
 if(sql.startsWith("SELECT o.OrderID")) return [[]];
 if(sql.startsWith("SELECT o.*")) return [owned?[{OrderID:"O1",OrderType:"Pickup",PickupStatus:current,PickupScheduledAt:"2099-10-16 10:00:00",TotalAmount:100}]:[]];
 if(sql.startsWith("SELECT COALESCE")) return [[{amount:100}]];
 if(sql.startsWith("UPDATE")) {writes++;current=params.status;return [{}];}
 return [[{pickupStatus:"Cancelled",settlementPending:1}]];
}};
require.cache[dbPath]={id:dbPath,filename:dbPath,loaded:true,exports:{query:conn.query.bind(conn),getConnection:async()=>conn}};
const router=require("../routes/orderRoutes");
function invoke(path,method,user,body={}) {
 const route=router.stack.find(layer=>layer.route?.path===path && layer.route.methods[method]).route;
 return new Promise((resolve,reject)=>{
  const req={user,body,params:{id:"O1",customerId:"CUST-002"}};const res={json:resolve};let index=0;
  const next=err=>{if(err)return reject(err);const layer=route.stack[index++];if(layer)layer.handle(req,res,next);};next();
 });
}
const admin={roleName:"Administrator",companyId:"C1"};
test("pickup route guards permissions, ownership and retries without a second write",async()=>{
 await assert.rejects(invoke("/:id/pickup-status","put",{...admin,roleName:"Drivers"},{status:"Cancelled"}),e=>e.statusCode===403);
 owned=false;await assert.rejects(invoke("/:id/pickup-status","put",admin,{status:"Cancelled"}),e=>e.statusCode===404);owned=true;
 await invoke("/:id/pickup-status","put",admin,{status:"Ready for Pickup"});
 await invoke("/:id/pickup-status","put",admin,{status:"Ready for Pickup"});assert.equal(writes,1);
 await assert.rejects(invoke("/:id/pickup-status","put",admin,{status:"Completed"}),e=>e.statusCode===400);
 current="Completed";
 await assert.rejects(invoke("/:id/pickup-status","put",admin,{status:"Cancelled"}),e=>e.statusCode===409);
 assert.ok(queries.some(q=>q.sql.includes("FOR UPDATE") && q.sql.includes("CompanyID=:companyId")));
});
test("pickup list applies independent paid/type/status/company filter and settlement permissions",async()=>{
 queries=[];
 let rows=await invoke("/pickup","get",admin);assert.equal(rows[0].canSettle,true);
 rows=await invoke("/pickup","get",{...admin,roleName:"Store Supervisor"});assert.equal(rows[0].canSettle,false);
 const sql=queries.find(q=>q.sql.includes("AS orderId")).sql;
 assert.match(sql,/o.OrderType='Pickup'/);assert.match(sql,/PickupStatus IN \('Preparing','Ready for Pickup','Cancelled','Unclaimed'\)/);assert.match(sql,/pay.AmountPaid>=o.TotalAmount/);assert.match(sql,/owner.CompanyID=:companyId/);assert.match(sql,/SUM\(AmountPaid\)/);
});

test("settled pickups are excluded from queue but customer history includes settlement audit",async()=>{
 queries=[];await invoke("/pickup","get",admin);
 const queue=queries.find(q=>q.sql.includes("AS orderId"));
 assert.match(queue.sql,/NOT EXISTS \(SELECT 1 FROM PickupSettlement settled WHERE settled.OrderID=o.OrderID\)/);
 queries=[];await invoke("/customer/:customerId/history","get",admin);
 const history=queries.find(q=>q.sql.includes("AS settledAt"));
 assert.equal(history.params.customerId,"CUST-002");assert.equal(history.params.companyId,"C1");
 assert.match(history.sql,/owner.CompanyID=:companyId/);assert.match(history.sql,/LEFT JOIN PickupSettlement/);
 assert.doesNotMatch(history.sql,/NOT EXISTS|PickupStatus IN/);
});
