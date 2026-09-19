const router = require("express").Router();
const pool = require("../config/db");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/apiError");
const { authenticate } = require("../middleware/auth");
const { nextSequence } = require("../utils/generateNumbers");

router.use(authenticate);

// GET /orders?status=&type=&search=
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { status, type, search } = req.query;
    let sql = `
      SELECT o.OrderID AS id, o.OrderNo AS orderNo, o.CustomerID AS customerId,
             o.OrderType AS type, o.OrderStatus AS status, o.TotalAmount AS totalAmount,
             o.OrderDate AS date
      FROM \`Order\` o WHERE 1=1`;
    const params = {};
    if (status) { sql += ` AND o.OrderStatus = :status`; params.status = status; }
    if (type) { sql += ` AND o.OrderType = :type`; params.type = type; }
    if (search) { sql += ` AND o.OrderNo LIKE :s`; params.s = `%${search}%`; }
    sql += ` ORDER BY o.OrderDate DESC`;
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  })
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const [orderRows] = await pool.query(`SELECT * FROM \`Order\` WHERE OrderID = :id`, { id: req.params.id });
    if (!orderRows[0]) throw new ApiError(404, "Order not found.");
    const [items] = await pool.query(
      `SELECT od.ProductID AS productId, p.ProductName AS name, od.Quantity AS qty,
              od.UnitPrice AS unitPrice, od.Subtotal AS subtotal
       FROM OrderDetails od JOIN Product p ON p.ProductID = od.ProductID
       WHERE od.OrderID = :id`,
      { id: req.params.id }
    );
    res.json({ ...orderRows[0], items });
  })
);

// POST /orders { customerId, orderType, items:[{productId, quantity, unitPrice}] }
router.post(
  "/",
  asyncHandler(async (req, res) => {
    const { customerId, orderType, remarks, items } = req.body;
    if (!customerId || !orderType || !Array.isArray(items) || !items.length) {
      throw new ApiError(400, "customerId, orderType and at least one item are required.");
    }
    const totalAmount = items.reduce((sum, it) => sum + it.quantity * it.unitPrice, 0);
    const orderNo = await nextSequence(pool, "`Order`", "OrderNo", "ORD");

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [result] = await conn.query(
        `INSERT INTO \`Order\` (CustomerID, OrderNo, OrderType, OrderStatus, TotalAmount, Remarks)
         VALUES (:customerId, :orderNo, :orderType, 'Preparing', :totalAmount, :remarks)`,
        { customerId, orderNo, orderType, totalAmount, remarks: remarks || null }
      );
      for (const item of items) {
        await conn.query(
          `INSERT INTO OrderDetails (OrderID, ProductID, Quantity, UnitPrice, Subtotal)
           VALUES (:orderId, :productId, :qty, :unitPrice, :subtotal)`,
          {
            orderId: result.insertId,
            productId: item.productId,
            qty: item.quantity,
            unitPrice: item.unitPrice,
            subtotal: item.quantity * item.unitPrice,
          }
        );
      }
      await conn.commit();
      res.status(201).json({ id: result.insertId, orderNo });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  })
);

router.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const { orderStatus, remarks } = req.body;
    const [result] = await pool.query(
      `UPDATE \`Order\` SET OrderStatus = COALESCE(:status, OrderStatus), Remarks = COALESCE(:remarks, Remarks)
       WHERE OrderID = :id`,
      { id: req.params.id, status: orderStatus || null, remarks: remarks || null }
    );
    if (!result.affectedRows) throw new ApiError(404, "Order not found.");
    res.json({ message: "Order updated." });
  })
);

router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const [result] = await pool.query(`DELETE FROM \`Order\` WHERE OrderID = :id`, { id: req.params.id });
    if (!result.affectedRows) throw new ApiError(404, "Order not found.");
    res.json({ message: "Order deleted." });
  })
);

module.exports = router;