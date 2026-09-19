const router = require("express").Router();
const pool = require("../config/db");
const asyncHandler = require("../utils/asyncHandler");
const { authenticate } = require("../middleware/auth");

router.use(authenticate);

router.get(
  "/summary",
  asyncHandler(async (req, res) => {
    const [[salesToday]] = await pool.query(
      `SELECT COALESCE(SUM(TotalAmount),0) AS total, COUNT(*) AS count
       FROM Sales WHERE DATE(SaleDate) = CURDATE()`
    );
    const [[stockAttention]] = await pool.query(`
      SELECT COUNT(*) AS count FROM (
        SELECT p.ProductID FROM Product p
        JOIN Inventory i ON i.ProductID = p.ProductID
        GROUP BY p.ProductID, p.ReorderLevel
        HAVING SUM(i.StockOnHand) <= p.ReorderLevel
      ) t
    `);
    const [[bestSeller]] = await pool.query(`
      SELECT p.ProductName AS name, SUM(od.Quantity) AS qty
      FROM OrderDetails od JOIN Product p ON p.ProductID = od.ProductID
      GROUP BY p.ProductID ORDER BY qty DESC LIMIT 1
    `);
    const [trend] = await pool.query(`
      SELECT DATE(SaleDate) AS day, SUM(TotalAmount) AS value
      FROM Sales WHERE SaleDate >= CURDATE() - INTERVAL 6 DAY
      GROUP BY DATE(SaleDate) ORDER BY day
    `);
    const [restockSuggestions] = await pool.query(`
      SELECT p.ProductID AS id, p.ProductName AS name, SUM(i.StockOnHand) AS stock, p.ReorderLevel AS suggest,
             CASE WHEN SUM(i.StockOnHand) = 0 THEN 'Critical' ELSE 'Low Stock' END AS status
      FROM Product p JOIN Inventory i ON i.ProductID = p.ProductID
      GROUP BY p.ProductID, p.ReorderLevel
      HAVING stock <= p.ReorderLevel
      LIMIT 5
    `);
    const [activity] = await pool.query(`
      SELECT a.Description AS text, a.ActivityDate AS date
      FROM UserActivity a ORDER BY a.ActivityDate DESC LIMIT 10
    `);

    res.json({
      salesPerformance: salesToday.total,
      transactions: salesToday.count,
      stockAttention: stockAttention.count,
      bestSeller: bestSeller?.name || "N/A",
      salesTrend: trend,
      restockSuggestions,
      activityLog: activity,
    });
  })
);

module.exports = router;