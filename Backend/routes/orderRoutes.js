const router = require("express").Router();
const pool = require("../config/db");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/apiError");
const { issueRefund, settleCancellation } = require("../utils/financialRules");
const { authenticate, authorize } = require("../middleware/auth");
const { nextSequence } = require("../utils/generateNumbers");

async function nextId(conn, table, column, prefix, pad = 3) {
  if (table === 'Customer') {
    const [ids]=await conn.query('SELECT CustomerID AS id FROM Customer UNION SELECT historical_customer_id AS id FROM `Order` UNION SELECT historical_customer_id AS id FROM Sales');
    const max=ids.reduce((value,row)=>{const match=String(row.id || '').match(/^CUST-?(\d+)$/);return match ? Math.max(value,Number(match[1])) : value;},0);
    return `CUST-${String(max+1).padStart(3,'0')}`;
  }
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

const pickup = require("../utils/pickupLifecycle");

const DEFAULT_WAREHOUSE_ID = "WH-001";

router.use(authenticate);
// Drivers use only the authenticated delivery queue and its two lifecycle actions.
router.use((req,res,next)=> {
  if(require('../utils/deliveryLifecycle').driver(req.user)) return next(new ApiError(403,'Use your assigned delivery queue.'));
  next();
});

const LIST_SELECT = `
  SELECT o.OrderID AS orderId, o.OrderNo AS id, o.historical_customer_id AS customerId,
         o.customer_name AS customerName, o.contact_number AS customerPhone, o.address AS customerAddress, o.customer_type AS customerType,
         o.OrderType AS type, o.OrderStatus AS status, o.OrderDate AS date,
         o.PickupStatus AS pickupStatus, o.PickupScheduledAt AS pickupScheduledAt, o.PickupSettlementPending AS settlementPending,
         o.TotalAmount AS totalAmount, o.Remarks AS remarks,
         s.SaleID AS saleId, s.SaleNo AS saleNo,
         pay.PaymentID AS paymentId, pay.ReferenceNo AS referenceNo, COALESCE(d.PaymentMethod,pay.PaymentMethod) AS paymentMethod, pay.AmountPaid AS amountPaid,
         CASE WHEN pay.AmountPaid >= o.TotalAmount THEN 'Paid' ELSE 'Unpaid' END AS paymentStatus,
         d.DeliveryID AS deliveryId, d.DRNo AS drNo, d.DeliveryStatus AS deliveryStatus,
         d.Remarks AS deliveryNotes, d.DeliveryDate AS deliveredAt, d.DeliveryCharge AS deliveryFee, d.DeliveryAddress AS deliveryAddress,
         d.DeliveredByUserID AS deliveryRiderId,
         CASE WHEN rider.UserID IS NOT NULL THEN CONCAT(rider.FirstName,' ',rider.LastName) ELSE NULL END AS deliveryRiderName
  FROM \`Order\` o
  LEFT JOIN Customer c ON c.CustomerID = o.CustomerID
  LEFT JOIN Sales s ON s.OrderID = o.OrderID
  LEFT JOIN (SELECT SaleID,SUM(AmountPaid) AS AmountPaid,MAX(PaymentID) AS PaymentID,MAX(ReferenceNo) AS ReferenceNo,MAX(PaymentMethod) AS PaymentMethod FROM Payment WHERE PaymentType='Sale' GROUP BY SaleID) pay ON pay.SaleID = s.SaleID
  LEFT JOIN Delivery d ON d.SaleID = s.SaleID
  LEFT JOIN User rider ON rider.UserID = d.DeliveredByUserID
`;

// All pickup access is scoped through the sale creator's company.
router.get("/pickup", asyncHandler(async (req, res) => {
  await pickup.evaluate(pool, req.user.companyId);
  const pickupSelect = LIST_SELECT.replace("LEFT JOIN Payment pay ON pay.SaleID = s.SaleID", "LEFT JOIN (SELECT SaleID, SUM(AmountPaid) AS AmountPaid, MAX(PaymentID) AS PaymentID, MAX(ReferenceNo) AS ReferenceNo, MAX(PaymentMethod) AS PaymentMethod FROM Payment GROUP BY SaleID) pay ON pay.SaleID = s.SaleID");
  const [rows] = await pool.query(pickupSelect + ` WHERE o.OrderType='Pickup' AND o.PickupStatus IN ('Preparing','Ready for Pickup','Cancelled','Unclaimed') AND NOT EXISTS (SELECT 1 FROM PickupSettlement settled WHERE settled.OrderID=o.OrderID) AND pay.AmountPaid>=o.TotalAmount AND EXISTS (SELECT 1 FROM User owner WHERE owner.UserID=s.UserID AND owner.CompanyID=:companyId) ORDER BY o.PickupScheduledAt`, {companyId:req.user.companyId});
  const privileged = ["admin","administrator","manager","operations supervisor"].includes(String(req.user.roleName).toLowerCase());
  res.json(rows.map(row => ({...row, canSettle: privileged && !!row.settlementPending})));
}));
router.put("/:id/pickup-status", authorize("Admin", "Manager", "Assistant Operations Supervisor", "Store Supervisor", "Assistant Store Supervisor", "Cashier", "Staff"), asyncHandler(async (req,res) => {
  if (req.body.status === "Completed") throw new ApiError(400,"Use Complete Claim and answer Empty Cylinder Returned?.");
  await pickup.evaluate(pool, req.user.companyId);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query("SELECT o.* FROM `Order` o WHERE o.OrderID=:id AND o.OrderType='Pickup' AND EXISTS (SELECT 1 FROM Sales s JOIN User u ON u.UserID=s.UserID WHERE s.OrderID=o.OrderID AND u.CompanyID=:companyId) FOR UPDATE", {id:req.params.id, companyId:req.user.companyId});
    const order=rows[0];
    if (!order) throw new ApiError(404,"Pickup order not found.");
    if (!order.PickupScheduledAt) throw new ApiError(409,"Legacy pickup has no saved schedule; manual review required.");
    const [settings] = await conn.query("SELECT * FROM CompanySettings WHERE CompanyID=:companyId", {companyId:req.user.companyId});
    if (!settings[0]) throw new ApiError(409,"Configure pickup policies in Settings.");
    if (["Preparing","Ready for Pickup"].includes(order.PickupStatus) && new Date() >= pickup.expiration(order.PickupScheduledAt, settings[0])) {
      await conn.query("UPDATE `Order` SET PickupStatus='Unclaimed', OrderStatus='Unclaimed', PickupSettlementPending=1 WHERE OrderID=:id", {id:req.params.id});
      await conn.commit();
      throw new ApiError(409,"Pickup expired. Restock & Settle is required.");
    }
    const [paid] = await conn.query("SELECT COALESCE(SUM(p.AmountPaid),0) AS amount FROM Sales s JOIN Payment p ON p.SaleID=s.SaleID WHERE s.OrderID=:id", {id:req.params.id});
    const changed=pickup.transition(order.PickupStatus,req.body.status,Number(paid[0].amount)>=Number(order.TotalAmount));
    if (changed) await conn.query("UPDATE `Order` SET PickupStatus=:status, OrderStatus=:status, PickupSettlementPending=:pending WHERE OrderID=:id", {id:req.params.id,status:req.body.status,pending:req.body.status==="Cancelled"?1:0});
    await conn.commit();
    res.json({message:changed?"Pickup updated.":"Pickup action already applied.",status:req.body.status});
  } catch(err) {await conn.rollback();throw err;} finally {conn.release();}
}));

const claim = require("../utils/pickupClaim");
const pickupOperators = ["Admin","Manager","Assistant Operations Supervisor","Store Supervisor","Assistant Store Supervisor","Cashier","Staff"];
router.get("/:id/pickup-claim-options", authorize(...pickupOperators), asyncHandler(async(req,res)=>{
  const [orders]=await pool.query("SELECT o.OrderID FROM `Order` o WHERE o.OrderID=:id AND o.OrderType='Pickup' AND EXISTS (SELECT 1 FROM Sales s JOIN User u ON u.UserID=s.UserID WHERE s.OrderID=o.OrderID AND u.CompanyID=:companyId)",{id:req.params.id,companyId:req.user.companyId});
  if(!orders.length)throw new ApiError(404,"Pickup order not found.");
  const [warehouses]=await pool.query("SELECT WarehouseID AS id,WarehouseName AS name FROM Warehouse WHERE CompanyID=:companyId AND Status='Active' ORDER BY WarehouseName",{companyId:req.user.companyId});
  const [products]=await pool.query("SELECT p.ProductID AS id,p.ProductName AS name,b.Brand AS brand,p.UnitValue AS unitValue FROM Product p JOIN Category c ON c.CategoryID=p.CategoryID JOIN Brand b ON b.BrandID=p.BrandID WHERE c.Category='Cylinder' AND p.Status='Active' ORDER BY p.ProductName");
  const [inventoryStocks]=await pool.query("SELECT i.WarehouseID AS warehouseId,i.ProductID AS productId,SUM(i.StockOnHand) AS stock FROM Inventory i JOIN Warehouse w ON w.WarehouseID=i.WarehouseID JOIN Product p ON p.ProductID=i.ProductID JOIN Category c ON c.CategoryID=p.CategoryID WHERE w.CompanyID=:companyId AND w.Status='Active' AND c.Category='Cylinder' GROUP BY i.WarehouseID,i.ProductID",{companyId:req.user.companyId});
  res.json({warehouses,products,inventoryStocks});
}));
router.post("/:id/pickup-claim", authorize(...pickupOperators), asyncHandler(async(req,res)=>{
  res.json(await claim.complete(pool,req.user,req.params.id,req.body));
}));

const settlement = require("../utils/pickupSettlement");
router.get("/:id/pickup-settlement", authorize("Admin","Manager"), asyncHandler(async(req,res)=>{
  res.json(await settlement.quote(pool,req.user,req.params.id));
}));
router.post("/:id/pickup-settlement", authorize("Admin","Manager"), asyncHandler(async(req,res)=>{
  const result=await settlement.settle(pool,req.user,req.params.id,req.body);
  res.status(201).json({message:"Pickup settled and inventory restored.",...result});
}));

// Historical orders remain linked to their customer after claim or settlement.
router.get("/customer/:customerId/history", asyncHandler(async(req,res)=>{
  const [rows]=await pool.query(`SELECT o.OrderID AS orderId,o.OrderNo AS id,o.OrderType AS type,
    CASE WHEN o.OrderType='Delivery' THEN COALESCE(d.DeliveryStatus,o.OrderStatus) ELSE COALESCE(o.PickupStatus,o.OrderStatus) END AS status,o.OrderDate AS date,
    o.PickupScheduledAt AS pickupScheduledAt,o.TotalAmount AS totalAmount,
    CASE WHEN paid.amount>=o.TotalAmount THEN 'Paid' ELSE 'Unpaid' END AS paymentStatus,
    CASE WHEN o.OrderType='Delivery' THEN d.SettledAt ELSE ps.CreatedAt END AS settledAt,
    CASE WHEN o.OrderType='Delivery' THEN COALESCE(deliveryRefund.settlementFee,0) ELSE ps.CancellationFee END AS settlementFee,
    CASE WHEN o.OrderType='Delivery' THEN COALESCE(deliveryRefund.netRefundAmount,0) ELSE ps.NetRefundAmount END AS netRefundAmount
    FROM \`Order\` o JOIN Sales s ON s.OrderID=o.OrderID JOIN User owner ON owner.UserID=s.UserID
    LEFT JOIN Delivery d ON d.SaleID=s.SaleID
    LEFT JOIN (SELECT SaleID,SUM(AmountPaid) AS amount FROM Payment WHERE PaymentType='Sale' GROUP BY SaleID) paid ON paid.SaleID=s.SaleID
    LEFT JOIN PickupSettlement ps ON ps.OrderID=o.OrderID AND ps.CompanyID=:companyId
    LEFT JOIN (SELECT OrderID,SUM(CancellationFee) AS settlementFee,SUM(RefundAmount) AS netRefundAmount
      FROM RefundLedger WHERE CompanyID=:companyId AND Reason='Delivery Failed' GROUP BY OrderID) deliveryRefund ON deliveryRefund.OrderID=o.OrderID
    WHERE o.historical_customer_id=:customerId AND owner.CompanyID=:companyId ORDER BY o.OrderDate DESC,o.OrderID DESC`,
    {customerId:req.params.customerId,companyId:req.user.companyId});
  res.json(rows);
}));

// GET /orders?search=&status=&type=
router.get(
  "/",
  asyncHandler(async (req, res) => {
    await pickup.evaluate(pool, req.user.companyId);
    const { search, status, type } = req.query;
    let sql = LIST_SELECT + ` WHERE o.OrderType IN ('Pickup', 'Delivery')`;
    const params = {companyId:req.user.companyId};
    sql += ` AND EXISTS (SELECT 1 FROM User owner WHERE owner.UserID=s.UserID AND owner.CompanyID=:companyId)`;
    if (search) {
      sql += ` AND (o.OrderNo LIKE :s OR o.customer_name LIKE :s)`;
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
    await pickup.evaluate(pool, req.user.companyId);
    const [rows] = await pool.query(LIST_SELECT + ` WHERE o.OrderID = :id AND EXISTS (SELECT 1 FROM User owner WHERE owner.UserID=s.UserID AND owner.CompanyID=:companyId)`, { id: req.params.id, companyId:req.user.companyId });
    if (!rows[0]) throw new ApiError(404, "Order not found.");
    if (rows[0].type === "Pickup") {
      const [owner] = await pool.query("SELECT s.SaleID FROM Sales s JOIN User u ON u.UserID=s.UserID WHERE s.OrderID=:id AND u.CompanyID=:companyId", {id:req.params.id,companyId:req.user.companyId});
      if (!owner[0]) throw new ApiError(404,"Order not found.");
    }
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
const { resolveWalkInCustomer } = require("../utils/walkInCustomer");

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

    if (orderType === "Walk-in") throw new ApiError(400, "Walk-in orders must be completed through POS checkout (/sales).");
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

      if (orderType === "Walk-in") customerId = await resolveWalkInCustomer(conn);
      if (customerId) {
        const [customerRows] = await conn.query(`SELECT CustomerID FROM Customer WHERE CustomerID = :id`, {
          id: customerId,
        });
        if (!customerRows[0]) throw new ApiError(400, "Customer not found.");
      } else {
        // orderType is guaranteed to be "Walk-in" here per the check above
        customerId = await resolveWalkInCustomer(conn);
      }

      let pickupScheduledAt = null;
      if (orderType === "Pickup") {
        const [settings] = await conn.query("SELECT * FROM CompanySettings WHERE CompanyID=:companyId", {companyId:req.user.companyId});
        if (!settings[0]) throw new ApiError(409,"Configure pickup policies in Settings.");
        pickupScheduledAt = pickup.validateSchedule(req.body.pickupDetails, settings[0]);
      }
      const orderNo = await nextSequence(pool, "`Order`", "OrderNo", "ORD");
      const orderId = await nextId(conn, "`Order`", "OrderID", "ORD");
      await conn.query(
        `INSERT INTO \`Order\` (OrderID, CustomerID, OrderNo, OrderType, OrderStatus, TotalAmount, Remarks)
         VALUES (:orderId, :customerId, :orderNo, :orderType, 'Preparing', :totalAmount, :remarks)`,
        { orderId, customerId, orderNo, orderType, totalAmount, remarks: remarks || null }
      );

      if (orderType === "Pickup") await conn.query("UPDATE `Order` SET PickupStatus='Preparing', PickupScheduledAt=:schedule WHERE OrderID=:id", {id:orderId,schedule:pickupScheduledAt});

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
        const drNo = await nextSequence(pool, "Delivery", "DRNo", "DEL");
        await conn.query(
          `INSERT INTO Delivery (DeliveryID, SaleID, DRNo, DeliveryCharge, DeliveryAddress, DeliveryStatus, PaymentMethod)
           VALUES (:deliveryId, :saleId, :drNo, :fee, :address, 'Preparing', :paymentMethod)`,
          { deliveryId, saleId, drNo, fee, address: deliveryAddress, paymentMethod:paymentMethod || (markPaid ? "Cash" : "Cash on Delivery") }
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

      const [existingRows] = await conn.query(`SELECT OrderID, OrderType FROM \`Order\` WHERE OrderID = :id FOR UPDATE`, {
        id: req.params.id,
      });
      if (!existingRows[0]) throw new ApiError(404, "Order not found.");
      if (existingRows[0].OrderType === "Delivery") throw new ApiError(409,"Use delivery assignment and lifecycle actions.");
      if (existingRows[0].OrderType === "Walk-in" || orderType === "Walk-in") throw new ApiError(409, "Walk-in orders belong to completed Sales, not fulfillment queues.");
      if (existingRows[0].OrderType === "Pickup" || orderType === "Pickup") throw new ApiError(409, "Use pickup status actions; pickup type and schedule are locked after creation.");

      if (orderStatus === "Cancelled") await settleCancellation(conn, req.user, req.params.id);

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
                `SELECT o.address AS Address FROM \`Order\` o LEFT JOIN Customer c ON c.CustomerID = o.CustomerID WHERE o.OrderID = :id`,
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
            const drNo = await nextSequence(pool, "Delivery", "DRNo", "DEL");
            await conn.query(
              `INSERT INTO Delivery (DeliveryID, SaleID, DRNo, DeliveryCharge, DeliveryAddress, DeliveryStatus, PaymentMethod)
               VALUES (:deliveryId, :saleId, :drNo, :fee, :address, 'Preparing', :paymentMethod)`,
              { deliveryId, saleId: saleRows[0].SaleID, drNo, fee: Number(deliveryFee) || 0, address, paymentMethod:req.body.paymentMethod || null }
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

// Records an authorized refund; no external payment provider is configured.
router.post("/:id/refund", authorize("Admin", "Manager"), asyncHandler(async (req, res) => {
 const conn = await pool.getConnection();
 try {
  await conn.beginTransaction();
  const [orders] = await conn.query("SELECT OrderStatus FROM `Order` WHERE OrderID = :id FOR UPDATE", {id: req.params.id});
  const [pickupRows] = await conn.query("SELECT OrderType FROM `Order` WHERE OrderID=:id", {id:req.params.id});
  if (pickupRows[0]?.OrderType === "Delivery") throw new ApiError(409,"Delivery refunds require final-failure settlement.");
  if (pickupRows[0]?.OrderType === "Pickup") throw new ApiError(409,"Pickup refunds require Restock & Settle (Stage 2).");
  const result = await issueRefund(conn, req.user, req.params.id, orders[0]?.OrderStatus === "Cancelled" ? "Cancellation" : "Refund");
  await conn.commit();
  res.json({message: "Refund recorded.", refund: result});
 } catch (err) { await conn.rollback(); throw err; }
 finally { conn.release(); }
}));

router.get("/:id/refund", authorize("Admin", "Manager"), asyncHandler(async (req, res) => {
 const [rows] = await pool.query("SELECT * FROM RefundLedger WHERE OrderID = :id AND CompanyID = :companyId", {id: req.params.id, companyId: req.user.companyId});
 if (!rows[0]) throw new ApiError(404, "Refund not found.");
 res.json(rows[0]);
}));

// PUT /orders/:id/payment
router.put(
  "/:id/payment",
  authorize("Admin","Manager","Store Supervisor","Assistant Store Supervisor","Cashier"),
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

// Legacy status edits bypassed lifecycle guards; callers must use /deliveries actions.
router.put('/:id/delivery', (req,res,next)=>next(new ApiError(409,'Use delivery assignment and lifecycle actions.')));

// DELETE /orders/:id — cancels the order: restores stock, removes Payment/Delivery/Sales/OrderDetails
router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [orderRows] = await conn.query(`SELECT OrderID, OrderType FROM \`Order\` WHERE OrderID = :id FOR UPDATE`, {
        id: req.params.id,
      });
      if (!orderRows[0]) throw new ApiError(404, "Order not found.");

      if (orderRows[0].OrderType === "Delivery") throw new ApiError(409,"Delivery history cannot be deleted; use lifecycle resolution.");
      if (orderRows[0].OrderType === "Pickup") throw new ApiError(409, "Use the pickup cancellation action; settlement is deferred.");
      await settleCancellation(conn, req.user, req.params.id);

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

