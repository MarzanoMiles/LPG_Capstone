const router = require("express").Router();
const pool = require("../config/db");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/apiError");
const { authenticate } = require("../middleware/auth");
const { nextSequence } = require("../utils/generateNumbers");

router.use(authenticate);

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { status } = req.query;
    let sql = `
      SELECT po.PurchaseOrderID AS id, po.PONo AS poNo, s.SupplierName AS supplier,
             po.OrderDate AS orderDate, po.ExpectedDeliveryDate AS expectedDeliveryDate,
             po.Status AS status, po.TotalAmount AS totalAmount
      FROM PurchaseOrder po JOIN Supplier s ON s.SupplierID = po.SupplierID
      WHERE 1=1`;
    const params = {};
    if (status) {
      sql += ` AND po.Status = :status`;
      params.status = status;
    }
    sql += ` ORDER BY po.OrderDate DESC`;
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  })
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const [poRows] = await pool.query(
      `SELECT po.*, s.SupplierName FROM PurchaseOrder po JOIN Supplier s ON s.SupplierID = po.SupplierID
       WHERE po.PurchaseOrderID = :id`,
      { id: req.params.id }
    );
    if (!poRows[0]) throw new ApiError(404, "Purchase order not found.");
    const [items] = await pool.query(
      `SELECT poi.ProductID AS productId, p.ProductName AS productName, poi.Quantity AS qty,
              poi.UnitCost AS costPrice, poi.Subtotal AS subtotal
       FROM PurchaseOrderItem poi JOIN Product p ON p.ProductID = poi.ProductID
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

      const [result] = await conn.query(
        `INSERT INTO PurchaseOrder
          (SupplierID, RestockID, CreatedByUserID, PONo, OrderDate, ExpectedDeliveryDate, Status, TotalAmount, Remarks)
         VALUES (:supplierId, :restockId, :userId, :poNo, NOW(), :expected, 'Pending', :totalAmount, :remarks)`,
        {
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
        await conn.query(
          `INSERT INTO PurchaseOrderItem (PurchaseOrderID, ProductID, Quantity, UnitCost, Subtotal)
           VALUES (:poId, :productId, :qty, :unitCost, :subtotal)`,
          {
            poId: result.insertId,
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
      res.status(201).json({ id: result.insertId, poNo, totalAmount });
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
          const [ins] = await conn.query(
            `INSERT INTO Inventory (WarehouseID, ProductID, StockOnHand) VALUES (:wid, :pid, 0)`,
            { wid: warehouseId, pid: item.ProductID }
          );
          inventoryId = ins.insertId;
        }
        await conn.query(`UPDATE Inventory SET StockOnHand = StockOnHand + :qty WHERE InventoryID = :id`, {
          qty: item.Quantity,
          id: inventoryId,
        });
        await conn.query(
          `INSERT INTO InventoryTransaction (InventoryID, UserID, TransactionType, Quantity, Reason, ReferenceNo)
           VALUES (:invId, :userId, 'Stock In', :qty, 'Purchase', :ref)`,
          { invId: inventoryId, userId: req.user.userId, qty: item.Quantity, ref: `PO-${req.params.id}` }
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