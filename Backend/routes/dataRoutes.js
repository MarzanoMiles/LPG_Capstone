const router = require("express").Router();
const pool = require("../config/db");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/apiError");
const { authenticate } = require("../middleware/auth");
const { buildCsv, buildXlsx, buildPdf } = require("../utils/fileGenerators");
const { resolveDateRange } = require("../utils/dateRanges");

router.use(authenticate);

// GET /data/logs?activityType=Export|Import|Generate Report
router.get(
  "/logs",
  asyncHandler(async (req, res) => {
    const { activityType } = req.query;
    let sql = `
      SELECT DataActivityID AS id, FileName AS file, DataType AS type, FileFormat AS format,
             Status AS status, ActivityDate AS date, DateFrom AS dateFrom, DateTo AS dateTo
      FROM DataActivityLog WHERE 1=1`;
    const params = {};
    if (activityType) {
      sql += ` AND ActivityType = :activityType`;
      params.activityType = activityType;
    }
    sql += ` ORDER BY ActivityDate DESC LIMIT 200`;
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  })
);

// Query builders per data type — each returns { title, headers, rows }
async function queryDataset(dataType, start, end) {
  if (dataType === "Sales Data") {
    const [rows] = await pool.query(
      `SELECT s.SaleNo, s.SaleDate, CONCAT(u.FirstName,' ',u.LastName) AS Cashier,
              s.SalesDiscount, s.TotalAmount, o.OrderType, o.OrderStatus
       FROM Sales s
       JOIN User u ON u.UserID = s.UserID
       LEFT JOIN \`Order\` o ON o.OrderID = s.OrderID
       WHERE DATE(s.SaleDate) BETWEEN :start AND :end
       ORDER BY s.SaleDate`,
      { start, end }
    );
    return {
      title: "Sales Data",
      headers: ["Sale No", "Sale Date", "Cashier", "Discount", "Total Amount", "Order Type", "Order Status"],
      rows: rows.map((r) => [r.SaleNo, r.SaleDate, r.Cashier, r.SalesDiscount, r.TotalAmount, r.OrderType, r.OrderStatus]),
    };
  }

  // Re-importable format: one row per line item, matching exactly what
  // POST /sales/import (see salesRoutes.js) and the Sales page's CSV importer expect.
  // CSV-only in practice, but we still support Excel/PDF for consistency with other datasets.
  if (dataType === "Sales Line Items") {
    const [rows] = await pool.query(
      `SELECT s.SaleNo, od.ProductID, od.Quantity, od.UnitPrice, s.SalesDiscount,
              COALESCE(pay.PaymentMethod, 'Cash') AS PaymentMethod, s.SaleDate
       FROM Sales s
       JOIN OrderDetails od ON od.OrderID = s.OrderID
       LEFT JOIN Payment pay ON pay.SaleID = s.SaleID
       WHERE DATE(s.SaleDate) BETWEEN :start AND :end
       ORDER BY s.SaleDate, s.SaleID`,
      { start, end }
    );
    return {
      title: "Sales Line Items (re-importable)",
      headers: ["SaleRef", "ProductID", "Quantity", "UnitPrice", "Discount", "PaymentMethod", "SaleDate"],
      rows: rows.map((r) => [r.SaleNo, r.ProductID, r.Quantity, r.UnitPrice, r.SalesDiscount, r.PaymentMethod, r.SaleDate]),
    };
  }

  if (dataType === "Inventory Data") {
    const [rows] = await pool.query(`
      SELECT p.ProductID, p.ProductName, w.WarehouseName, i.StockOnHand, p.ReorderLevel, i.LastUpdated
      FROM Inventory i
      JOIN Product p ON p.ProductID = i.ProductID
      JOIN Warehouse w ON w.WarehouseID = i.WarehouseID
      ORDER BY p.ProductID
    `);
    return {
      title: "Inventory Data (Current Snapshot)",
      headers: ["Product ID", "Product Name", "Warehouse", "Stock On Hand", "Reorder Level", "Last Updated"],
      rows: rows.map((r) => [r.ProductID, r.ProductName, r.WarehouseName, r.StockOnHand, r.ReorderLevel, r.LastUpdated]),
    };
  }

  if (dataType === "Products Data") {
    const [rows] = await pool.query(`
      SELECT p.ProductID, p.ProductName, c.Category, b.Brand, s.SupplierName,
             p.UnitPrice, p.CostPrice, p.ReorderLevel, p.Status
      FROM Product p
      JOIN Category c ON c.CategoryID = p.CategoryID
      JOIN Brand b ON b.BrandID = p.BrandID
      JOIN Supplier s ON s.SupplierID = p.SupplierID
      ORDER BY p.ProductID
    `);
    return {
      title: "Products Data",
      headers: ["Product ID", "Name", "Category", "Brand", "Supplier", "Unit Price", "Cost Price", "Reorder Level", "Status"],
      rows: rows.map((r) => [r.ProductID, r.ProductName, r.Category, r.Brand, r.SupplierName, r.UnitPrice, r.CostPrice, r.ReorderLevel, r.Status]),
    };
  }

  if (dataType === "Restocking Logs") {
    const [rows] = await pool.query(
      `SELECT r.RestockID, p.ProductName, s.SupplierName, r.StockOnHand, r.RecommendedQuantity, r.Status, r.ForecastDate
       FROM RestockRecommendation r
       JOIN Product p ON p.ProductID = r.ProductID
       JOIN Supplier s ON s.SupplierID = r.SupplierID
       WHERE r.ForecastDate BETWEEN :start AND :end
       ORDER BY r.ForecastDate`,
      { start, end }
    );
    return {
      title: "Restocking Logs",
      headers: ["Restock ID", "Product", "Supplier", "Stock On Hand", "Recommended Qty", "Status", "Forecast Date"],
      rows: rows.map((r) => [r.RestockID, r.ProductName, r.SupplierName, r.StockOnHand, r.RecommendedQuantity, r.Status, r.ForecastDate]),
    };
  }

  if (dataType === "Supplier Records") {
    const [rows] = await pool.query(`
      SELECT SupplierID, SupplierName, ContactPerson, Email, Contact, Address, LeadTimeDays, Status
      FROM Supplier ORDER BY SupplierID
    `);
    return {
      title: "Supplier Records",
      headers: ["Supplier ID", "Name", "Contact Person", "Email", "Phone", "Address", "Lead Time (days)", "Status"],
      rows: rows.map((r) => [r.SupplierID, r.SupplierName, r.ContactPerson, r.Email, r.Contact, r.Address, r.LeadTimeDays, r.Status]),
    };
  }

  throw new ApiError(400, `Unsupported data type: ${dataType}`);
}

// POST /data/export  { dataType, dateRange, dateFrom?, dateTo?, format }
// format: "CSV" | "Excel" | "PDF"
// Returns the file content as base64 so the frontend can trigger a download without a static file server.
router.post(
  "/export",
  asyncHandler(async (req, res) => {
    const { dataType, dateRange, dateFrom, dateTo, format } = req.body;
    if (!dataType || !format) throw new ApiError(400, "dataType and format are required.");

    let start, end;
    try {
      ({ start, end } = resolveDateRange(dateRange || "Today", dateFrom, dateTo));
    } catch (err) {
      throw new ApiError(400, err.message);
    }

    const dataset = await queryDataset(dataType, start, end);

    let buffer, mimeType, extension;
    if (format === "CSV") {
      buffer = Buffer.from(buildCsv(dataset.headers, dataset.rows), "utf-8");
      mimeType = "text/csv";
      extension = "csv";
    } else if (format === "Excel") {
      buffer = await buildXlsx(dataset.title, dataset.headers, dataset.rows);
      mimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      extension = "xlsx";
    } else if (format === "PDF") {
      buffer = await buildPdf(dataset.title, dataset.headers, dataset.rows);
      mimeType = "application/pdf";
      extension = "pdf";
    } else {
      throw new ApiError(400, `Unsupported format: ${format}`);
    }

    const fileName = `${dataType.replace(/\s+/g, "_")}_${Date.now()}.${extension}`;

    await pool.query(
      `INSERT INTO DataActivityLog (UserID, ActivityType, DataType, FileName, FileFormat, DateFrom, DateTo, Status)
       VALUES (:userId, 'Export', :dataType, :fileName, :format, :start, :end, 'Successful')`,
      { userId: req.user.userId, dataType, fileName, format, start, end }
    );

    res.status(201).json({
      fileName,
      mimeType,
      rowCount: dataset.rows.length,
      fileBase64: buffer.toString("base64"),
    });
  })
);

// POST /data/import { dataType, fileName, format }  -- logging only; see Sales page for real CSV sales import
router.post(
  "/import",
  asyncHandler(async (req, res) => {
    const { dataType, fileName, format } = req.body;
    if (!dataType || !fileName) throw new ApiError(400, "dataType and fileName are required.");
    const [result] = await pool.query(
      `INSERT INTO DataActivityLog (UserID, ActivityType, DataType, FileName, FileFormat, Status)
       VALUES (:userId, 'Import', :dataType, :fileName, :format, 'Successful')`,
      { userId: req.user.userId, dataType, fileName, format: format || "CSV" }
    );
    res.status(201).json({ id: result.insertId });
  })
);

module.exports = router;