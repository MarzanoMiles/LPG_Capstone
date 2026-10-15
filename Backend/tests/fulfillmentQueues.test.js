const {test}=require("node:test");
const assert=require("node:assert/strict");
let queries=[];
const conn={async beginTransaction(){},async commit(){},async rollback(){},release(){},async query(sql,params){
 queries.push({sql,params});
 if(sql.includes("AS customerName")) return [[{id:"S1",customerId:null,customerName:" \u2014 "}]];
 if(sql.includes("TaxRate, TaxEnabled")) return [[{TaxRate:0,TaxEnabled:0}]];
 if(sql.includes("SELECT * FROM CompanySettings")) return [[]];
 if(sql.startsWith("SELECT o.OrderID")) return [[]];
 if(sql.includes("WHERE ContactNo = 'WALKIN'")) return [[{CustomerID:"WALKIN-1"}]];
 if(sql.includes("FROM Product WHERE ProductID")) return [[{ProductID:"P1"}]];
 if(sql.includes("SELECT i.InventoryID, i.StockOnHand")) return [[{InventoryID:"I1",StockOnHand:10}]];
 if(sql.includes("AS name FROM User")) return [[{name:"Cashier"}]];
 return [[]];
}};
const dbPath=require.resolve("../config/db");
require.cache[dbPath]={id:dbPath,filename:dbPath,loaded:true,exports:{query:conn.query.bind(conn),getConnection:async()=>conn}};
const orders=require("../routes/orderRoutes");
const sales=require("../routes/salesRoutes");
function invoke(router,path,method,body={},query={}) {
 const route=router.stack.find(layer=>layer.route?.path===path && layer.route.methods[method]).route;
 return new Promise((resolve,reject)=>{
  const req={user:{userId:"U1",companyId:"C1",roleName:"Administrator"},body,query,params:{id:"S1"}};
  const res={status(){return this;},json:resolve};let index=0;
  const next=err=>{if(err)return reject(err);const layer=route.stack[index++];if(layer)layer.handle(req,res,next);};next();
 });
}
test("fulfillment API excludes walk-ins even when explicitly requested",async()=>{
 queries=[];await invoke(orders,"/","get",{}, {type:"Walk-in"});
 const list=queries.find(q=>q.sql.includes("AS orderId"));
 assert.match(list.sql,/o.OrderType IN \('Pickup', 'Delivery'\)/);
 assert.equal(list.params.type,"Walk-in");
 await assert.rejects(invoke(orders,"/","post",{orderType:"Walk-in",items:[{productId:"P1",qty:1}]}),e=>e.statusCode===400);
});
test("walk-in checkout records completed sale/payment and deducts physical stock",async()=>{
 queries=[];
 const result=await invoke(sales,"/","post",{customerType:"Walk-in",paymentMethod:"Cash",amountCollected:200,items:[{productId:"P1",qty:2,unitPrice:100}]});
 assert.equal(result.totalAmount,200);
 const order=queries.find(q=>q.sql.includes("INSERT INTO `Order`"));
 assert.equal(order.params.orderType,"Walk-in");assert.match(order.sql,/'Completed'/);
 const stock=queries.find(q=>q.sql.includes("UPDATE Inventory SET StockOnHand = StockOnHand -"));assert.equal(stock.params.qty,2);
 assert.ok(queries.some(q=>q.sql.includes("INSERT INTO Sales")));
 assert.ok(queries.some(q=>q.sql.includes("INSERT INTO Payment")));
 assert.ok(!queries.some(q=>q.sql.includes("INSERT INTO Delivery")));
});
test("Sales list and transaction details retain null-customer rows and supply dash display",async()=>{
 queries=[];await invoke(sales,"/","get");await invoke(sales,"/:id","get");
 for(const q of queries.filter(q=>q.sql.includes("AS customerName"))) {
  assert.match(q.sql,/s.CustomerID IS NULL THEN ' \u2014 '/);
  assert.match(q.sql,/LEFT JOIN Customer c ON c.CustomerID = s.CustomerID/);
 }
 assert.equal(queries.filter(q=>q.sql.includes("AS customerName")).length,3);
});

test("walk-in transaction receipt displays a dash for null customer identity",async()=>{
 const fs=require("node:fs");
 const source=fs.readFileSync(require("node:path").join(__dirname,"../../src/utils/receipt.js"),"utf8").replace(/^\uFEFF?import[^\n]+\n/,"");
 const cleaned=source.replace(/^import[^\n]+\n/,"");
 const {buildReceiptHtml}=await import("data:text/javascript;base64,"+Buffer.from(cleaned).toString("base64"));
 const pickup=buildReceiptHtml({type:"Pickup",customerName:"Maria Santos",items:[]});
 assert.match(pickup,/Customer Name :<\/span><span>Maria Santos<\/span>/);
 const html=buildReceiptHtml({type:"Walk-in",customerId:null,customerName:null,items:[]});
 assert.match(html,/Customer Name :<\/span><span> \u2014 <\/span>/);
});
