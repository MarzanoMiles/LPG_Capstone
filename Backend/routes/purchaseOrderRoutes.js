const router = require("express").Router();
const pool = require("../config/db");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/apiError");
const { authenticate } = require("../middleware/auth");
const { nextSequence } = require("../utils/generateNumbers");

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

router.use(authenticate);

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { status } = req.query;
    let sql = `
      SELECT po.PurchaseOrderID AS id, po.PONo AS poNo, s.SupplierName AS supplier,
             po.OrderDate AS orderDate, po.ExpectedDeliveryDate AS expectedDeliveryDate,
             po.Status AS status, po.TotalAmount AS totalAmount,
             COALESCE(SUM(poi.Quantity), 0) AS totalQty,
             COUNT(poi.PurchaseOrderItemID) AS itemCount,
             GROUP_CONCAT(p.ProductName ORDER BY p.ProductName SEPARATOR ', ') AS productNames
      FROM PurchaseOrder po
      JOIN SupplierHistory s ON s.SupplierID = po.SupplierID
      LEFT JOIN PurchaseOrderItem poi ON poi.PurchaseOrderID = po.PurchaseOrderID
      LEFT JOIN ProductHistory p ON p.ProductID = poi.ProductID
      WHERE 1=1`;
    const params = {};
    if (status) {
      sql += ` AND po.Status = :status`;
      params.status = status;
    }
    sql += `
      GROUP BY po.PurchaseOrderID, po.PONo, s.SupplierName, po.OrderDate, po.ExpectedDeliveryDate, po.Status, po.TotalAmount
      ORDER BY po.OrderDate DESC`;
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  })
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const [poRows] = await pool.query(
      `SELECT po.*, s.SupplierName FROM PurchaseOrder po JOIN SupplierHistory s ON s.SupplierID = po.SupplierID
       WHERE po.PurchaseOrderID = :id`,
      { id: req.params.id }
    );
    if (!poRows[0]) throw new ApiError(404, "Purchase order not found.");
    const [items] = await pool.query(
      `SELECT poi.ProductID AS productId, p.ProductName AS productName, poi.Quantity AS qty,
              poi.UnitCost AS costPrice, poi.Subtotal AS subtotal
       FROM PurchaseOrderItem poi JOIN ProductHistory p ON p.ProductID = poi.ProductID
       WHERE poi.PurchaseOrderID = :id`,
      { id: req.params.id }
    );
    res.json({ ...poRows[0], items });
  })
);

// POST /purchase-orders
// body: { supplierId, restockIds?: number[], expectedDeliveryDate, items:[{productId, qty, unitCost}] }
router.post(
  "/",
  asyncHandler(async (req, res) => {
    const { supplierId, restockIds, expectedDeliveryDate, remarks, items } = req.body;
    if (!supplierId || !Array.isArray(items) || !items.length) {
      throw new ApiError(400, "supplierId and at least one item are required.");
    }
    const totalAmount = items.reduce((sum, it) => sum + it.qty * it.unitCost, 0);
    const poNo = await nextSequence(pool, "PurchaseOrder", "PONo", "PO");

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const firstRestockId = Array.isArray(restockIds) && restockIds.length ? restockIds[0] : null;

      const purchaseOrderId = await nextId(conn, "PurchaseOrder", "PurchaseOrderID", "PO");
      await conn.query(
        `INSERT INTO PurchaseOrder
          (PurchaseOrderID, SupplierID, RestockID, CreatedByUserID, PONo, OrderDate, ExpectedDeliveryDate, Status, TotalAmount, Remarks)
         VALUES (:purchaseOrderId, :supplierId, :restockId, :userId, :poNo, NOW(), :expected, 'Pending', :totalAmount, :remarks)`,
        {
          purchaseOrderId,
          supplierId,
          restockId: firstRestockId,
          userId: req.user.userId,
          poNo,
          expected: expectedDeliveryDate || null,
          totalAmount,
          remarks: remarks || null,
        }
      );

      for (const item of items) {
        const purchaseOrderItemId = await nextId(conn, "PurchaseOrderItem", "PurchaseOrderItemID", "POI");
        await conn.query(
          `INSERT INTO PurchaseOrderItem (PurchaseOrderItemID, PurchaseOrderID, ProductID, Quantity, UnitCost, Subtotal)
           VALUES (:purchaseOrderItemId, :poId, :productId, :qty, :unitCost, :subtotal)`,
          {
            purchaseOrderItemId,
            poId: purchaseOrderId,
            productId: item.productId,
            qty: item.qty,
            unitCost: item.unitCost,
            subtotal: item.qty * item.unitCost,
          }
        );
      }

      if (Array.isArray(restockIds) && restockIds.length) {
        await conn.query(
          `UPDATE RestockRecommendation SET Status = 'Converted' WHERE RestockID IN (${restockIds
            .map(() => "?")
            .join(",")})`,
          restockIds
        );
      }

      await conn.commit();
      res.status(201).json({ id: purchaseOrderId, poNo, totalAmount });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  })
);

// PUT /purchase-orders/:id/confirm — status -> Approved (sent to supplier)
router.put(
  "/:id/confirm",
  asyncHandler(async (req, res) => {
    const [result] = await pool.query(`UPDATE PurchaseOrder SET Status = 'Approved' WHERE PurchaseOrderID = :id`, {
      id: req.params.id,
    });
    if (!result.affectedRows) throw new ApiError(404, "Purchase order not found.");
    res.json({ message: "Purchase order confirmed and sent to supplier." });
  })
);

// PUT /purchase-orders/:id/receive — marks Received and stocks the items into a warehouse
router.put(
  "/:id/receive",
  asyncHandler(async (req, res) => {
    const { warehouseId } = req.body;
    if (!warehouseId) throw new ApiError(400, "warehouseId is required.");

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [poRows] = await conn.query(
        `SELECT PurchaseOrderID, PONo, Status FROM PurchaseOrder WHERE PurchaseOrderID = :id FOR UPDATE`,
        { id: req.params.id }
      );
      const po = poRows[0];
      if (!po) throw new ApiError(404, "Purchase order not found.");
      if (po.Status === "Received") {
        throw new ApiError(409, "Purchase order has already been received.");
      }
      if (po.Status === "Cancelled") {
        throw new ApiError(409, "Cancelled purchase orders cannot be received.");
      }
      if (po.Status !== "Approved" && po.Status !== "Sent") {
        throw new ApiError(409, "Only sent purchase orders can be received.");
      }

      const [warehouseRows] = await conn.query(
        `SELECT WarehouseID FROM Warehouse WHERE WarehouseID = :warehouseId AND CompanyID = :companyId LIMIT 1`,
        { warehouseId, companyId: req.user.companyId }
      );
      if (!warehouseRows[0]) {
        throw new ApiError(400, "Invalid warehouse selection.");
      }

      const [items] = await conn.query(
        `SELECT ProductID, Quantity FROM PurchaseOrderItem WHERE PurchaseOrderID = :id`,
        { id: req.params.id }
      );
      if (!items.length) throw new ApiError(404, "Purchase order not found or has no items.");

      for (const item of items) {
        const [invRows] = await conn.query(
          `SELECT InventoryID FROM Inventory WHERE WarehouseID = :wid AND ProductID = :pid FOR UPDATE`,
          { wid: warehouseId, pid: item.ProductID }
        );
        let inventoryId = invRows[0]?.InventoryID;
        if (!inventoryId) {
          inventoryId = await nextId(conn, "Inventory", "InventoryID", "INT");
          await conn.query(
            `INSERT INTO Inventory (InventoryID, WarehouseID, ProductID, StockOnHand) VALUES (:inventoryId, :wid, :pid, 0)`,
            { inventoryId, wid: warehouseId, pid: item.ProductID }
          );
        }
        await conn.query(`UPDATE Inventory SET StockOnHand = StockOnHand + :qty WHERE InventoryID = :id`, {
          qty: item.Quantity,
          id: inventoryId,
        });
        const transactionId = await nextId(conn, "InventoryTransaction", "TransactionID", "T");
        await conn.query(
          `INSERT INTO InventoryTransaction (TransactionID, InventoryID, UserID, TransactionType, Quantity, Reason, ReferenceNo)
           VALUES (:transactionId, :invId, :userId, 'Stock In', :qty, 'Purchase', :ref)`,
          { transactionId, invId: inventoryId, userId: req.user.userId, qty: item.Quantity, ref: po.PONo }
        );
      }
      await conn.query(`UPDATE PurchaseOrder SET Status = 'Received' WHERE PurchaseOrderID = :id`, { id: req.params.id });
      await conn.commit();
      res.json({ message: "Purchase order received and stock updated." });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  })
);

router.put(
  "/:id/cancel",
  asyncHandler(async (req, res) => {
    const [result] = await pool.query(`UPDATE PurchaseOrder SET Status = 'Cancelled' WHERE PurchaseOrderID = :id`, {
      id: req.params.id,
    });
    if (!result.affectedRows) throw new ApiError(404, "Purchase order not found.");
    res.json({ message: "Purchase order cancelled." });
  })
);

module.exports = router;
