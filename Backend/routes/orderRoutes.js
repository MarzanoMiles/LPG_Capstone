const router = require("express").Router();
const pool = require("../config/db");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/apiError");
const { authenticate } = require("../middleware/auth");
const { nextSequence } = require("../utils/generateNumbers");

const DEFAULT_WAREHOUSE_ID = 1;

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
       FROM OrderDetails od JOIN Product p ON p.ProductID = od.ProductID
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
  const [created] = await conn.query(
    `INSERT INTO Customer (CustomerType, ContactNo, Address, Status)
     VALUES ('Residential', 'WALKIN', 'Walk-in', 'Active')`
  );
  return created.insertId;
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
      const pid = Number(item.productId);
      if (!Number.isInteger(pid) || pid <= 0 || !item.qty || item.qty <= 0) {
        throw new ApiError(400, "Each item needs a valid productId and a positive qty.");
      }
      item.productId = pid;
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
      const [orderResult] = await conn.query(
        `INSERT INTO \`Order\` (CustomerID, OrderNo, OrderType, OrderStatus, TotalAmount, Remarks)
         VALUES (:customerId, :orderNo, :orderType, 'Preparing', :totalAmount, :remarks)`,
        { customerId, orderNo, orderType, totalAmount, remarks: remarks || null }
      );
      const orderId = orderResult.insertId;

      for (const item of items) {
        const [productRows] = await conn.query(`SELECT ProductID FROM Product WHERE ProductID = :pid`, {
          pid: item.productId,
        });
        if (!productRows[0]) throw new ApiError(400, `Product ID ${item.productId} does not exist.`);

        await conn.query(
          `INSERT INTO OrderDetails (OrderID, ProductID, Quantity, UnitPrice, Subtotal)
           VALUES (:orderId, :productId, :qty, :unitPrice, :subtotal)`,
          {
            orderId, productId: item.productId, qty: item.qty,
            unitPrice: item.unitPrice, subtotal: item.qty * item.unitPrice,
          }
        );

        const [invRows] = await conn.query(
          `SELECT InventoryID, StockOnHand FROM Inventory WHERE WarehouseID = :wid AND ProductID = :pid FOR UPDATE`,
          { wid, pid: item.productId }
        );
        let inv = invRows[0];
        if (!inv) {
          const [ins] = await conn.query(
            `INSERT INTO Inventory (WarehouseID, ProductID, StockOnHand) VALUES (:wid, :pid, 0)`,
            { wid, pid: item.productId }
          );
          inv = { InventoryID: ins.insertId, StockOnHand: 0 };
        }
        if (inv.StockOnHand < item.qty) {
          throw new ApiError(400, `Insufficient stock for product ${item.productId}.`);
        }
        await conn.query(`UPDATE Inventory SET StockOnHand = StockOnHand - :qty WHERE InventoryID = :id`, {
          qty: item.qty, id: inv.InventoryID,
        });
        await conn.query(
          `INSERT INTO InventoryTransaction (InventoryID, UserID, TransactionType, Quantity, Reason, ReferenceNo)
           VALUES (:invId, :userId, 'Stock Out', :qty, 'Sale', :ref)`,
          { invId: inv.InventoryID, userId: req.user.userId, qty: item.qty, ref: orderNo }
        );
      }

      // Every order gets a matching Sales row, since Payment and Delivery attach via SaleID
      const saleNo = await nextSequence(pool, "Sales", "SaleNo", "SALE");
      const [saleResult] = await conn.query(
        `INSERT INTO Sales (OrderID, CustomerID, UserID, SaleNo, SalesDiscount, TotalAmount, Remarks)
         VALUES (:orderId, :customerId, :userId, :saleNo, 0, :totalAmount, :remarks)`,
        { orderId, customerId, userId: req.user.userId, saleNo, totalAmount, remarks: remarks || null }
      );
      const saleId = saleResult.insertId;

      if (markPaid) {
        await conn.query(
          `INSERT INTO Payment (PaymentType, SaleID, PaymentMethod, AmountPaid)
           VALUES ('Sale', :saleId, :method, :amount)`,
          { saleId, method: paymentMethod || "Cash", amount: totalAmount }
        );
      }

      // Delivery-type orders always get a Delivery record created up front, since the
      // address is known at creation time.
      if (orderType === "Delivery") {
        const drNo = await nextSequence(pool, "Delivery", "DRNo", "DR");
        await conn.query(
          `INSERT INTO Delivery (SaleID, DRNo, DeliveryCharge, DeliveryAddress, DeliveryStatus)
           VALUES (:saleId, :drNo, :fee, :address, 'Pending')`,
          { saleId, drNo, fee, address: deliveryAddress }
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
            const drNo = await nextSequence(pool, "Delivery", "DRNo", "DR");
            await conn.query(
              `INSERT INTO Delivery (SaleID, DRNo, DeliveryCharge, DeliveryAddress, DeliveryStatus)
               VALUES (:saleId, :drNo, :fee, :address, 'Pending')`,
              { saleId: saleRows[0].SaleID, drNo, fee: Number(deliveryFee) || 0, address }
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
      await pool.query(
        `INSERT INTO Payment (PaymentType, SaleID, PaymentMethod, AmountPaid)
         VALUES ('Sale', :saleId, :method, :amount)`,
        { saleId: orderRows[0].SaleID, method: paymentMethod || "Cash", amount }
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
          await conn.query(
            `INSERT INTO InventoryTransaction (InventoryID, UserID, TransactionType, Quantity, Reason, ReferenceNo, Remarks)
             VALUES (:invId, :userId, 'Stock In', :qty, 'Adjustment', :ref, 'Order cancelled — stock restored')`,
            { invId: invRows[0].InventoryID, userId: req.user.userId, qty: item.Quantity, ref: `CANCEL-ORDER-${req.params.id}` }
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