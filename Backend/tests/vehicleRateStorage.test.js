const test = require('node:test');
const assert = require('node:assert/strict');
const {syncVehicleRateTable} = require('../utils/vehicleRateStorage');
test('new vehicles use sequential padded V identifiers and preserve existing IDs', async () => {
  const written = [];
  const conn = {query:async (sql,params) => {
    if (sql.startsWith('SELECT')) return [[{VehicleID:'V-001',VehicleName:'Motor',FreeDistanceKm:5}]];
    if (sql.startsWith('INSERT INTO EntityIdSequence')) {
      assert.equal(params.entity,'deliveryvehiclerate');
      assert.equal(params.pattern,'^V-[0-9]{3,9}$');
      return [{insertId:2}];
    }
    assert.match(sql,/^INSERT INTO deliveryvehiclerate/);
    written.push(params.id); return [{}];
  }};
  const rate = {capacityKg:10,baseRate:10,perKmRate:1,freeDeliverySubtotal:0};
  await syncVehicleRateTable(conn,'C-test',[{...rate,name:'Motor'},{...rate,name:'Truck'}]);
  assert.deepEqual(written,['V-001','V-002']);
});
test('deleting the matrix physically removes active rows without touching deliveries', async () => {
  const deleted = [];
  const conn = {query:async (sql,params) => {
    if (sql.startsWith('SELECT')) return [[{VehicleID:'cargo',VehicleName:'Cargo'},{VehicleID:'motor',VehicleName:'Motor'}]];
    assert.equal(sql,'DELETE FROM deliveryvehiclerate WHERE VehicleID=:id AND CompanyID=:companyId');
    assert.equal(params.companyId,'C-test'); deleted.push(params.id); return [{}];
  }};
  await syncVehicleRateTable(conn,'C-test',[]);
  assert.deepEqual(deleted,['cargo','motor']);
});
