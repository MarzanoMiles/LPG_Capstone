const test = require('node:test');
const assert = require('node:assert/strict');
test('MySQL vehicle CRUD preserves historical snapshots and rolls back verification changes', {skip:process.env.RUN_VEHICLE_DB_TESTS !== '1'}, async () => {
  const pool = require('../config/db');
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[delivery]] = await conn.query('SELECT d.DeliveryID,d.DeliveryCharge,u.CompanyID FROM Delivery d JOIN Sales s ON s.SaleID=d.SaleID JOIN User u ON u.UserID=s.UserID LIMIT 1');
    assert.ok(delivery, 'Requires an existing delivery');
    const rate = {name:'Verification '+Date.now(),capacityKg:25,baseRate:75,perKmRate:12,freeDeliverySubtotal:2000};
    const {syncVehicleRateTable} = require('../utils/vehicleRateStorage');
    await syncVehicleRateTable(conn,delivery.CompanyID,[rate]);
    const [[saved]] = await conn.query('SELECT VehicleID,BaseRate FROM deliveryvehiclerate WHERE CompanyID=:companyId',{companyId:delivery.CompanyID});
    assert.match(saved.VehicleID,/^V-\d{3,}$/);
    await conn.query('UPDATE CompanySettings SET VehicleRates=:rates WHERE CompanyID=:companyId',{companyId:delivery.CompanyID,rates:JSON.stringify([rate])});
    await require('../utils/deliveryVehicleSnapshot').saveVehicleSnapshot(conn,delivery.CompanyID,delivery.DeliveryID,rate.name);
    await syncVehicleRateTable(conn,delivery.CompanyID,[]);
    const [[remaining]] = await conn.query('SELECT COUNT(*) AS n FROM deliveryvehiclerate WHERE CompanyID=:companyId',{companyId:delivery.CompanyID});
    assert.equal(Number(remaining.n),0);
    const [[historical]] = await conn.query('SELECT VehicleRateSnapshot,DeliveryCharge FROM Delivery WHERE DeliveryID=:id',{id:delivery.DeliveryID});
    const snapshot = typeof historical.VehicleRateSnapshot === 'string' ? JSON.parse(historical.VehicleRateSnapshot) : historical.VehicleRateSnapshot;
    assert.deepEqual(snapshot,rate);
    assert.equal(historical.DeliveryCharge,delivery.DeliveryCharge);
  } finally {await conn.rollback();conn.release();await pool.end();}
});
