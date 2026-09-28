const router = require("express").Router();
const pool = require("../config/db");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/apiError");
const { authenticate } = require("../middleware/auth");
const { parseCsv } = require("../utils/csv");

router.use(authenticate);

function statusFor(stockOnHand, reorderLevel) {
  if (stockOnHand <= 0) return "Critical";
  if (stockOnHand <= reorderLevel) return "Low Stock";
  return "Normal";
}

// GET /inventory  -> powers Inventory.jsx "Inventory" tab
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { warehouseId, status, search } = req.query;
    let sql = `
      SELECT i.InventoryID AS inventoryId, i.ProductID AS productId, p.ProductName AS productName,
             i.WarehouseID AS warehouseId, w.WarehouseName AS warehouse,
             i.StockOnHand AS currentStock, p.ReorderLevel AS reorderLimit, i.LastUpdated AS lastUpdated
      FROM Inventory i
      JOIN Product p ON p.ProductID = i.ProductID
      JOIN Warehouse w ON w.WarehouseID = i.WarehouseID
      WHERE 1=1`;
    const params = {};
    if (warehouseId) {
      sql += ` AND i.WarehouseID = :warehouseId`;
      params.warehouseId = warehouseId;
    }
    if (search) {
      sql += ` AND (p.ProductName LIKE :search OR p.ProductID = :searchId)`;
      params.search = `%${search}%`;
      params.searchId = Number(search) || 0;
    }
    const [rows] = await pool.query(sql, params);
    let mapped = rows.map((r) => ({ ...r, status: statusFor(r.currentStock, r.reorderLimit) }));
    if (status) mapped = mapped.filter((r) => r.status === status);
    res.json(mapped);
  })
);

// GET /inventory/transactions -> powers Inventory.jsx "Inventory Transactions" tab
router.get(
  "/transactions",
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(`
      SELECT t.TransactionID AS transactionId, p.ProductID AS productId, p.ProductName AS productName,
             w.WarehouseName AS warehouse, t.TransactionType AS type, t.Quantity AS quantity,
             t.ReferenceNo AS reference, t.TransactionDate AS date,
             CONCAT(u.FirstName, ' ', u.LastName) AS user
      FROM InventoryTransaction t
      JOIN Inventory i ON i.InventoryID = t.InventoryID
      JOIN Product p ON p.ProductID = i.ProductID
      JOIN Warehouse w ON w.WarehouseID = i.WarehouseID
      JOIN User u ON u.UserID = t.UserID
      ORDER BY t.TransactionDate DESC
      LIMIT 200
    `);
    res.json(rows);
  })
);

async function getOrCreateInventory(conn, warehouseId, productId) {
  const [rows] = await conn.query(
    `SELECT InventoryID, StockOnHand FROM Inventory WHERE WarehouseID = :warehouseId AND ProductID = :productId FOR UPDATE`,
    { warehouseId, productId }
  );
  if (rows[0]) return rows[0];
  const [result] = await conn.query(
    `INSERT INTO Inventory (WarehouseID, ProductID, StockOnHand) VALUES (:warehouseId, :productId, 0)`,
    { warehouseId, productId }
  );
  return { InventoryID: result.insertId, StockOnHand: 0 };
}

// POST /inventory/stock-in  { warehouseId, referenceNo, items:[{productId, quantity}] }
router.post(
  "/stock-in",
  asyncHandler(async (req, res) => {
    const { warehouseId, referenceNo, remarks, items } = req.body;
    if (!warehouseId || !Array.isArray(items) || !items.length) {
      throw new ApiError(400, "warehouseId and at least one item are required.");
    }
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      for (const item of items) {
        const inv = await getOrCreateInventory(conn, warehouseId, item.productId);
        await conn.query(`UPDATE Inventory SET StockOnHand = StockOnHand + :qty WHERE InventoryID = :id`, {
          qty: item.quantity,
          id: inv.InventoryID,
        });
        await conn.query(
          `INSERT INTO InventoryTransaction (InventoryID, UserID, TransactionType, Quantity, Reason, ReferenceNo, Remarks)
           VALUES (:invId, :userId, 'Stock In', :qty, 'Purchase', :ref, :remarks)`,
          { invId: inv.InventoryID, userId: req.user.userId, qty: item.quantity, ref: referenceNo || null, remarks: remarks || null }
        );
      }
      await conn.commit();
      res.status(201).json({ message: "Stock in recorded." });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  })
);

// POST /inventory/stock-out { warehouseId, referenceNo, reason, items:[{productId, quantity}] }
router.post(
  "/stock-out",
  asyncHandler(async (req, res) => {
    const { warehouseId, referenceNo, reason, remarks, items } = req.body;
    if (!warehouseId || !Array.isArray(items) || !items.length) {
      throw new ApiError(400, "warehouseId and at least one item are required.");
    }
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      for (const item of items) {
        const inv = await getOrCreateInventory(conn, warehouseId, item.productId);
        if (inv.StockOnHand < item.quantity) {
          throw new ApiError(400, `Insufficient stock for product ${item.productId}.`);
        }
        await conn.query(`UPDATE Inventory SET StockOnHand = StockOnHand - :qty WHERE InventoryID = :id`, {
          qty: item.quantity,
          id: inv.InventoryID,
        });
        await conn.query(
          `INSERT INTO InventoryTransaction (InventoryID, UserID, TransactionType, Quantity, Reason, ReferenceNo, Remarks)
           VALUES (:invId, :userId, 'Stock Out', :qty, :reason, :ref, :remarks)`,
          {
            invId: inv.InventoryID,
            userId: req.user.userId,
            qty: item.quantity,
            reason: reason || "Damaged",
            ref: referenceNo || null,
            remarks: remarks || null,
          }
        );
      }
      await conn.commit();
      res.status(201).json({ message: "Stock out recorded." });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  })
);

// POST /inventory/adjust { warehouseId, items:[{productId, newQuantity}] }
router.post(
  "/adjust",
  asyncHandler(async (req, res) => {
    const { warehouseId, remarks, items } = req.body;
    if (!warehouseId || !Array.isArray(items) || !items.length) {
      throw new ApiError(400, "warehouseId and at least one item are required.");
    }
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      for (const item of items) {
        const inv = await getOrCreateInventory(conn, warehouseId, item.productId);
        const diff = item.newQuantity - inv.StockOnHand;
        if (diff === 0) continue;
        await conn.query(`UPDATE Inventory SET StockOnHand = :qty WHERE InventoryID = :id`, {
          qty: item.newQuantity,
          id: inv.InventoryID,
        });
        await conn.query(
          `INSERT INTO InventoryTransaction (InventoryID, UserID, TransactionType, Quantity, Reason, Remarks)
           VALUES (:invId, :userId, :type, :qty, 'Adjustment', :remarks)`,
          {
            invId: inv.InventoryID,
            userId: req.user.userId,
            type: diff > 0 ? "Stock In" : "Stock Out",
            qty: Math.abs(diff),
            remarks: remarks || null,
          }
        );
      }
      await conn.commit();
      res.json({ message: "Stock adjustment recorded." });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  })
);

// POST /inventory/import — bulk import inventory levels from a CSV.
// Expected columns: ProductID,WarehouseID,Quantity,Mode ("Set" or "Add")
router.post(
  "/import",
  asyncHandler(async (req, res) => {
    const { csvText, fileName } = req.body;
    if (!csvText || typeof csvText !== "string") {
      throw new ApiError(400, "csvText is required.");
    }

    const rows = parseCsv(csvText);
    if (!rows.length) throw new ApiError(400, "The CSV file has no data rows.");

    const required = ["ProductID", "WarehouseID", "Quantity"];
    const missingCols = required.filter((col) => !(col in rows[0]));
    if (missingCols.length) {
      throw new ApiError(400, `CSV is missing required column(s): ${missingCols.join(", ")}`);
    }

    const conn = await pool.getConnection();
    let importedCount = 0;
    const errors = [];

    try {
      await conn.beginTransaction();

      for (const [index, row] of rows.entries()) {
        const rowNum = index + 2;
        try {
          const productId = Number(row.ProductID);
          const warehouseId = Number(row.WarehouseID);
          const quantity = Number(row.Quantity);
          const mode = (row.Mode || "Set").trim().toLowerCase();

          if (!Number.isInteger(productId) || productId <= 0) {
            throw new Error(`Row ${rowNum}: invalid ProductID "${row.ProductID}"`);
          }
          if (!Number.isInteger(warehouseId) || warehouseId <= 0) {
            throw new Error(`Row ${rowNum}: invalid WarehouseID "${row.WarehouseID}"`);
          }
          if (isNaN(quantity) || quantity < 0) {
            throw new Error(`Row ${rowNum}: invalid Quantity "${row.Quantity}"`);
          }
          if (mode !== "set" && mode !== "add") {
            throw new Error(`Row ${rowNum}: Mode must be "Set" or "Add", got "${row.Mode}"`);
          }

          const [productRows] = await conn.query(`SELECT ProductID FROM Product WHERE ProductID = :pid`, {
            pid: productId,
          });
          if (!productRows[0]) throw new Error(`Row ${rowNum}: Product ID ${productId} does not exist`);

          const [warehouseRows] = await conn.query(`SELECT WarehouseID FROM Warehouse WHERE WarehouseID = :wid`, {
            wid: warehouseId,
          });
          if (!warehouseRows[0]) throw new Error(`Row ${rowNum}: Warehouse ID ${warehouseId} does not exist`);

          const inv = await getOrCreateInventory(conn, warehouseId, productId);
          const newQuantity = mode === "add" ? inv.StockOnHand + quantity : quantity;
          const diff = newQuantity - inv.StockOnHand;

          if (diff !== 0) {
            await conn.query(`UPDATE Inventory SET StockOnHand = :qty WHERE InventoryID = :id`, {
              qty: newQuantity,
              id: inv.InventoryID,
            });
            await conn.query(
              `INSERT INTO InventoryTransaction (InventoryID, UserID, TransactionType, Quantity, Reason, ReferenceNo, Remarks)
               VALUES (:invId, :userId, :type, :qty, 'Adjustment', :ref, 'Imported from CSV')`,
              {
                invId: inv.InventoryID,
                userId: req.user.userId,
                type: diff > 0 ? "Stock In" : "Stock Out",
                qty: Math.abs(diff),
                ref: fileName || "inventory_import.csv",
              }
            );
          }

          importedCount++;
        } catch (rowErr) {
          errors.push(rowErr.message);
        }
      }

      if (importedCount === 0) {
        throw new ApiError(400, `No rows could be imported. Errors: ${errors.join("; ")}`);
      }

      await conn.query(
        `INSERT INTO DataActivityLog (UserID, ActivityType, DataType, FileName, FileFormat, Status)
         VALUES (:userId, 'Import', 'Inventory Data', :fileName, 'CSV', 'Successful')`,
        { userId: req.user.userId, fileName: fileName || "inventory_import.csv" }
      );

      await conn.commit();
      res.status(201).json({
        message: `Imported ${importedCount} row(s).`,
        imported: importedCount,
        skipped: errors.length,
        errors,
      });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  })
);

// -------------------------------------------------------------------------
// Single-record endpoints — power the View / Edit / Delete row icons
// -------------------------------------------------------------------------

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT i.InventoryID AS inventoryId, i.ProductID AS productId, p.ProductName AS productName,
              i.WarehouseID AS warehouseId, w.WarehouseName AS warehouse,
              i.StockOnHand AS currentStock, p.ReorderLevel AS reorderLimit,
              p.UnitPrice AS unitPrice, p.CostPrice AS costPrice, i.LastUpdated AS lastUpdated
       FROM Inventory i
       JOIN Product p ON p.ProductID = i.ProductID
       JOIN Warehouse w ON w.WarehouseID = i.WarehouseID
       WHERE i.InventoryID = :id`,
      { id: req.params.id }
    );
    if (!rows[0]) throw new ApiError(404, "Inventory record not found.");
    res.json({ ...rows[0], status: statusFor(rows[0].currentStock, rows[0].reorderLimit) });
  })
);

router.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const { newQuantity, remarks } = req.body;
    if (newQuantity == null || newQuantity < 0) {
      throw new ApiError(400, "newQuantity must be a non-negative number.");
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [rows] = await conn.query(
        `SELECT StockOnHand FROM Inventory WHERE InventoryID = :id FOR UPDATE`,
        { id: req.params.id }
      );
      if (!rows[0]) throw new ApiError(404, "Inventory record not found.");

      const diff = Number(newQuantity) - rows[0].StockOnHand;
      if (diff !== 0) {
        await conn.query(`UPDATE Inventory SET StockOnHand = :qty WHERE InventoryID = :id`, {
          qty: newQuantity,
          id: req.params.id,
        });
        await conn.query(
          `INSERT INTO InventoryTransaction (InventoryID, UserID, TransactionType, Quantity, Reason, Remarks)
           VALUES (:invId, :userId, :type, :qty, 'Adjustment', :remarks)`,
          {
            invId: req.params.id,
            userId: req.user.userId,
            type: diff > 0 ? "Stock In" : "Stock Out",
            qty: Math.abs(diff),
            remarks: remarks || null,
          }
        );
      }
      await conn.commit();
      res.json({ message: "Inventory record updated." });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  })
);

// DELETE /inventory/:id?force=true
//
// By default, refuses to delete an Inventory row that has any
// InventoryTransaction history — that history is an audit trail (who moved
// how much stock, when, and why), and MySQL's own foreign key would reject
// the delete anyway once any transaction references this row. Rather than
// letting that raw FK error reach the user, we check for it first and
// explain clearly, offering an explicit "force" delete that also wipes the
// transaction history for this record (used only when the user has
// confirmed they understand that trade-off).
router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const force = req.query.force === "true";

    const [rows] = await pool.query(`SELECT StockOnHand FROM Inventory WHERE InventoryID = :id`, {
      id: req.params.id,
    });
    if (!rows[0]) throw new ApiError(404, "Inventory record not found.");
    if (rows[0].StockOnHand > 0) {
      throw new ApiError(
        400,
        "This product still has stock on hand. Adjust the quantity to 0 before deleting the record."
      );
    }

    const [[{ count }]] = await pool.query(
      `SELECT COUNT(*) AS count FROM InventoryTransaction WHERE InventoryID = :id`,
      { id: req.params.id }
    );

    if (count > 0 && !force) {
      throw new ApiError(
        409,
        `This inventory record has ${count} transaction(s) in its history (Stock In/Out/Adjustment). ` +
          `Deleting it also permanently deletes that history and cannot be undone. ` +
          `If you're sure, confirm again to force-delete it along with its history.`
      );
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      if (count > 0) {
        await conn.query(`DELETE FROM InventoryTransaction WHERE InventoryID = :id`, { id: req.params.id });
      }
      await conn.query(`DELETE FROM Inventory WHERE InventoryID = :id`, { id: req.params.id });

      if (force && count > 0) {
        await conn.query(
          `INSERT INTO UserActivity (UserID, ActivityType, Module, RecordID, Description)
           VALUES (:userId, 'Delete', 'Inventory', :recordId, :description)`,
          {
            userId: req.user.userId,
            recordId: req.params.id,
            description: `Force-deleted inventory record and its ${count} transaction record(s)`,
          }
        );
      }

      await conn.commit();
      res.json({ message: "Inventory record deleted." });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  })
);

module.exports = router;