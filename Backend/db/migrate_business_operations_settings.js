// Run from Backend: npm run migrate:business-operations
// Adds only missing columns; safe to rerun after a partial migration.
const pool = require("../config/db");

async function migrate() {
  const connection = await pool.getConnection();
  try {
    const [columns] = await connection.query("SHOW COLUMNS FROM CompanySettings");
    const existing = new Set(columns.map((column) => column.Field));
    const definitions = {
      BusinessDays: "VARCHAR(100) NOT NULL DEFAULT 'Monday,Tuesday,Wednesday,Thursday,Friday,Saturday'",
      OpeningTime: "TIME NOT NULL DEFAULT '08:00:00'",
      ClosingTime: "TIME NOT NULL DEFAULT '17:00:00'",
      PickupExpirationDays: "INT UNSIGNED NOT NULL DEFAULT 3",
      MaxDeliveryAttempts: "INT UNSIGNED NOT NULL DEFAULT 3",
    };
    const missing = Object.entries(definitions).filter(([name]) => !existing.has(name));
    if (missing.length) {
      await connection.query(`ALTER TABLE CompanySettings ${missing.map(([name, definition]) => `ADD COLUMN \`${name}\` ${definition}`).join(", ")}`);
    }
    const [verified] = await connection.query("SHOW COLUMNS FROM CompanySettings");
    if (!Object.keys(definitions).every((name) => verified.some((column) => column.Field === name))) {
      throw new Error("Business operations migration verification failed.");
    }
    console.log(missing.length ? `Business operations settings ready: added ${missing.map(([name]) => name).join(", ")}.` : "Business operations settings already up to date.");
  } finally {
    connection.release();
  }
}

if (require.main === module) {
  migrate().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  }).finally(() => pool.end());
}
module.exports = migrate;
