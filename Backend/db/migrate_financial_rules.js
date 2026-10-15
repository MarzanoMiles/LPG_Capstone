const pool = require("../config/db");
async function migrate() {
 const conn = await pool.getConnection();
 try {
  const [columns] = await conn.query("SHOW COLUMNS FROM CompanySettings");
  const definitions = {
   AllowIssueRefund: "TINYINT(1) NOT NULL DEFAULT 0",
   EnableCancellationFee: "TINYINT(1) NOT NULL DEFAULT 0",
   CancellationFeeType: "VARCHAR(10) NOT NULL DEFAULT 'Fixed'",
   CancellationFeeValue: "DECIMAL(12,2) NOT NULL DEFAULT 0"
  };
  const missing = Object.entries(definitions).filter(([key]) => !columns.some(c => c.Field === key));
  if (missing.length) await conn.query(`ALTER TABLE CompanySettings ${missing.map(([k,v]) => `ADD COLUMN ${k} ${v}`).join(", ")}`);
  await conn.query(require("fs").readFileSync(require("path").join(__dirname, "patch_refund_ledger.sql"), "utf8"));
  console.log("Financial settings and refund ledger ready.");
 } finally { conn.release(); }
}
if (require.main === module) migrate().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => pool.end());
module.exports = migrate;
