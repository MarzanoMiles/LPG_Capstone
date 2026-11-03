const pool = require("../config/db");
(async () => {
  try {
    for (const column of ["RefundMethod", "AccountName", "AccountNumber"]) {
      const [[row]] = await pool.query(
        `SELECT COLUMN_TYPE AS type, IS_NULLABLE AS nullable FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'PickupSettlement' AND COLUMN_NAME = ?`, [column]);
      if (!row) { console.log(`- ${column} not found, skipped`); continue; }
      if (row.nullable === "YES") { console.log(`= ${column} already nullable`); continue; }
      await pool.query(`ALTER TABLE PickupSettlement MODIFY \`${column}\` ${row.type} NULL`);
      console.log(`+ ${column} now nullable`);
    }
  } catch (err) { console.error(err); process.exitCode = 1; }
  finally { await pool.end(); }
})();