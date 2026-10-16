const test=require('node:test');
const assert=require('node:assert/strict');
const {resourceFor,describeAction,historicalDescription}=require('../utils/activityDescriptions');
const {mapActivityRow}=require('../utils/activityLog');
test('supplier and user changes have readable descriptions without SQL or routes',()=>{
  assert.equal(describeAction('Update',resourceFor('/suppliers/SUP-001'),['SupplierName']),'Updated supplier name.');
  assert.equal(describeAction('Update','supplier',['SupplierName','Contact']),'Updated supplier name and contact number.');
  assert.equal(describeAction('Update','user',['ModuleAccess']),'Updated user module access.');
  assert.equal(describeAction('Preview',resourceFor('/purchase-orders/document-preview')),'Previewed a purchase order document.');
});
test('legacy request descriptions are displayed as readable text without changing stored rows',()=>{
  const row={description:'GET /users/activity-log',module:'Users',action:'View',datetime:1700000000};
  assert.equal(mapActivityRow(row,'datetime').description,'Viewed the activity log.');
  assert.equal(row.description,'GET /users/activity-log');
  assert.equal(historicalDescription('PUT /suppliers/SUP-001; changed Supplier; fields: SupplierName'),'Updated supplier details.');
  assert.equal(historicalDescription('Denied GET /users'),'Attempted to access user management without permission.');
});
test('existing readable snapshot descriptions are preserved',()=>{
  assert.equal(historicalDescription('Renamed supplier from Old Name to New Name.'),'Renamed supplier from Old Name to New Name.');
  assert.equal(describeAction('Logout','account'),'User signed out.');
});
