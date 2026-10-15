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

const DEFAULT_WAREHOUSE_ID = "WH-001";

router.use(authenticate);

const LIST_SELECT = `
  SELECT o.OrderID AS orderId, o.OrderNo AS id, o.CustomerID AS customerId,
         c.CustomerName AS customerName, c.ContactNo AS customerPhone, c.Address AS customerAddress,
         o.OrderType AS type, o.OrderStatus AS status, o.OrderDate AS date,
         o.TotalAmount AS totalAmount, o.Remarks AS remarks,
         s.SaleID AS saleId, s.SaleNo AS saleNo,
         pay.PaymentID AS paymentId, pay.PaymentMethod AS paymentMethod, pay.AmountPaid AS amountPaid,
         CASE WHEN pay.AmountPaid >= o.TotalAmount THEN 'Paid' ELSE 'Unpaid' END AS paymentStatus,
         d.DeliveryID AS deliveryId, d.DRNo AS drNo, d.DeliveryStatus AS deliveryStatus,
         d.DeliveryDate AS deliveredAt, d.DeliveryCharge AS deliveryFee, d.DeliveryAddress AS deliveryAddress,
         d.DeliveredByUserID AS deliveryRiderId,
         CASE WHEN rider.UserID IS NOT NULL THEN CONCAT(rider.FirstName,' ',rider.LastName) ELSE NULL END AS deliveryRiderName
  FROM \`Order\` o
  JOIN Customer c ON c.CustomerID = o.CustomerID
  LEFT JOIN Sales s ON s.OrderID = o.OrderID
  LEFT JOIN Payment pay ON pay.SaleID = s.SaleID
  LEFT JOIN Delivery d ON d.SaleID = s.SaleID
  LEFT JOIN User rider ON rider.UserID = d.DeliveredByUserID
`;

// GET /orders?search=&status=&type=
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { search, status, type } = req.query;
    let sql = LIST_SELECT + ` WHERE 1=1`;
    const params = {};
    if (search) {
      sql += ` AND (o.OrderNo LIKE :s OR c.CustomerName LIKE :s)`;
      params.s = `%${search}%`;
    }
    if (status) {
      sql += ` AND o.OrderStatus = :status`;
      params.status = status;
    }
    if (type) {
      sql += ` AND o.OrderType = :type`;
      params.type = type;
    }

    // Hide requested historical records from Order & Delivery module list.
    sql += ` AND DATE(o.OrderDate) <> '2026-10-07'`;

    sql += ` ORDER BY o.OrderDate DESC`;
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  })
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(LIST_SELECT + ` WHERE o.OrderID = :id`, { id: req.params.id });
    if (!rows[0]) throw new ApiError(404, "Order not found.");
    const [items] = await pool.query(
      `SELECT od.ProductID AS productId, p.ProductName AS name, od.Quantity AS qty,
              od.UnitPrice AS unitPrice, od.Subtotal AS subtotal
       FROM OrderDetails od JOIN ProductHistory p ON p.ProductID = od.ProductID
       WHERE od.OrderID = :id`,
      { id: req.params.id }
    );
    res.json({ ...rows[0], items });
  })
);

// Finds or creates the shared walk-in customer record, same convention as POST /sales.
async function resolveWalkInCustomer(conn) {
  const [existing] = await conn.query(`SELECT CustomerID FROM Customer WHERE ContactNo = 'WALKIN' LIMIT 1`);
  if (existing[0]) return existing[0].CustomerID;

  const customerId = await nextId(conn, "Customer", "CustomerID", "CUST");
  await conn.query(
    `INSERT INTO Customer (CustomerID, CustomerType, ContactNo, Address, Status)
     VALUES (:customerId, 'Residential', 'WALKIN', 'Walk-in', 'Active')`,
    { customerId }
  );
  return customerId;
}

// POST /orders
// body: { customerId?, orderType, items:[{productId, qty, unitPrice}], deliveryAddress?, deliveryFee?,
//         paymentMethod?, markPaid?, warehouseId?, remarks? }
// customerId is only required for Pickup and Delivery orders — Walk-in orders may omit it,
// in which case a shared walk-in customer record is used automatically.
router.post(
  "/",
  asyncHandler(async (req, res) => {
    const {
      orderType, items, deliveryAddress, deliveryFee,
      paymentMethod, markPaid, warehouseId, remarks,
    } = req.body;
    let { customerId } = req.body;

    if (!orderType || !Array.isArray(items) || !items.length) {
      throw new ApiError(400, "orderType and at least one item are required.");
    }
    if (orderType === "Delivery" && !deliveryAddress) {
      throw new ApiError(400, "deliveryAddress is required for Delivery orders.");
    }
    if (orderType !== "Walk-in" && !customerId) {
      throw new ApiError(400, "Please select a customer for Pickup and Delivery orders.");
    }

    for (const item of items) {
      if (!item.productId || !item.qty || Number(item.qty) <= 0) {
        throw new ApiError(400, "Each item needs a valid productId and a positive qty.");
      }
      item.productId = String(item.productId);
      item.qty = Number(item.qty);
      item.unitPrice = Number(item.unitPrice);
    }

    const wid = warehouseId || DEFAULT_WAREHOUSE_ID;
    const subtotal = items.reduce((sum, it) => sum + it.qty * it.unitPrice, 0);
    const fee = Number(deliveryFee) || 0;
    const totalAmount = subtotal + fee;

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      if (customerId) {
        const [customerRows] = await conn.query(`SELECT CustomerID FROM Customer WHERE CustomerID = :id`, {
          id: customerId,
        });
        if (!customerRows[0]) throw new ApiError(400, "Customer not found.");
      } else {
        // orderType is guaranteed to be "Walk-in" here per the check above
        customerId = await resolveWalkInCustomer(conn);
      }

      const orderNo = await nextSequence(pool, "`Order`", "OrderNo", "ORD");
      const orderId = await nextId(conn, "`Order`", "OrderID", "ORD");
      await conn.query(
        `INSERT INTO \`Order\` (OrderID, CustomerID, OrderNo, OrderType, OrderStatus, TotalAmount, Remarks)
         VALUES (:orderId, :customerId, :orderNo, :orderType, 'Preparing', :totalAmount, :remarks)`,
        { orderId, customerId, orderNo, orderType, totalAmount, remarks: remarks || null }
      );

      for (const item of items) {
        const [productRows] = await conn.query(`SELECT ProductID FROM Product WHERE ProductID = :pid`, {
          pid: item.productId,
        });
        if (!productRows[0]) throw new ApiError(400, `Product ID ${item.productId} does not exist.`);

        const orderDetailId = await nextId(conn, "OrderDetails", "OrderDetailID", "OD");
        await conn.query(
          `INSERT INTO OrderDetails (OrderDetailID, OrderID, ProductID, Quantity, UnitPrice, Subtotal)
           VALUES (:orderDetailId, :orderId, :productId, :qty, :unitPrice, :subtotal)`,
          {
            orderDetailId,
            orderId,
            productId: item.productId,
            qty: item.qty,
            unitPrice: item.unitPrice,
            subtotal: item.qty * item.unitPrice,
          }
        );

        const [invRows] = await conn.query(
          `SELECT InventoryID, StockOnHand FROM Inventory WHERE WarehouseID = :wid AND ProductID = :pid FOR UPDATE`,
          { wid, pid: item.productId }
        );
        let inv = invRows[0];
        if (!inv) {
          const inventoryId = await nextId(conn, "Inventory", "InventoryID", "INT");
          await conn.query(
            `INSERT INTO Inventory (InventoryID, WarehouseID, ProductID, StockOnHand) VALUES (:inventoryId, :wid, :pid, 0)`,
            { inventoryId, wid, pid: item.productId }
          );
          inv = { InventoryID: inventoryId, StockOnHand: 0 };
        }
        if (inv.StockOnHand < item.qty) {
          throw new ApiError(400, `Insufficient stock for product ${item.productId}.`);
        }
        await conn.query(`UPDATE Inventory SET StockOnHand = StockOnHand - :qty WHERE InventoryID = :id`, {
          qty: item.qty, id: inv.InventoryID,
        });
        const transactionId = await nextId(conn, "InventoryTransaction", "TransactionID", "T");
        await conn.query(
          `INSERT INTO InventoryTransaction (TransactionID, InventoryID, UserID, TransactionType, Quantity, Reason, ReferenceNo)
           VALUES (:transactionId, :invId, :userId, 'Stock Out', :qty, 'Sale', :ref)`,
          { transactionId, invId: inv.InventoryID, userId: req.user.userId, qty: item.qty, ref: orderNo }
        );
      }

      // Every order gets a matching Sales row, since Payment and Delivery attach via SaleID
      const saleNo = await nextSequence(pool, "Sales", "SaleNo", "SALE");
      const saleId = await nextId(conn, "Sales", "SaleID", "S");
      await conn.query(
        `INSERT INTO Sales (SaleID, OrderID, CustomerID, UserID, SaleNo, SalesDiscount, TotalAmount, Remarks)
         VALUES (:saleId, :orderId, :customerId, :userId, :saleNo, 0, :totalAmount, :remarks)`,
        { saleId, orderId, customerId, userId: req.user.userId, saleNo, totalAmount, remarks: remarks || null }
      );

      if (markPaid) {
        const paymentId = await nextId(conn, "Payment", "PaymentID", "PAY");
        await conn.query(
          `INSERT INTO Payment (PaymentID, PaymentType, SaleID, PaymentMethod, AmountPaid)
           VALUES (:paymentId, 'Sale', :saleId, :method, :amount)`,
          { paymentId, saleId, method: paymentMethod || "Cash", amount: totalAmount }
        );
      }

      // Delivery-type orders always get a Delivery record created up front, since the
      // address is known at creation time.
      if (orderType === "Delivery") {
        const deliveryId = await nextId(conn, "Delivery", "DeliveryID", "D");
        const drNo = await nextSequence(pool, "Delivery", "DRNo", "DR");
        await conn.query(
          `INSERT INTO Delivery (DeliveryID, SaleID, DRNo, DeliveryCharge, DeliveryAddress, DeliveryStatus)
           VALUES (:deliveryId, :saleId, :drNo, :fee, :address, 'Pending')`,
          { deliveryId, saleId, drNo, fee, address: deliveryAddress }
        );
      }

      await conn.commit();
      res.status(201).json({ orderId, orderNo, saleId, saleNo, totalAmount });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  })
);

// PUT /orders/:id — updates order-level fields, and auto-creates the Delivery record
// (so the order starts showing up in the Delivery tab) if the order is switched to
// type "Delivery" after creation and doesn't have one yet.
router.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const { orderType, orderStatus, remarks, deliveryAddress, deliveryFee } = req.body;

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [existingRows] = await conn.query(`SELECT OrderID FROM \`Order\` WHERE OrderID = :id FOR UPDATE`, {
        id: req.params.id,
      });
      if (!existingRows[0]) throw new ApiError(404, "Order not found.");

      await conn.query(
        `UPDATE \`Order\` SET
           OrderType = COALESCE(:type, OrderType),
           OrderStatus = COALESCE(:status, OrderStatus),
           Remarks = COALESCE(:remarks, Remarks)
         WHERE OrderID = :id`,
        { id: req.params.id, type: orderType || null, status: orderStatus || null, remarks: remarks ?? null }
      );

      if (orderType === "Delivery") {
        const [saleRows] = await conn.query(`SELECT SaleID FROM Sales WHERE OrderID = :id`, {
          id: req.params.id,
        });
        if (saleRows[0]) {
          const [deliveryRows] = await conn.query(`SELECT DeliveryID FROM Delivery WHERE SaleID = :saleId`, {
            saleId: saleRows[0].SaleID,
          });
          if (!deliveryRows[0]) {
            let address = deliveryAddress;
            if (!address) {
              const [customerRows] = await conn.query(
                `SELECT c.Address FROM \`Order\` o JOIN Customer c ON c.CustomerID = o.CustomerID WHERE o.OrderID = :id`,
                { id: req.params.id }
              );
              address = customerRows[0]?.Address;
            }
            if (!address || address === "N/A" || address === "Walk-in") {
              throw new ApiError(
                400,
                "A delivery address is required to mark this order as Delivery. Please provide one."
              );
            }
            const deliveryId = await nextId(conn, "Delivery", "DeliveryID", "D");
            const drNo = await nextSequence(pool, "Delivery", "DRNo", "DR");
            await conn.query(
              `INSERT INTO Delivery (DeliveryID, SaleID, DRNo, DeliveryCharge, DeliveryAddress, DeliveryStatus)
               VALUES (:deliveryId, :saleId, :drNo, :fee, :address, 'Pending')`,
              { deliveryId, saleId: saleRows[0].SaleID, drNo, fee: Number(deliveryFee) || 0, address }
            );
          }
        }
      }

      await conn.commit();
      res.json({ message: "Order updated." });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  })
);

// PUT /orders/:id/payment
router.put(
  "/:id/payment",
  asyncHandler(async (req, res) => {
    const { paymentMethod, amountPaid } = req.body;

    const [orderRows] = await pool.query(
      `SELECT o.TotalAmount, s.SaleID FROM \`Order\` o LEFT JOIN Sales s ON s.OrderID = o.OrderID WHERE o.OrderID = :id`,
      { id: req.params.id }
    );
    if (!orderRows[0]) throw new ApiError(404, "Order not found.");
    if (!orderRows[0].SaleID) throw new ApiError(400, "This order has no linked sale record.");

    const amount = amountPaid != null ? Number(amountPaid) : Number(orderRows[0].TotalAmount);

    const [existing] = await pool.query(`SELECT PaymentID FROM Payment WHERE SaleID = :saleId`, {
      saleId: orderRows[0].SaleID,
    });

    if (existing[0]) {
      await pool.query(
        `UPDATE Payment SET PaymentMethod = COALESCE(:method, PaymentMethod), AmountPaid = :amount WHERE PaymentID = :id`,
        { id: existing[0].PaymentID, method: paymentMethod || null, amount }
      );
    } else {
      const paymentId = await nextId(pool, "Payment", "PaymentID", "PAY");
      await pool.query(
        `INSERT INTO Payment (PaymentID, PaymentType, SaleID, PaymentMethod, AmountPaid)
         VALUES (:paymentId, 'Sale', :saleId, :method, :amount)`,
        { paymentId, saleId: orderRows[0].SaleID, method: paymentMethod || "Cash", amount }
      );
    }

    res.json({ message: "Payment updated." });
  })
);

// PUT /orders/:id/delivery — update delivery status / assign a rider
router.put(
  "/:id/delivery",
  asyncHandler(async (req, res) => {
    const { deliveryStatus, deliveryRiderId, deliveryDate } = req.body;

    const [orderRows] = await pool.query(
      `SELECT d.DeliveryID FROM \`Order\` o
       JOIN Sales s ON s.OrderID = o.OrderID
       JOIN Delivery d ON d.SaleID = s.SaleID
       WHERE o.OrderID = :id`,
      { id: req.params.id }
    );
    if (!orderRows[0]) throw new ApiError(404, "This order has no delivery record (is it a Delivery-type order?).");

    await pool.query(
      `UPDATE Delivery SET
         DeliveryStatus = COALESCE(:status, DeliveryStatus),
         DeliveredByUserID = COALESCE(:riderId, DeliveredByUserID),
         DeliveryDate = COALESCE(:deliveryDate, DeliveryDate)
       WHERE DeliveryID = :id`,
      {
        id: orderRows[0].DeliveryID,
        status: deliveryStatus || null,
        riderId: deliveryRiderId || null,
        deliveryDate: deliveryDate || (deliveryStatus === "Delivered" ? new Date() : null),
      }
    );

    res.json({ message: "Delivery updated." });
  })
);

// DELETE /orders/:id — cancels the order: restores stock, removes Payment/Delivery/Sales/OrderDetails
router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [orderRows] = await conn.query(`SELECT OrderID FROM \`Order\` WHERE OrderID = :id FOR UPDATE`, {
        id: req.params.id,
      });
      if (!orderRows[0]) throw new ApiError(404, "Order not found.");

      const [items] = await conn.query(`SELECT ProductID, Quantity FROM OrderDetails WHERE OrderID = :id`, {
        id: req.params.id,
      });
      for (const item of items) {
        const [invRows] = await conn.query(
          `SELECT InventoryID FROM Inventory WHERE ProductID = :pid ORDER BY InventoryID LIMIT 1 FOR UPDATE`,
          { pid: item.ProductID }
        );
        if (invRows[0]) {
          await conn.query(`UPDATE Inventory SET StockOnHand = StockOnHand + :qty WHERE InventoryID = :id`, {
            qty: item.Quantity, id: invRows[0].InventoryID,
          });
          const transactionId = await nextId(conn, "InventoryTransaction", "TransactionID", "T");
          await conn.query(
            `INSERT INTO InventoryTransaction (TransactionID, InventoryID, UserID, TransactionType, Quantity, Reason, ReferenceNo, Remarks)
             VALUES (:transactionId, :invId, :userId, 'Stock In', :qty, 'Adjustment', :ref, 'Order cancelled — stock restored')`,
            { transactionId, invId: invRows[0].InventoryID, userId: req.user.userId, qty: item.Quantity, ref: `CANCEL-ORDER-${req.params.id}` }
          );
        }
      }

      const [saleRows] = await conn.query(`SELECT SaleID FROM Sales WHERE OrderID = :id`, { id: req.params.id });
      if (saleRows[0]) {
        await conn.query(`DELETE FROM Delivery WHERE SaleID = :saleId`, { saleId: saleRows[0].SaleID });
        await conn.query(`DELETE FROM Payment WHERE SaleID = :saleId`, { saleId: saleRows[0].SaleID });
        await conn.query(`DELETE FROM Sales WHERE SaleID = :saleId`, { saleId: saleRows[0].SaleID });
      }
      await conn.query(`DELETE FROM OrderDetails WHERE OrderID = :id`, { id: req.params.id });
      await conn.query(`DELETE FROM \`Order\` WHERE OrderID = :id`, { id: req.params.id });

      await conn.commit();
      res.json({ message: "Order cancelled and stock restored." });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  })
);

module.exports = router;

