const router = require("express").Router();
const pool = require("../config/db");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/apiError");
const { authenticate } = require("../middleware/auth");

router.use(authenticate);

// Recompute Status based on today's date vs DueDate, for any report not yet Submitted.
// Called before every GET so the badges/calendar always reflect "today" correctly.
async function refreshStatuses() {
  await pool.query(`
    UPDATE ComplianceReport
    SET Status = CASE
      WHEN Status = 'Submitted' THEN 'Submitted'
      WHEN DueDate < CURDATE() THEN 'Overdue'
      WHEN DueDate <= DATE_ADD(CURDATE(), INTERVAL 7 DAY) THEN 'Due Soon'
      ELSE 'Upcoming'
    END
  `);
}

// GET /reports
router.get(
  "/",
  asyncHandler(async (req, res) => {
    await refreshStatuses();
    const [rows] = await pool.query(`
      SELECT ReportID AS id, ReportName AS name, ReportType AS type, PeriodLabel AS period,
             PeriodStart AS periodStart, PeriodEnd AS periodEnd, DueDate AS dueDate,
             Status AS status, SubmittedAt AS submittedAt, FileName AS fileName
      FROM ComplianceReport
      ORDER BY DueDate ASC
    `);
    res.json(rows);
  })
);

// GET /reports/summary — stat cards
router.get(
  "/summary",
  asyncHandler(async (req, res) => {
    await refreshStatuses();
    const [[dueSoon]] = await pool.query(
      `SELECT COUNT(*) AS count FROM ComplianceReport WHERE Status = 'Due Soon'`
    );
    const [[overdue]] = await pool.query(
      `SELECT COUNT(*) AS count FROM ComplianceReport WHERE Status = 'Overdue'`
    );
    const [[submittedThisMonth]] = await pool.query(
      `SELECT COUNT(*) AS count FROM ComplianceReport
       WHERE Status = 'Submitted' AND MONTH(SubmittedAt) = MONTH(CURDATE()) AND YEAR(SubmittedAt) = YEAR(CURDATE())`
    );
    const [[total]] = await pool.query(`SELECT COUNT(*) AS count FROM ComplianceReport`);

    res.json({
      dueSoon: dueSoon.count,
      overdue: overdue.count,
      submittedThisMonth: submittedThisMonth.count,
      total: total.count,
    });
  })
);

// POST /reports — schedule a new compliance report (recurring or one-off)
router.post(
  "/",
  asyncHandler(async (req, res) => {
    const { reportName, reportType, periodLabel, periodStart, periodEnd, dueDate } = req.body;
    if (!reportName || !reportType || !periodLabel || !periodStart || !periodEnd || !dueDate) {
      throw new ApiError(400, "reportName, reportType, periodLabel, periodStart, periodEnd and dueDate are required.");
    }
    const [result] = await pool.query(
      `INSERT INTO ComplianceReport (ReportName, ReportType, PeriodLabel, PeriodStart, PeriodEnd, DueDate, Status)
       VALUES (:reportName, :reportType, :periodLabel, :periodStart, :periodEnd, :dueDate, 'Upcoming')`,
      { reportName, reportType, periodLabel, periodStart, periodEnd, dueDate }
    );
    res.status(201).json({ id: result.insertId });
  })
);

// POST /reports/:id/generate — actually builds the report content from real data and returns it as CSV text.
// Also logs the generation to DataActivityLog so it shows on the Data page too.
router.post(
  "/:id/generate",
  asyncHandler(async (req, res) => {
    const [reportRows] = await pool.query(`SELECT * FROM ComplianceReport WHERE ReportID = :id`, {
      id: req.params.id,
    });
    const report = reportRows[0];
    if (!report) throw new ApiError(404, "Report not found.");

    let csv = "";
    if (report.ReportType === "Sales Summary") {
      const [sales] = await pool.query(
        `SELECT SaleNo, SaleDate, TotalAmount, SalesDiscount
         FROM Sales WHERE SaleDate BETWEEN :start AND :end ORDER BY SaleDate`,
        { start: report.PeriodStart, end: report.PeriodEnd }
      );
      csv = "SaleNo,SaleDate,TotalAmount,Discount\n";
      sales.forEach((s) => {
        csv += `${s.SaleNo},${s.SaleDate},${s.TotalAmount},${s.SalesDiscount}\n`;
      });
    } else if (report.ReportType === "Inventory Audit") {
      const [inventory] = await pool.query(`
        SELECT p.ProductName, w.WarehouseName, i.StockOnHand, p.ReorderLevel
        FROM Inventory i
        JOIN Product p ON p.ProductID = i.ProductID
        JOIN Warehouse w ON w.WarehouseID = i.WarehouseID
      `);
      csv = "ProductName,Warehouse,StockOnHand,ReorderLevel\n";
      inventory.forEach((r) => {
        csv += `${r.ProductName},${r.WarehouseName},${r.StockOnHand},${r.ReorderLevel}\n`;
      });
    } else if (report.ReportType === "Restocking Logs") {
      const [restock] = await pool.query(`
        SELECT p.ProductName, r.StockOnHand, r.RecommendedQuantity, r.Status, r.ForecastDate
        FROM RestockRecommendation r JOIN Product p ON p.ProductID = r.ProductID
        WHERE r.ForecastDate BETWEEN :start AND :end
      `, { start: report.PeriodStart, end: report.PeriodEnd });
      csv = "ProductName,StockOnHand,RecommendedQuantity,Status,ForecastDate\n";
      restock.forEach((r) => {
        csv += `${r.ProductName},${r.StockOnHand},${r.RecommendedQuantity},${r.Status},${r.ForecastDate}\n`;
      });
    } else {
      csv = "No data template defined for this report type.\n";
    }

    const fileName = `${report.ReportName.replace(/\s+/g, "_")}_${Date.now()}.csv`;

    await pool.query(`UPDATE ComplianceReport SET FileName = :fileName WHERE ReportID = :id`, {
      fileName,
      id: req.params.id,
    });

    await pool.query(
      `INSERT INTO DataActivityLog (UserID, ActivityType, DataType, FileName, FileFormat, DateFrom, DateTo, Status)
       VALUES (:userId, 'Generate Report', :dataType, :fileName, 'CSV', :from, :to, 'Successful')`,
      {
        userId: req.user.userId,
        dataType: report.ReportType,
        fileName,
        from: report.PeriodStart,
        to: report.PeriodEnd,
      }
    );

    res.json({ fileName, csv });
  })
);

// PUT /reports/:id/submit — marks a report as officially submitted
router.put(
  "/:id/submit",
  asyncHandler(async (req, res) => {
    const [result] = await pool.query(
      `UPDATE ComplianceReport SET Status = 'Submitted', SubmittedAt = NOW(), SubmittedByUserID = :userId
       WHERE ReportID = :id`,
      { id: req.params.id, userId: req.user.userId }
    );
    if (!result.affectedRows) throw new ApiError(404, "Report not found.");
    res.json({ message: "Report marked as submitted." });
  })
);

router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const [result] = await pool.query(`DELETE FROM ComplianceReport WHERE ReportID = :id`, {
      id: req.params.id,
    });
    if (!result.affectedRows) throw new ApiError(404, "Report not found.");
    res.json({ message: "Report deleted." });
  })
);

module.exports = router;