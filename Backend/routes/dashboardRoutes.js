const router = require("express").Router();
const pool = require("../config/db");
const asyncHandler = require("../utils/asyncHandler");
const { authenticate } = require("../middleware/auth");

router.use(authenticate);

function pctChange(current, previous) {
  if (!previous) return current > 0 ? 100 : 0;
  return ((current - previous) / previous) * 100;
}

function formatPct(p) {
  const sign = p >= 0 ? "+" : "";
  return `${sign}${p.toFixed(1)}%`;
}

// GET /dashboard/summary
router.get(
  "/summary",
  asyncHandler(async (req, res) => {
    // --- Sales performance: today vs yesterday ---
    const [[salesToday]] = await pool.query(
      `SELECT COALESCE(SUM(TotalAmount),0) AS total, COUNT(*) AS count
       FROM Sales WHERE DATE(SaleDate) = CURDATE()`
    );
    const [[salesYesterday]] = await pool.query(
      `SELECT COALESCE(SUM(TotalAmount),0) AS total, COUNT(*) AS count
       FROM Sales WHERE DATE(SaleDate) = CURDATE() - INTERVAL 1 DAY`
    );

    // --- Stock attention: products at or below reorder level ---
    const [[stockAttention]] = await pool.query(`
      SELECT COUNT(*) AS count FROM (
        SELECT p.ProductID FROM Product p
        JOIN Inventory i ON i.ProductID = p.ProductID
        WHERE p.Status = 'Active'
        GROUP BY p.ProductID, p.ReorderLevel
        HAVING SUM(i.StockOnHand) <= p.ReorderLevel
      ) t
    `);

    // --- Best seller: most units sold in the last 30 days ---
    const [[bestSeller]] = await pool.query(`
      SELECT p.ProductName AS name, SUM(od.Quantity) AS qty
      FROM OrderDetails od
      JOIN Product p ON p.ProductID = od.ProductID
      JOIN \`Order\` o ON o.OrderID = od.OrderID
      WHERE o.OrderDate >= CURDATE() - INTERVAL 30 DAY
      GROUP BY p.ProductID ORDER BY qty DESC LIMIT 1
    `);

    // --- Sales trend: last 7 days, labeled by weekday ---
    const [trendRows] = await pool.query(`
      SELECT DATE(SaleDate) AS day, SUM(TotalAmount) AS value
      FROM Sales
      WHERE SaleDate >= CURDATE() - INTERVAL 6 DAY
      GROUP BY DATE(SaleDate)
    `);
    const trendMap = new Map(trendRows.map((r) => [r.day, Number(r.value)]));
    const salesTrend = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const iso = d.toISOString().slice(0, 10);
      salesTrend.push({
        day: d.toLocaleDateString("en-US", { weekday: "short" }),
        value: trendMap.get(iso) || 0,
      });
    }

    // --- Restock suggestions: top 5 lowest stock-vs-reorder ratio, active products ---
    const [restockSuggestions] = await pool.query(`
      SELECT p.ProductID AS id, p.ProductName AS name, SUM(i.StockOnHand) AS stock, p.ReorderLevel AS suggest,
             CASE WHEN SUM(i.StockOnHand) = 0 THEN 'Critical' ELSE 'Low Stock' END AS status
      FROM Product p
      JOIN Inventory i ON i.ProductID = p.ProductID
      WHERE p.Status = 'Active'
      GROUP BY p.ProductID, p.ReorderLevel
      HAVING stock <= p.ReorderLevel
      ORDER BY (stock / GREATEST(p.ReorderLevel, 1)) ASC
      LIMIT 5
    `);

    // --- Recent activity ---
    const [activityLog] = await pool.query(`
      SELECT a.UserActivityID AS id, a.Description AS text, a.Module AS module,
             a.ActivityType AS action, a.ActivityDate AS date
      FROM UserActivity a
      ORDER BY a.ActivityDate DESC
      LIMIT 6
    `);

    res.json({
      salesPerformance: Number(salesToday.total),
      salesPerformanceChangeLabel: formatPct(pctChange(Number(salesToday.total), Number(salesYesterday.total))),
      transactions: salesToday.count,
      transactionsChangeLabel: formatPct(pctChange(salesToday.count, salesYesterday.count)),
      stockAttention: stockAttention.count,
      bestSeller: bestSeller?.name || "N/A",
      salesTrend,
      restockSuggestions,
      activityLog: activityLog.map((a) => ({
        id: a.id,
        text: a.text || `${a.action} in ${a.module}`,
        date: a.date,
      })),
    });
  })
);

// GET /dashboard/low-stock — full list, for the Stock Attention "View" modal
router.get(
  "/low-stock",
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(`
      SELECT p.ProductID AS id, p.ProductName AS name, SUM(i.StockOnHand) AS stock, p.ReorderLevel AS reorderLevel,
             CASE WHEN SUM(i.StockOnHand) = 0 THEN 'Critical' ELSE 'Low Stock' END AS status
      FROM Product p
      JOIN Inventory i ON i.ProductID = p.ProductID
      WHERE p.Status = 'Active'
      GROUP BY p.ProductID, p.ReorderLevel
      HAVING stock <= p.ReorderLevel
      ORDER BY (stock / GREATEST(p.ReorderLevel, 1)) ASC
    `);
    res.json(rows);
  })
);

// GET /dashboard/top-products?days=30&limit=10 — for the Best Seller "View" modal
router.get(
  "/top-products",
  asyncHandler(async (req, res) => {
    const days = Number(req.query.days) || 30;
    const limit = Number(req.query.limit) || 10;
    const [rows] = await pool.query(
      `SELECT p.ProductID AS id, p.ProductName AS name, SUM(od.Quantity) AS unitsSold,
              SUM(od.Subtotal) AS revenue
       FROM OrderDetails od
       JOIN Product p ON p.ProductID = od.ProductID
       JOIN \`Order\` o ON o.OrderID = od.OrderID
       WHERE o.OrderDate >= CURDATE() - INTERVAL :days DAY
       GROUP BY p.ProductID
       ORDER BY unitsSold DESC
       LIMIT :limit`,
      { days, limit }
    );
    res.json(rows);
  })
);

// GET /dashboard/activity-log?limit=30 — for the "View Logs" modal
router.get(
  "/activity-log",
  asyncHandler(async (req, res) => {
    const limit = Number(req.query.limit) || 30;
    const [rows] = await pool.query(
      `SELECT a.UserActivityID AS id, CONCAT(u.FirstName,' ',u.LastName) AS user,
              a.Module AS module, a.ActivityType AS action, a.Description AS description, a.ActivityDate AS date
       FROM UserActivity a
       JOIN User u ON u.UserID = a.UserID
       ORDER BY a.ActivityDate DESC
       LIMIT :limit`,
      { limit }
    );
    res.json(rows);
  })
);

module.exports = router;