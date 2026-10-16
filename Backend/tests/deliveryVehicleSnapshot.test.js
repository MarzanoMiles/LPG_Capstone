const test = require('node:test');
const assert = require('node:assert/strict');
const {saveVehicleSnapshot} = require('../utils/deliveryVehicleSnapshot');
test('transaction retains its rate snapshot after the active configuration is deleted', async () => {
  let rates = [{name:'Truck',capacityKg:1000,baseRate:100,perKmRate:10,freeDeliverySubtotal:5000}];
  let snapshot;
  const conn = {query: async (sql, params) => {
    if (sql.startsWith('SELECT')) return [[{VehicleRates:rates}]];
    assert.match(sql, /^UPDATE Delivery SET VehicleRateSnapshot/);
    assert.equal(params.deliveryId, 'D-test');
    snapshot = JSON.parse(params.snapshot);
    return [{}];
  }};
  await saveVehicleSnapshot(conn,'C-test','D-test','truck');
  rates = [];
  assert.equal(snapshot.name,'Truck');
  assert.equal(snapshot.baseRate,100);
  await assert.rejects(saveVehicleSnapshot(conn,'C-test','D-test','Truck'), /no longer configured/);
  assert.equal(snapshot.name,'Truck');
});
test('orders without a recorded vehicle do not fabricate historical vehicle details', async () => {
  await saveVehicleSnapshot({query:()=>assert.fail('must not query')},'C-test','D-test',undefined);
});
