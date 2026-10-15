const pool = require("../config/db");
async function migrate() {
 const [columns] = await pool.query("SHOW COLUMNS FROM `Order`");
 const definitions = {PickupStatus: "VARCHAR(30) NULL", PickupScheduledAt: "DATETIME NULL", PickupSettlementPending: "TINYINT(1) NOT NULL DEFAULT 0"};
 for (const [name, definition] of Object.entries(definitions)) if (!columns.some(c => c.Field === name)) await pool.query(`ALTER TABLE \`Order\` ADD COLUMN ${name} ${definition}`);
 await pool.query("UPDATE `Order` SET PickupStatus=CASE WHEN OrderStatus='Ready' THEN 'Ready for Pickup' ELSE OrderStatus END WHERE OrderType='Pickup' AND PickupStatus IS NULL");
 console.log("Pickup Stage 1 schema ready. Legacy schedules remain NULL and require manual review.");
}
if (require.main === module) migrate().catch(e => {console.error(e.message); process.exitCode=1;}).finally(() => pool.end());
module.exports=migrate;
