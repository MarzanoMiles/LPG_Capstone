const ApiError = require('./apiError');
async function saveVehicleSnapshot(conn, companyId, deliveryId, name) {
  if (name == null || name === '') return;
  if (typeof name !== 'string' || name.length > 100) throw new ApiError(400, 'Invalid vehicle class.');
  const [rows] = await conn.query('SELECT VehicleRates FROM CompanySettings WHERE CompanyID=:companyId', {companyId});
  const raw = rows[0]?.VehicleRates;
  const rates = typeof raw === 'string' ? JSON.parse(raw) : raw || [];
  const rate = rates.find(item => item.name.toLowerCase() === name.trim().toLowerCase());
  if (!rate) throw new ApiError(400, 'This vehicle is no longer configured. Select an available vehicle.');
  // A transaction owns its historical copy; it never joins back to active settings.
  await conn.query('UPDATE Delivery SET VehicleRateSnapshot=:snapshot WHERE DeliveryID=:deliveryId', {
    deliveryId, snapshot: JSON.stringify(rate),
  });
}
module.exports = {saveVehicleSnapshot};
