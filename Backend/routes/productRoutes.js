const router = require("express").Router();
const pool = require("../config/db");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/apiError");
const { authenticate } = require("../middleware/auth");

async function nextId(conn, table, column, prefix, pad = 3) {
  const [rows] = await conn.query(
    `SELECT ${column} AS id FROM ${table} WHERE ${column} LIKE :pattern ORDER BY ${column} DESC LIMIT 500`,
    { pattern: `${prefix}-%` }
  );
  let max = 0;
  for (const row of rows) {
    const match = String(row.id || "").match(new RegExp(`^${prefix}-(\\d+)$`));
    if (!match) continue;
    const n = Number(match[1]);
    if (Number.isInteger(n) && n > max) max = n;
  }
  return `${prefix}-${String(max + 1).padStart(pad, "0")}`;
}

function randomProductCode(length = 8) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < length; i++) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

async function nextProductId(conn, maxAttempts = 20) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const candidate = `P-${randomProductCode(8)}`;
    const [rows] = await conn.query(
      `SELECT ProductID FROM ProductHistory WHERE ProductID = :id LIMIT 1`,
      { id: candidate }
    );
    if (!rows[0]) return candidate;
  }
  throw new ApiError(500, "Could not generate a unique Product ID. Please try again.");
}

const CORE_WAREHOUSE_NAMES = ["Pasig Warehouse", "San Juan Warehouse"];

async function seedCoreWarehouseInventoryForProduct(conn, productId, companyId) {
  if (!companyId) return;

  const [warehouses] = await conn.query(
    `SELECT WarehouseID AS warehouseId
     FROM Warehouse
     WHERE CompanyID = :companyId AND WarehouseName IN (:nameA, :nameB)`,
    { companyId, nameA: CORE_WAREHOUSE_NAMES[0], nameB: CORE_WAREHOUSE_NAMES[1] }
  );

  for (const warehouse of warehouses) {
    const [existingRows] = await conn.query(
      `SELECT InventoryID FROM Inventory WHERE WarehouseID = :warehouseId AND ProductID = :productId LIMIT 1`,
      { warehouseId: warehouse.warehouseId, productId }
    );
    if (existingRows[0]) continue;

    const inventoryId = await nextId(conn, "Inventory", "InventoryID", "INT");
    try {
      await conn.query(
        `INSERT INTO Inventory (InventoryID, WarehouseID, ProductID, StockOnHand)
         VALUES (:inventoryId, :warehouseId, :productId, 0)`,
        { inventoryId, warehouseId: warehouse.warehouseId, productId }
      );
    } catch (err) {
      if (!err || err.code !== "ER_DUP_ENTRY") throw err;
    }
  }
}

async function productIdentity(body) {
  const value = String(body.unitValue ?? '').trim();
  if (!body.brandId || !body.categoryId || !body.supplierId || !['kg', 'm', 'pc'].includes(body.unit) || !/^\d+(\.\d+)?$/.test(value) || !Number.isFinite(Number(value)) || value.length > 50) {
    throw new ApiError(400, 'Brand, category, supplier, a valid unit (kg, m, pc) and a non-negative numeric unit value are required.');
  }
  const [rows] = await pool.query('SELECT b.Brand, c.Category FROM Brand b CROSS JOIN Category c WHERE b.BrandID = :brandId AND c.CategoryID = :categoryId', body);
  if (!rows[0]) throw new ApiError(400, 'Select an existing brand and category.');
  const canDeriveName = ['cylinder', 'gasul lpg'].includes(rows[0].Category.trim().toLowerCase());
  const suppliedName = typeof body.productName === 'string' ? body.productName.trim() : '';
  const name = suppliedName || (body.productName === undefined && canDeriveName ? `${rows[0].Brand} ${rows[0].Category} ${Number(value)} ${body.unit}` : '');
  if (!name) throw new ApiError(400, 'Product name is required.');
  if (name.length > 150) throw new ApiError(400, 'Product name exceeds 150 characters.');
  return {name, value: String(Number(value))};
}

router.use(authenticate);

// GET /products?search=&category=&status=
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { search, category, status, warehouseId } = req.query;
    const params = {};

    let inventoryJoin = `LEFT JOIN Inventory i ON i.ProductID = p.ProductID`;
    if (warehouseId) {
      inventoryJoin += ` AND i.WarehouseID = :warehouseId`;
      params.warehouseId = warehouseId;
    }

    let sql = `
      SELECT p.ProductID AS productId, p.ProductName AS name, c.Category AS category,
             s.SupplierName AS supplier, (SELECT b.Brand FROM Brand b WHERE b.BrandID = p.BrandID) AS brand, p.Unit AS unit, p.UnitValue AS unitValue, p.UnitPrice AS unitPrice,
             p.CostPrice AS costPrice, p.ReorderLevel AS reorderLevel,
             p.ImageURL AS imageUrl, p.ARModelURL AS arModelUrl, p.Status AS status,
             COALESCE(SUM(i.StockOnHand), 0) AS stock
      FROM Product p
      JOIN Category c ON c.CategoryID = p.CategoryID
      JOIN Supplier s ON s.SupplierID = p.SupplierID
      ${inventoryJoin}
      WHERE 1=1`;

    if (search) {
      sql += ` AND (p.ProductName LIKE :search OR p.ProductID = :searchId)`;
      params.search = `%${search}%`;
      params.searchId = String(search);
    }
    if (category) {
      sql += ` AND c.Category = :category`;
      params.category = category;
    }
    if (status) {
      sql += ` AND p.Status = :status`;
      params.status = status;
    }
    sql += ` GROUP BY p.ProductID ORDER BY p.CreatedAt DESC, p.ProductID DESC`;
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
    const {name: productName, value: normalizedValue} = await productIdentity(req.body);
    const {
      categoryId, brandId, supplierId, unit, unitValue,
      unitPrice, costPrice, reorderLevel, imageUrl, arModelUrl, status,
    } = req.body;

    if (!productName || !categoryId || !brandId || !supplierId || !unit) {
      throw new ApiError(400, "productName, categoryId, brandId, supplierId and unit are required.");
    }

    if (unitValue != null && String(unitValue).trim().length > 50) throw new ApiError(400, "Unit Value must be at most 50 characters.");
    const productId = await nextProductId(pool);

    await pool.query(
      `INSERT INTO Product
        (ProductID, ProductName, CategoryID, BrandID, SupplierID, Unit, UnitValue, UnitPrice, CostPrice, ReorderLevel, ImageURL, ARModelURL, Status)
       VALUES
        (:productId, :productName, :categoryId, :brandId, :supplierId, :unit, :unitValue, :unitPrice, :costPrice, :reorderLevel, :imageUrl, :arModelUrl, :status)`,
      {
        productId,
        productName, categoryId, brandId, supplierId, unit,
        unitValue: normalizedValue,
        unitPrice: unitPrice || 0,
        costPrice: costPrice || 0,
        reorderLevel: reorderLevel || 0,
        imageUrl: imageUrl || null,
        arModelUrl: arModelUrl || null,
        status: status || "Active",
      }
    );

    await seedCoreWarehouseInventoryForProduct(pool, productId, req.user.companyId);

    const userActivityId = await nextId(pool, "UserActivity", "UserActivityID", "UA");
    await pool.query(
      `INSERT INTO UserActivity (UserActivityID, UserID, ActivityType, Module, RecordID, Description)
       VALUES (:userActivityId, :userId, 'Create', 'Products — Product Management', :recordId, 'Created a new product')`,
      { userActivityId, userId: req.user.userId, recordId: productId }
    );

    res.status(201).json({ productId });
  })
);

router.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const fields = [
      "ProductName", "CategoryID", "BrandID", "SupplierID", "Unit", "UnitValue",
      "UnitPrice", "CostPrice", "ReorderLevel", "ImageURL", "ARModelURL", "Status",
    ];
    const [existing] = await pool.query('SELECT * FROM Product WHERE ProductID = :id', {id: req.params.id});
    if (!existing[0]) throw new ApiError(404, 'Product not found.');
    const row = existing[0];
    const body = {...{brandId: row.BrandID, categoryId: row.CategoryID, supplierId: row.SupplierID, productName: row.ProductName, unit: row.Unit, unitValue: row.UnitValue}, ...req.body};
    const identity = await productIdentity(body);
    body.productName = identity.name;
    body.unitValue = identity.value;
    if (body.unitValue != null && String(body.unitValue).trim().length > 50) throw new ApiError(400, "Unit Value must be at most 50 characters.");
    const map = {
      ProductName: body.productName, CategoryID: body.categoryId, BrandID: body.brandId,
      SupplierID: body.supplierId, Unit: body.unit, UnitValue: body.unitValue === undefined ? undefined : body.unitValue == null ? null : String(body.unitValue).trim(), UnitPrice: body.unitPrice,
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

    const userActivityId = await nextId(pool, "UserActivity", "UserActivityID", "UA");
    await pool.query(
      `INSERT INTO UserActivity (UserActivityID, UserID, ActivityType, Module, RecordID, Description)
       VALUES (:userActivityId, :userId, 'Update', 'Products — Product Management', :recordId, 'Updated a product')`,
      { userActivityId, userId: req.user.userId, recordId: req.params.id }
    );

    res.json({ message: "Product updated." });
  })
);

// Delete from the catalog; ProductHistory retains foreign-key targets and details.
router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const [result] = await pool.query(
      `DELETE FROM Product WHERE ProductID = :id`,
      { id: req.params.id }
    );
    if (!result.affectedRows) throw new ApiError(404, "Product not found.");

    const userActivityId = await nextId(pool, "UserActivity", "UserActivityID", "UA");
    await pool.query(
      `INSERT INTO UserActivity (UserActivityID, UserID, ActivityType, Module, RecordID, Description)
       VALUES (:userActivityId, :userId, 'Delete', 'Products — Product Management', :recordId, 'Deleted a product; transaction details retained in ProductHistory')`,
      { userActivityId, userId: req.user.userId, recordId: req.params.id }
    );

    res.json({ message: "Product deleted." });
  })
);

module.exports = router;


