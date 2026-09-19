const router = require("express").Router();
const pool = require("../config/db");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/apiError");
const { authenticate } = require("../middleware/auth");

router.use(authenticate);

// GET /products?search=&category=&status=
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { search, category, status } = req.query;
    let sql = `
      SELECT p.ProductID AS productId, p.ProductName AS name, c.Category AS category,
             s.SupplierName AS supplier, p.Unit AS unit, p.UnitPrice AS unitPrice,
             p.CostPrice AS costPrice, p.ReorderLevel AS reorderLevel,
             p.ImageURL AS imageUrl, p.ARModelURL AS arModelUrl, p.Status AS status,
             COALESCE(SUM(i.StockOnHand), 0) AS stock
      FROM Product p
      JOIN Category c ON c.CategoryID = p.CategoryID
      JOIN Supplier s ON s.SupplierID = p.SupplierID
      LEFT JOIN Inventory i ON i.ProductID = p.ProductID
      WHERE 1=1`;
    const params = {};
    if (search) {
      sql += ` AND (p.ProductName LIKE :search OR p.ProductID = :searchId)`;
      params.search = `%${search}%`;
      params.searchId = Number(search) || 0;
    }
    if (category) {
      sql += ` AND c.Category = :category`;
      params.category = category;
    }
    if (status) {
      sql += ` AND p.Status = :status`;
      params.status = status;
    }
    sql += ` GROUP BY p.ProductID ORDER BY p.ProductID DESC`;
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  })
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT p.*, c.Category, b.Brand, s.SupplierName
       FROM Product p
       JOIN Category c ON c.CategoryID = p.CategoryID
       JOIN Brand b ON b.BrandID = p.BrandID
       JOIN Supplier s ON s.SupplierID = p.SupplierID
       WHERE p.ProductID = :id`,
      { id: req.params.id }
    );
    if (!rows[0]) throw new ApiError(404, "Product not found.");
    res.json(rows[0]);
  })
);

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const {
      productName, categoryId, brandId, supplierId, unit,
      unitPrice, costPrice, reorderLevel, imageUrl, arModelUrl, status,
    } = req.body;

    if (!productName || !categoryId || !brandId || !supplierId || !unit) {
      throw new ApiError(400, "productName, categoryId, brandId, supplierId and unit are required.");
    }

    const [result] = await pool.query(
      `INSERT INTO Product
        (ProductName, CategoryID, BrandID, SupplierID, Unit, UnitPrice, CostPrice, ReorderLevel, ImageURL, ARModelURL, Status)
       VALUES
        (:productName, :categoryId, :brandId, :supplierId, :unit, :unitPrice, :costPrice, :reorderLevel, :imageUrl, :arModelUrl, :status)`,
      {
        productName, categoryId, brandId, supplierId, unit,
        unitPrice: unitPrice || 0,
        costPrice: costPrice || 0,
        reorderLevel: reorderLevel || 0,
        imageUrl: imageUrl || null,
        arModelUrl: arModelUrl || null,
        status: status || "Active",
      }
    );

    await pool.query(
      `INSERT INTO UserActivity (UserID, ActivityType, Module, RecordID, Description)
       VALUES (:userId, 'Create', 'Products', :recordId, 'Created a new product')`,
      { userId: req.user.userId, recordId: result.insertId }
    );

    res.status(201).json({ productId: result.insertId });
  })
);

router.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const fields = [
      "ProductName", "CategoryID", "BrandID", "SupplierID", "Unit",
      "UnitPrice", "CostPrice", "ReorderLevel", "ImageURL", "ARModelURL", "Status",
    ];
    const body = req.body;
    const map = {
      ProductName: body.productName, CategoryID: body.categoryId, BrandID: body.brandId,
      SupplierID: body.supplierId, Unit: body.unit, UnitPrice: body.unitPrice,
      CostPrice: body.costPrice, ReorderLevel: body.reorderLevel, ImageURL: body.imageUrl,
      ARModelURL: body.arModelUrl, Status: body.status,
    };
    const setClauses = [];
    const params = { id: req.params.id };
    fields.forEach((f) => {
      if (map[f] !== undefined) {
        setClauses.push(`${f} = :${f}`);
        params[f] = map[f];
      }
    });
    if (!setClauses.length) throw new ApiError(400, "No fields provided to update.");

    const [result] = await pool.query(
      `UPDATE Product SET ${setClauses.join(", ")} WHERE ProductID = :id`,
      params
    );
    if (!result.affectedRows) throw new ApiError(404, "Product not found.");

    await pool.query(
      `INSERT INTO UserActivity (UserID, ActivityType, Module, RecordID, Description)
       VALUES (:userId, 'Update', 'Products', :recordId, 'Updated a product')`,
      { userId: req.user.userId, recordId: req.params.id }
    );

    res.json({ message: "Product updated." });
  })
);

// DELETE /products/:id — soft delete: sets Status to 'Inactive' instead of removing the row.
// Products are referenced by OrderDetails, PurchaseOrderItem, Inventory, InventoryTransaction, etc.,
// so a hard DELETE would throw a foreign-key constraint error once any sales/stock history exists.
router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const [result] = await pool.query(
      `UPDATE Product SET Status = 'Inactive' WHERE ProductID = :id`,
      { id: req.params.id }
    );
    if (!result.affectedRows) throw new ApiError(404, "Product not found.");

    await pool.query(
      `INSERT INTO UserActivity (UserID, ActivityType, Module, RecordID, Description)
       VALUES (:userId, 'Delete', 'Products', :recordId, 'Deactivated a product')`,
      { userId: req.user.userId, recordId: req.params.id }
    );

    res.json({ message: "Product deactivated." });
  })
);

module.exports = router;