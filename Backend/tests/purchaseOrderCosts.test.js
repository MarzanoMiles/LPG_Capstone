const {test} = require('node:test');
const assert = require('node:assert/strict');
const {pricePurchaseOrderItems} = require('../utils/purchaseOrderCosts');

test('uses each product database cost, ignoring supplied prices and calculating cents exactly', async () => {
  const queries = [];
  const conn = {async query(sql, params) {
    queries.push({sql, params});
    return [[{CostPrice: params.productId === 'P1' ? '125.25' : '0.10'}]];
  }};
  const result = await pricePurchaseOrderItems(conn, 'S1', [{productId:'P1', qty:2, unitCost:1}, {productId:'P2', qty:3, unitCost:999}]);
  assert.deepEqual(result, {pricedItems:[{productId:'P1',qty:2,unitCost:125.25},{productId:'P2',qty:3,unitCost:0.1}],totalCents:25080});
  assert.ok(queries.every(q => q.sql.includes('FOR UPDATE') && q.params.supplierId === 'S1'));
});
test('rejects unavailable products and invalid database costs', async () => {
  for (const rows of [[], [{CostPrice:null}], [{CostPrice:-1}], [{CostPrice:'invalid'}], [{CostPrice:'1.234'}]]) {
    await assert.rejects(pricePurchaseOrderItems({query:async () => [rows]}, 'S1', [{productId:'P1',qty:1}]), /active|invalid cost/);
  }
});
