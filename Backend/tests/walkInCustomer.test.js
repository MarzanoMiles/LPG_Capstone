const {test}=require('node:test');
const assert=require('node:assert/strict');
const {resolveWalkInCustomer}=require('../utils/walkInCustomer');

test('walk-in resolution always uses CUST-001 and creates that exact ID when absent',async()=>{
  const queries=[];
  const conn={query:async(sql)=>{queries.push(sql);return [[]];}};
  assert.equal(await resolveWalkInCustomer(conn),'CUST-001');
  assert.match(queries[1],/VALUES\('CUST-001'/);
  assert.equal(await resolveWalkInCustomer({query:async()=>[[{CustomerID:'CUST-001',ContactNo:'WALKIN'}]]}),'CUST-001');
});

test('walk-in resolution refuses to overwrite a real customer at the reserved ID',async()=>{
  await assert.rejects(resolveWalkInCustomer({query:async()=>[[{CustomerID:'CUST-001',ContactNo:'09123456789'}]]}),/belongs to another customer/);
});
