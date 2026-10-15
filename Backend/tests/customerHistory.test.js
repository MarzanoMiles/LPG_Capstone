const {test}=require('node:test');
const assert=require('node:assert/strict');
const {validateCustomer,hardDeleteCustomer,fields}=require('../utils/customerHistory');
const profile={firstName:'Jane',lastName:'Rivera',phone:'09123456789',address:'Old address',customerType:'Residential'};
test('commercial customer uses company name and requires a named contact',()=>{
 const commercial={...profile,customerType:'Commercial',companyName:'  Rivera Trading  '};
 const result=validateCustomer(commercial);
 assert.equal(result.name,'Rivera Trading');
 assert.equal(result.companyName,'Rivera Trading');
 assert.equal(result.firstName,'Jane');
 assert.equal(result.lastName,'Rivera');
 for(const companyName of [undefined,' ','x'.repeat(151)]) assert.throws(()=>validateCustomer({...commercial,companyName}));
 for(const key of ['firstName','lastName','phone','address']) assert.throws(()=>validateCustomer({...commercial,[key]:''}));
 const residential=validateCustomer({...profile,companyName:'Old company'});
 assert.equal(residential.companyName,null);
 assert.equal(residential.name,'Jane Rivera');
});
test('required split names, allowed types, lengths and legacy POS full name',()=>{
 assert.equal(validateCustomer(profile).name,'Jane Rivera');
 assert.equal(validateCustomer({...profile,firstName:undefined,lastName:undefined,name:'Jane Rivera'}).lastName,'Rivera');
 for(const key of ['firstName','lastName','phone','address']) assert.throws(()=>validateCustomer({...profile,[key]:' '}));
 assert.throws(()=>validateCustomer({...profile,customerType:'Other'}));
 assert.throws(()=>validateCustomer({...profile,phone:'x'.repeat(31)}));
 assert.throws(()=>validateCustomer({...profile,firstName:'x'.repeat(75),lastName:'x'.repeat(75)}));
});
test('MySQL snapshots survive edits, hard deletion, later payments and rollback',{skip:process.env.RUN_CUSTOMER_DB_TESTS!=='1'},async()=>{
 const pool=require('../config/db');const conn=await pool.getConnection();
 const id=()=> 'CH-'+require('crypto').randomBytes(7).toString('hex');
 try {
  await conn.beginTransaction();
  const [[owner]]=await conn.query('SELECT UserID,CompanyID FROM User LIMIT 1');
  const router=require('../routes/customerRoutes');
  const originalQuery=pool.query,originalGetConnection=pool.getConnection;
  pool.query=conn.query.bind(conn);
  pool.getConnection=async()=>({query:conn.query.bind(conn),release(){}});
  const invoke=(method,path,body={},params={},query={})=>new Promise((resolve,reject)=>{
    const route=router.stack.find(layer=>layer.route?.path===path && layer.route.methods[method]).route;
    route.stack[0].handle({body,params,query},{status(){return this;},json:resolve},reject);
  });
  let customer;
  try {
    const created=await invoke('post','/',profile);customer=created.id;
    assert.match(customer,/^CUST-\d{3,}$/);
    const list=await invoke('get','/',{}, {},{search:customer,customerType:'Residential'});
    assert.ok(list.some(row=>row.id===customer && row.firstName==='Jane'));
    assert.equal((await invoke('get','/',{}, {},{search:customer,customerType:'Commercial'})).length,0);
  } finally {pool.query=originalQuery;pool.getConnection=originalGetConnection;}

  const create=async()=>{
   const order=id(),sale=id(),payment=id(),delivery=id();
   await conn.query("INSERT INTO `Order`(OrderID,OrderNo,CustomerID,OrderType,OrderStatus,TotalAmount) VALUES(:order,:order,:customer,'Delivery','Preparing',100)",{order,customer});
   await conn.query('INSERT INTO Sales(SaleID,SaleNo,OrderID,CustomerID,UserID,TotalAmount) VALUES(:sale,:sale,:order,:customer,:user,100)',{sale,order,customer,user:owner.UserID});
   await conn.query("INSERT INTO Payment(PaymentID,PaymentType,SaleID,PaymentMethod,AmountPaid) VALUES(:payment,'Sale',:sale,'Cash',100)",{payment,sale});
   await conn.query("INSERT INTO Delivery(DeliveryID,SaleID,DRNo,DeliveryAddress,DeliveryStatus) VALUES(:delivery,:sale,:delivery,'Destination','Preparing')",{delivery,sale});
   return {Order:order,Sales:sale,Payment:payment,Delivery:delivery};
  };
  const old=await create();
  await conn.query("UPDATE Customer SET FirstName='Joan',CustomerName='Joan Rivera',Address='New address',CustomerType='Commercial' WHERE CustomerID=:id",{id:customer});
  const recent=await create();
  // Backfill individual missing fields without replacing existing snapshot values.
  await conn.query('UPDATE Sales SET contact_number=NULL WHERE SaleID=:id',{id:old.Sales});
  await conn.query('UPDATE Payment SET contact_number=NULL WHERE PaymentID=:id',{id:old.Payment});
  const adapter=(fail=false)=>({getConnection:async()=>({query:async(sql,params)=>{if(fail && sql.startsWith('DELETE FROM Customer'))throw Error('Injected failure');return conn.query(sql,params);},beginTransaction:()=>conn.query('SAVEPOINT customer_test'),commit:async()=>{},rollback:()=>conn.query('ROLLBACK TO SAVEPOINT customer_test'),release(){}})});
  await assert.rejects(hardDeleteCustomer(adapter(true),customer),/rolled back/);
  const [[stillLinked]]=await conn.query('SELECT CustomerID FROM Sales WHERE SaleID=:id',{id:old.Sales});assert.equal(stillLinked.CustomerID,customer);
  await hardDeleteCustomer(adapter(),customer);
  const [gone]=await conn.query('SELECT CustomerID FROM Customer WHERE CustomerID=:id',{id:customer});assert.equal(gone.length,0);
  const keys={Order:'OrderID',Sales:'SaleID',Payment:'PaymentID',Delivery:'DeliveryID'};
  for(const [table,key] of Object.entries(keys)) {
   const [[before]]=await conn.query(`SELECT * FROM \`${table}\` WHERE ${key}=:id`,{id:old[table]});
   const [[after]]=await conn.query(`SELECT * FROM \`${table}\` WHERE ${key}=:id`,{id:recent[table]});
   assert.equal(before.customer_name,'Jane Rivera');assert.equal(before.address,'Old address');assert.equal(before.customer_type,'Residential');assert.equal(before.historical_customer_id,customer);assert.equal(before.contact_number,'09123456789');
   assert.equal(after.customer_name,'Joan Rivera');assert.equal(after.address,'New address');
   if(['Order','Sales'].includes(table))assert.equal(before.CustomerID,null);
  }
  const late=id();await conn.query("INSERT INTO Payment(PaymentID,PaymentType,SaleID,PaymentMethod,AmountPaid) VALUES(:id,'Sale',:sale,'Cash',1)",{id:late,sale:old.Sales});
  const [[payment]]=await conn.query('SELECT * FROM Payment WHERE PaymentID=:id',{id:late});assert.equal(payment.customer_name,'Jane Rivera');
  await assert.rejects(hardDeleteCustomer(adapter(),customer),/not found/);
  pool.query=conn.query.bind(conn);
  try {
    assert.equal((await invoke('get','/',{}, {},{search:customer})).length,0);
    await assert.rejects(invoke('get','/:id',{}, {id:customer}),/not found/);
    const invokeRead=(router,path,params)=>new Promise((resolve,reject)=>{
      const route=router.stack.find(layer=>layer.route?.path===path && layer.route.methods.get).route;
      route.stack[0].handle({params,query:{},user:{companyId:owner.CompanyID}},{json:resolve},reject);
    });
    const order=await invokeRead(require('../routes/orderRoutes'),'/:id',{id:old.Order});
    assert.equal(order.customerName,'Jane Rivera');assert.equal(order.customerAddress,'Old address');
    const sale=await invokeRead(require('../routes/salesRoutes'),'/:id',{id:old.Sales});
    assert.equal(sale.customerName,'Jane Rivera');assert.equal(sale.customerPhone,'09123456789');
    const history=await invokeRead(require('../routes/orderRoutes'),'/customer/:customerId/history',{customerId:customer});
    assert.equal(history.length,2);
  } finally {pool.query=originalQuery;}
  assert.equal(fields.length,5);
 } finally {await conn.rollback();conn.release();await pool.end();}
});

test('customer type filter and case-insensitive search share pagination and clamp after deletion',async()=>{
 const {customerPageData}=await import('../../src/utils/customers.js');
 const customers=Array.from({length:25},(_,i)=>({id:`CUST-${String(i+1).padStart(3,'0')}`,name:'Jane Rivera',phone:'0900',address:'Old address',type:i<15?'Residential':'Commercial'}));
 assert.equal(customerPageData(customers,{page:3}).rows.length,5);
 const filtered=customerPageData(customers,{type:'Commercial',search:'JANE',page:3});
 assert.equal(filtered.rows.length,10);assert.equal(filtered.currentPage,1);
 assert.equal(customerPageData(customers,{search:'cust-001'}).rows[0].id,'CUST-001');
 assert.equal(customerPageData(customers,{type:'Commercial',search:'missing',page:5}).currentPage,1);
 assert.equal(customerPageData(customers.slice(0,10),{page:3}).currentPage,1);
 assert.equal(customerPageData(customers,{search:'0900'}).filtered.length,25);
});
