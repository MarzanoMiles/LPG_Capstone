const pool = require('../config/db');

async function migrate() {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const table of ['Product', 'ProductHistory']) {
      // Only remove a recognized unit suffix; leave unknown or missing sizes intact.
      const [result] = await conn.query(`UPDATE ${table}
        SET UnitValue = REGEXP_SUBSTR(TRIM(UnitValue), '^[0-9]+([.][0-9]+)?')
        WHERE TRIM(UnitValue) REGEXP '^[0-9]+([.][0-9]+)?[ ]*(kg|m|pc|pcs|meter|set|unit)$'
          AND LOWER(TRIM(UnitValue)) = CONCAT(REGEXP_SUBSTR(TRIM(UnitValue), '^[0-9]+([.][0-9]+)?'), ' ', LOWER(Unit))`);
      console.log(`${table}: normalized ${result.affectedRows} unit values.`);
    }
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally { conn.release(); }
}
if (require.main === module) migrate().catch(error => { console.error(error.message); process.exitCode=1; }).finally(() => pool.end());
module.exports = migrate;
