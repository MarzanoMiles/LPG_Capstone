const router = require("express").Router();
const pool = require("../config/db");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/apiError");
const { authenticate } = require("../middleware/auth");
const { getRestockPredictions } = require("../utils/mlClient");

router.use(authenticate);

// Builds the feature payload the ML service expects for a single product.
async function buildFeaturesForProduct(product) {
  const { ProductID: productId, ReorderLevel: reorderLevel, LeadTimeDays: leadTimeDays, stockOnHand } = product;

  const salesForDays = async (days) => {
    const [[row]] = await pool.query(
      `SELECT COALESCE(SUM(od.Quantity), 0) AS qty
       FROM OrderDetails od JOIN \`Order\` o ON o.OrderID = od.OrderID
       WHERE od.ProductID = :pid AND o.OrderDate >= DATE_SUB(NOW(), INTERVAL ${Number(days)} DAY)`,
      { pid: productId }
    );
    return Number(row.qty);
  };

  const [sales7, sales30, sales90] = await Promise.all([
    salesForDays(7),
    salesForDays(30),
    salesForDays(90),
  ]);

  const [[lastRestock]] = await pool.query(
    `SELECT MAX(t.TransactionDate) AS lastDate
     FROM InventoryTransaction t
     JOIN Inventory i ON i.InventoryID = t.InventoryID
     WHERE i.ProductID = :pid AND t.TransactionType = 'Stock In' AND t.Reason = 'Purchase'`,
    { pid: productId }
  );

  const daysSinceLastRestock = lastRestock.lastDate
    ? Math.floor((Date.now() - new Date(lastRestock.lastDate).getTime()) / 86400000)
    : 30;

  return {
    productId,
    current_stock: Number(stockOnHand),
    reorder_level: reorderLevel,
    sales_7d: sales7,
    sales_30d: sales30,
    sales_90d: sales90,
    lead_time_days: leadTimeDays || 3,
    days_since_last_restock: daysSinceLastRestock,
  };
}

// Scores pending recommendations with the ML model (falls back to a heuristic
// automatically if the ML service is down — see utils/mlClient.js) and saves
// the confidence + live stock back onto each row.
//   onlyMissing = true  -> only rows whose Confidence is still NULL
//   onlyMissing = false -> every pending row (refresh)
async function rescorePending({ onlyMissing }) {
  const [rows] = await pool.query(
    `SELECT r.RestockID, p.ProductID, p.ReorderLevel, sup.LeadTimeDays,
            COALESCE(SUM(i.StockOnHand), 0) AS stockOnHand
     FROM RestockRecommendation r
     JOIN Product p ON p.ProductID = r.ProductID
     JOIN Supplier sup ON sup.SupplierID = r.SupplierID
     LEFT JOIN Inventory i ON i.ProductID = p.ProductID
     WHERE r.Status = 'Pending' ${onlyMissing ? "AND r.Confidence IS NULL" : ""}
     GROUP BY r.RestockID, p.ProductID, p.ReorderLevel, sup.LeadTimeDays`
  );
  if (!rows.length) return 0;

  const featuresList = await Promise.all(rows.map(buildFeaturesForProduct));
  const predictions = await getRestockPredictions(featuresList);
  const predictionByProductId = new Map(predictions.map((p) => [p.productId, p]));

  let updated = 0;
  for (const row of rows) {
    const prediction = predictionByProductId.get(row.ProductID);
    if (!prediction) continue;
    await pool.query(
      `UPDATE RestockRecommendation
       SET Confidence = :confidence, StockOnHand = :stock
       WHERE RestockID = :id`,
      { confidence: prediction.confidence, stock: row.stockOnHand, id: row.RestockID }
    );
    updated++;
  }
  return updated;
}

// GET /restocking?priority=
// Self-healing: any pending row that has no confidence yet (e.g. created
// before the ML service was added) is scored right here before returning.
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { priority } = req.query;

    try {
      await rescorePending({ onlyMissing: true });
    } catch (err) {
      console.warn("Could not backfill restock confidence:", err.message);
    }

    const sql = `
      SELECT r.RestockID AS restockId, r.ProductID AS productId, p.ProductName AS productName,
             p.Unit AS unit, p.CostPrice AS costPrice, r.SupplierID AS supplierId,
             s.SupplierName AS supplierName, r.StockOnHand AS currentStock, p.ReorderLevel AS reorderLevel,
             r.RecommendedQuantity AS suggestedQty, r.Confidence AS confidence,
             r.Status AS status, r.ForecastDate AS forecastDate,
             CASE WHEN r.StockOnHand <= p.ReorderLevel THEN 'Critical' ELSE 'Low' END AS priority
      FROM RestockRecommendation r
      JOIN Product p ON p.ProductID = r.ProductID
      JOIN Supplier s ON s.SupplierID = r.SupplierID
      WHERE r.Status = 'Pending'
      ORDER BY r.Confidence DESC, r.CreatedAt DESC`;
    const [rows] = await pool.query(sql);
    const filtered = priority ? rows.filter((r) => r.priority === priority) : rows;
    res.json(filtered);
  })
);

// Auto-generate restock recommendations from current inventory vs reorder
// level, scored by the ML confidence model. Also refreshes the confidence of
// recommendations that already exist.
router.post(
  "/generate",
  asyncHandler(async (req, res) => {
    const [lowStock] = await pool.query(`
      SELECT p.ProductID, p.SupplierID, p.ReorderLevel, sup.LeadTimeDays,
             SUM(i.StockOnHand) AS stockOnHand
      FROM Product p
      JOIN Inventory i ON i.ProductID = p.ProductID
      JOIN Supplier sup ON sup.SupplierID = p.SupplierID
      WHERE p.Status = 'Active'
      GROUP BY p.ProductID, p.SupplierID, p.ReorderLevel, sup.LeadTimeDays
      HAVING stockOnHand <= p.ReorderLevel
    `);

    const [pendingRows] = await pool.query(
      `SELECT ProductID FROM RestockRecommendation WHERE Status = 'Pending'`
    );
    const pendingProductIds = new Set(pendingRows.map((r) => r.ProductID));
    const candidates = lowStock.filter((row) => !pendingProductIds.has(row.ProductID));

    const created = [];
    if (candidates.length) {
      const featuresList = await Promise.all(candidates.map(buildFeaturesForProduct));
      const predictions = await getRestockPredictions(featuresList);
      const predictionByProductId = new Map(predictions.map((p) => [p.productId, p]));

      for (const row of candidates) {
        const prediction = predictionByProductId.get(row.ProductID);
        const recommendedQty =
          prediction?.recommendedQuantity ?? Math.max(row.ReorderLevel * 2 - row.stockOnHand, row.ReorderLevel);
        const confidence = prediction?.confidence ?? null;

        const [result] = await pool.query(
          `INSERT INTO RestockRecommendation
            (ProductID, SupplierID, StockOnHand, PredictedDemand, RecommendedQuantity, Confidence, ForecastDate, Status)
           VALUES (:productId, :supplierId, :stock, :predicted, :recommended, :confidence, CURDATE(), 'Pending')`,
          {
            productId: row.ProductID,
            supplierId: row.SupplierID,
            stock: row.stockOnHand,
            predicted: recommendedQty,
            recommended: recommendedQty,
            confidence,
          }
        );
        created.push(result.insertId);
      }
    }

    // Refresh the pre-existing pending rows too, so nothing is left unscored.
    const refreshed = await rescorePending({ onlyMissing: false });

    res.status(201).json({ created: created.length, ids: created, refreshed });
  })
);

// POST /restocking/rescore — recompute confidence for every pending row on demand.
router.post(
  "/rescore",
  asyncHandler(async (req, res) => {
    const refreshed = await rescorePending({ onlyMissing: false });
    res.json({ refreshed, message: `Re-scored ${refreshed} recommendation(s).` });
  })
);

// POST /restocking/:productId/quick — single-product ML-scored recommendation,
// used by the Dashboard's reorder icon.
router.post(
  "/:productId/quick",
  asyncHandler(async (req, res) => {
    const [existing] = await pool.query(
      `SELECT RestockID FROM RestockRecommendation WHERE ProductID = :pid AND Status = 'Pending'`,
      { pid: req.params.productId }
    );
    if (existing[0]) {
      return res.json({ restockId: existing[0].RestockID, message: "Already queued for restocking." });
    }

    const [productRows] = await pool.query(
      `SELECT p.ProductID, p.SupplierID, p.ReorderLevel, sup.LeadTimeDays,
              COALESCE(SUM(i.StockOnHand),0) AS stockOnHand
       FROM Product p
       JOIN Supplier sup ON sup.SupplierID = p.SupplierID
       LEFT JOIN Inventory i ON i.ProductID = p.ProductID
       WHERE p.ProductID = :pid GROUP BY p.ProductID, p.SupplierID, p.ReorderLevel, sup.LeadTimeDays`,
      { pid: req.params.productId }
    );
    if (!productRows[0]) throw new ApiError(404, "Product not found.");
    const p = productRows[0];

    const features = await buildFeaturesForProduct(p);
    const [prediction] = await getRestockPredictions([features]);
    const recommendedQty =
      prediction?.recommendedQuantity ?? Math.max(p.ReorderLevel * 2 - p.stockOnHand, p.ReorderLevel);
    const confidence = prediction?.confidence ?? null;

    const [result] = await pool.query(
      `INSERT INTO RestockRecommendation
        (ProductID, SupplierID, StockOnHand, PredictedDemand, RecommendedQuantity, Confidence, ForecastDate, Status)
       VALUES (:productId, :supplierId, :stock, :predicted, :recommended, :confidence, CURDATE(), 'Pending')`,
      {
        productId: p.ProductID,
        supplierId: p.SupplierID,
        stock: p.stockOnHand,
        predicted: recommendedQty,
        recommended: recommendedQty,
        confidence,
      }
    );

    res.status(201).json({ restockId: result.insertId, message: "Added to the restocking queue." });
  })
);

// PUT /restocking/:id  { recommendedQuantity?, status? }
router.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const { recommendedQuantity, status } = req.body;
    const [result] = await pool.query(
      `UPDATE RestockRecommendation SET
         RecommendedQuantity = COALESCE(:qty, RecommendedQuantity),
         Status = COALESCE(:status, Status)
       WHERE RestockID = :id`,
      { id: req.params.id, qty: recommendedQuantity ?? null, status: status || null }
    );
    if (!result.affectedRows) throw new ApiError(404, "Restock recommendation not found.");
    res.json({ message: "Restock recommendation updated." });
  })
);

router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const [result] = await pool.query(`DELETE FROM RestockRecommendation WHERE RestockID = :id`, {
      id: req.params.id,
    });
    if (!result.affectedRows) throw new ApiError(404, "Restock recommendation not found.");
    res.json({ message: "Restock recommendation deleted." });
  })
);

module.exports = router;