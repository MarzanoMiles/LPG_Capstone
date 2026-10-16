const {nextEntityId} = require('./entityIds');
// Keep the legacy rate table consistent with the Settings matrix. Historical
// deliveries own snapshots and never depend on these active configuration rows.
async function syncVehicleRateTable(conn, companyId, rates) {
  const [existing] = await conn.query('SELECT VehicleID, VehicleName, FreeDistanceKm FROM deliveryvehiclerate WHERE CompanyID=:companyId FOR UPDATE', {companyId});
  const retained = [];
  for (const rate of rates) {
    const previous = existing.find(row => row.VehicleName.trim().toLowerCase() === rate.name.toLowerCase());
    const id = previous?.VehicleID || await nextEntityId(conn, 'deliveryvehiclerate');
    retained.push(id);
    await conn.query(`INSERT INTO deliveryvehiclerate
      (VehicleID,CompanyID,VehicleName,CapacityLabel,MaxWeightKg,BaseRate,PerKm,MinSubtotalForFree,FreeDistanceKm,Enabled)
      VALUES (:id,:companyId,:name,:capacityLabel,:capacityKg,:baseRate,:perKmRate,:freeDeliverySubtotal,:freeDistanceKm,1)
      ON DUPLICATE KEY UPDATE VehicleName=VALUES(VehicleName),CapacityLabel=VALUES(CapacityLabel),MaxWeightKg=VALUES(MaxWeightKg),BaseRate=VALUES(BaseRate),PerKm=VALUES(PerKm),MinSubtotalForFree=VALUES(MinSubtotalForFree),Enabled=1`, {
      ...rate,id,companyId,capacityLabel:`Up to ${rate.capacityKg} kg`,freeDistanceKm:previous?.FreeDistanceKm ?? 5,
    });
  }
  for (const row of existing) {
    if (!retained.includes(row.VehicleID)) await conn.query('DELETE FROM deliveryvehiclerate WHERE VehicleID=:id AND CompanyID=:companyId',{id:row.VehicleID,companyId});
  }
}
module.exports = {syncVehicleRateTable};
