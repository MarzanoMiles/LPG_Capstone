const pool = require("../config/db");

async function hasColumn(table, column) {
  const [rows] = await pool.query(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND LOWER(TABLE_NAME) = LOWER(?) AND LOWER(COLUMN_NAME) = LOWER(?)`,
    [table, column]
  );
  return rows.length > 0;
}

async function addColumn(table, column, definition) {
  if (await hasColumn(table, column)) return console.log(`= ${table}.${column} exists`);
  await pool.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
  console.log(`+ ${table}.${column}`);
}

async function migrate() {
  // Phase 3: business constraints on Product
  await addColumn("Product", "MinOrderQuantity", "INT UNSIGNED NOT NULL DEFAULT 1");
  await addColumn("Product", "BudgetCap", "DECIMAL(12,2) NULL");
  await addColumn("Product", "PriorityTag", "VARCHAR(10) NOT NULL DEFAULT 'Normal'");

  // Forecast output + dead-stock + override tracking on the recommendation row
  await addColumn("RestockRecommendation", "OriginalSuggestedQty", "INT NULL");
  await addColumn("RestockRecommendation", "SafetyStock", "INT NULL");
  await addColumn("RestockRecommendation", "DaysOfCover", "DECIMAL(10,1) NULL");
  await addColumn("RestockRecommendation", "Sales90d", "INT NULL");
  await addColumn("RestockRecommendation", "DeadStockAlert", "TINYINT(1) NOT NULL DEFAULT 0");
  await addColumn("RestockRecommendation", "BudgetCapped", "TINYINT(1) NOT NULL DEFAULT 0");
  await pool.query(
    "UPDATE RestockRecommendation SET OriginalSuggestedQty = RecommendedQuantity WHERE OriginalSuggestedQty IS NULL"
  );

  // Decision audit log (used for future ML retraining)
  await pool.query(`CREATE TABLE IF NOT EXISTS RestockAuditLog (
    AuditID BIGINT AUTO_INCREMENT PRIMARY KEY,
    RestockID VARCHAR(30) NOT NULL,
    ProductID VARCHAR(30) NOT NULL,
    UserID VARCHAR(30) NOT NULL,
    OriginalSuggestedQty INT NOT NULL,
    FinalQty INT NOT NULL,
    Status VARCHAR(20) NOT NULL,
    OverrideReason VARCHAR(255) NULL,
    \`Timestamp\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_restock_audit_restock (RestockID),
    KEY idx_restock_audit_product (ProductID)
  )`);
  console.log("RestockAuditLog ready");
}

module.exports = migrate;

if (require.main === module) {
  migrate()
    .then(() => console.log("Restock forecasting migration complete."))
    .catch((err) => { console.error(err); process.exitCode = 1; })
    .finally(() => pool.end());
}