const router = require("express").Router();
const pool = require("../config/db");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/apiError");
const { authenticate } = require("../middleware/auth");

router.use(authenticate);

// GET /restocking?priority=
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { priority } = req.query;
    const sql = `
      SELECT r.RestockID AS restockId, r.ProductID AS productId, p.ProductName AS productName,
             p.Unit AS unit, p.CostPrice AS costPrice, r.SupplierID AS supplierId,
             s.SupplierName AS supplierName, r.StockOnHand AS currentStock, p.ReorderLevel AS reorderLevel,
             r.RecommendedQuantity AS suggestedQty, r.Status AS status, r.ForecastDate AS forecastDate,
             CASE WHEN r.StockOnHand <= p.ReorderLevel THEN 'Critical' ELSE 'Low' END AS priority
      FROM RestockRecommendation r
      JOIN Product p ON p.ProductID = r.ProductID
      JOIN Supplier s ON s.SupplierID = r.SupplierID
      WHERE r.Status = 'Pending'
      ORDER BY r.CreatedAt DESC`;
    const [rows] = await pool.query(sql);
    const filtered = priority ? rows.filter((r) => r.priority === priority) : rows;
    res.json(filtered);
  })
);

// Auto-generate restock recommendations from current inventory vs reorder level.
// Skips products that already have a Pending recommendation, so re-running is safe.
router.post(
  "/generate",
  asyncHandler(async (req, res) => {
    const [lowStock] = await pool.query(`
      SELECT p.ProductID, p.SupplierID, SUM(i.StockOnHand) AS stockOnHand, p.ReorderLevel
      FROM Product p
      JOIN Inventory i ON i.ProductID = p.ProductID
      WHERE p.Status = 'Active'
      GROUP BY p.ProductID, p.SupplierID, p.ReorderLevel
      HAVING stockOnHand <= p.ReorderLevel
    `);

    const [pendingRows] = await pool.query(
      `SELECT ProductID FROM RestockRecommendation WHERE Status = 'Pending'`
    );
    const pendingProductIds = new Set(pendingRows.map((r) => r.ProductID));

    const created = [];
    for (const row of lowStock) {
      if (pendingProductIds.has(row.ProductID)) continue; // already has an open recommendation

      const recommendedQty = Math.max(row.ReorderLevel * 2 - row.stockOnHand, row.ReorderLevel);
      const [result] = await pool.query(
        `INSERT INTO RestockRecommendation
          (ProductID, SupplierID, StockOnHand, PredictedDemand, RecommendedQuantity, ForecastDate, Status)
         VALUES (:productId, :supplierId, :stock, :predicted, :recommended, CURDATE(), 'Pending')`,
        {
          productId: row.ProductID,
          supplierId: row.SupplierID,
          stock: row.stockOnHand,
          predicted: recommendedQty,
          recommended: recommendedQty,
        }
      );
      created.push(result.insertId);
    }
    res.status(201).json({ created: created.length, ids: created });
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