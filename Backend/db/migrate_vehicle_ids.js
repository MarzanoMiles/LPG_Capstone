const pool = require('../config/db');
const {nextEntityId} = require('../utils/entityIds');
async function migrate() {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query('SELECT VehicleID FROM deliveryvehiclerate ORDER BY CompanyID,VehicleName FOR UPDATE');
    let count = 0;
    for (const row of rows) {
      if (/^V-\d{3,}$/.test(row.VehicleID)) continue;
      const id = await nextEntityId(conn,'deliveryvehiclerate');
      await conn.query('UPDATE deliveryvehiclerate SET VehicleID=:id WHERE VehicleID=:previousId',{id,previousId:row.VehicleID});
      count++;
    }
    await conn.commit();
    console.log(`Vehicle IDs ready (V-001 format). Converted ${count} existing IDs.`);
  } catch (error) {await conn.rollback(); throw error;}
  finally {conn.release();}
}
if (require.main === module) migrate().catch(error => {
  console.error(error.message); process.exitCode = 1;
}).finally(() => pool.end());
module.exports = migrate;
