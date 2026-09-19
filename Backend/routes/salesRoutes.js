const router = require("express").Router();
const pool = require("../config/db");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/apiError");
const { authenticate } = require("../middleware/auth");
const { nextSequence } = require("../utils/generateNumbers");
const { parseCsv } = require("../utils/csv");

const VAT_RATE = 0.12;
const DEFAULT_WAREHOUSE_ID = 1; // POS terminal deducts from the main warehouse by default

router.use(authenticate);

// GET /sales?search=&cashier=&status=
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { search, cashier, status } = req.query;
    let sql = `
      SELECT s.SaleID AS id, s.SaleNo AS saleNo, s.SaleDate AS datetime, s.UserID AS cashier,
             CONCAT(u.FirstName,' ',u.LastName) AS cashierName, s.OrderID AS orderId,
             o.OrderType AS type, o.OrderStatus AS status,
             s.TotalAmount AS amount, s.SalesDiscount AS discount
      FROM Sales s
      JOIN User u ON u.UserID = s.UserID
      LEFT JOIN \`Order\` o ON o.OrderID = s.OrderID
      WHERE 1=1`;
    const params = {};
    if (search) {
      sql += ` AND s.SaleNo LIKE :s`;
      params.s = `%${search}%`;
    }
    if (cashier) {
      sql += ` AND s.UserID = :cashier`;
      params.cashier = cashier;
    }
    if (status) {
      sql += ` AND o.OrderStatus = :status`;
      params.status = status;
    }
    sql += ` ORDER BY s.SaleDate DESC`;
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  })
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const [saleRows] = await pool.query(
      `SELECT s.SaleID AS id, s.SaleNo AS saleNo, s.SaleDate AS datetime, s.UserID AS cashier,
              CONCAT(u.FirstName,' ',u.LastName) AS cashierName, s.OrderID AS orderId,
              o.OrderType AS type, o.OrderStatus AS status,
              s.TotalAmount AS amount, s.SalesDiscount AS discount, s.Remarks AS remarks
       FROM Sales s
       JOIN User u ON u.UserID = s.UserID
       LEFT JOIN \`Order\` o ON o.OrderID = s.OrderID
       WHERE s.SaleID = :id`,
      { id: req.params.id }
    );
    if (!saleRows[0]) throw new ApiError(404, "Sale not found.");
    const [items] = await pool.query(
      `SELECT od.ProductID AS productId, p.ProductName AS name, od.Quantity AS qty,
              od.UnitPrice AS costPrice, od.Subtotal AS subtotal
       FROM Sales s
       JOIN OrderDetails od ON od.OrderID = s.OrderID
       JOIN Product p ON p.ProductID = od.ProductID
       WHERE s.SaleID = :id`,
      { id: req.params.id }
    );
    res.json({ ...saleRows[0], items });
  })
);

// POST /sales — creates a walk-in/POS sale, deducts inventory, records payment
// body: { customerId?, customerType?, items:[{productId, qty, unitPrice}], discount, paymentMethod, amountCollected, warehouseId }
router.post(
  "/",
  asyncHandler(async (req, res) => {
    const { customerType, items, discount, paymentMethod, amountCollected, warehouseId, remarks } = req.body;
    let { customerId } = req.body;

    if (!Array.isArray(items) || !items.length) {
      throw new ApiError(400, "At least one item is required.");
    }

    for (const item of items) {
      const pid = Number(item.productId);
      if (!Number.isInteger(pid) || pid <= 0) {
        throw new ApiError(
          400,
          `Invalid productId "${item.productId}" — expected a numeric Product ID from the database.`
        );
      }
      item.productId = pid;
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      if (!customerId) {
        const [existing] = await conn.query(
          `SELECT CustomerID FROM Customer WHERE ContactNo = 'WALKIN' LIMIT 1`
        );
        if (existing[0]) {
          customerId = existing[0].CustomerID;
        } else {
          const [created] = await conn.query(
            `INSERT INTO Customer (CustomerType, ContactNo, Address, Status)
             VALUES (:type, 'WALKIN', 'Walk-in', 'Active')`,
            { type: customerType === "Business Account" ? "Commercial" : "Residential" }
          );
          customerId = created.insertId;
        }
      }

      const subtotal = items.reduce((sum, it) => sum + it.qty * it.unitPrice, 0);
      const discountAmount = discount || 0;
      const vat = (subtotal - discountAmount) * VAT_RATE;
      const totalAmount = subtotal - discountAmount + vat;
      const wid = warehouseId || DEFAULT_WAREHOUSE_ID;

      const orderNo = await nextSequence(pool, "`Order`", "OrderNo", "ORD");
      const [orderResult] = await conn.query(
        `INSERT INTO \`Order\` (CustomerID, OrderNo, OrderType, OrderStatus, TotalAmount, Remarks)
         VALUES (:customerId, :orderNo, 'Walk-in', 'Completed', :totalAmount, :remarks)`,
        { customerId, orderNo, totalAmount, remarks: remarks || null }
      );
      const orderId = orderResult.insertId;

      for (const item of items) {
        const [productRows] = await conn.query(
          `SELECT ProductID FROM Product WHERE ProductID = :pid`,
          { pid: item.productId }
        );
        if (!productRows[0]) {
          throw new ApiError(400, `Product ID ${item.productId} does not exist.`);
        }

        await conn.query(
          `INSERT INTO OrderDetails (OrderID, ProductID, Quantity, UnitPrice, Subtotal)
           VALUES (:orderId, :productId, :qty, :unitPrice, :subtotal)`,
          {
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
          qty: item.qty,
          id: inv.InventoryID,
        });
        await conn.query(
          `INSERT INTO InventoryTransaction (InventoryID, UserID, TransactionType, Quantity, Reason, ReferenceNo)
           VALUES (:invId, :userId, 'Stock Out', :qty, 'Sale', :ref)`,
          { invId: inv.InventoryID, userId: req.user.userId, qty: item.qty, ref: orderNo }
        );
      }

      const saleNo = await nextSequence(pool, "Sales", "SaleNo", "SALE");
      const [saleResult] = await conn.query(
        `INSERT INTO Sales (OrderID, CustomerID, UserID, SaleNo, SalesDiscount, TotalAmount, Remarks)
         VALUES (:orderId, :customerId, :userId, :saleNo, :discount, :totalAmount, :remarks)`,
        {
          orderId,
          customerId,
          userId: req.user.userId,
          saleNo,
          discount: discountAmount,
          totalAmount,
          remarks: remarks || null,
        }
      );

      if (paymentMethod && amountCollected) {
        await conn.query(
          `INSERT INTO Payment (PaymentType, SaleID, PaymentMethod, AmountPaid)
           VALUES ('Sale', :saleId, :method, :amount)`,
          { saleId: saleResult.insertId, method: paymentMethod, amount: amountCollected }
        );
      }

      await conn.commit();
      res.status(201).json({
        saleId: saleResult.insertId,
        saleNo,
        subtotal,
        vat,
        discount: discountAmount,
        totalAmount,
        changeDue: amountCollected ? amountCollected - totalAmount : null,
      });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  })
);

// POST /sales/import — bulk-import historical sales from a CSV.
//
// Expected CSV columns (header row required), one row per LINE ITEM, grouped by SaleRef
// so a multi-item sale can span several rows:
//   SaleRef,ProductID,Quantity,UnitPrice,Discount,PaymentMethod,SaleDate
//
// - SaleRef: any string that's the same across rows belonging to the same sale (e.g. "IMP-1")
// - ProductID: must match an existing Product ID
// - Discount/PaymentMethod/SaleDate: read from the FIRST row seen for each SaleRef
// - adjustInventory (body flag): if true, deducts current stock for each imported line item
//   (use this for "this actually happened and hasn't been deducted yet" data; leave it off
//   for backfilling historical records that shouldn't touch today's stock levels)
router.post(
  "/import",
  asyncHandler(async (req, res) => {
    const { csvText, adjustInventory, fileName } = req.body;
    if (!csvText || typeof csvText !== "string") {
      throw new ApiError(400, "csvText is required.");
    }

    const rows = parseCsv(csvText);
    if (!rows.length) throw new ApiError(400, "The CSV file has no data rows.");

    const required = ["SaleRef", "ProductID", "Quantity", "UnitPrice"];
    const missingCols = required.filter((col) => !(col in rows[0]));
    if (missingCols.length) {
      throw new ApiError(400, `CSV is missing required column(s): ${missingCols.join(", ")}`);
    }

    // Group rows by SaleRef
    const groups = new Map();
    for (const row of rows) {
      const ref = row.SaleRef || "IMPORTED";
      if (!groups.has(ref)) groups.set(ref, []);
      groups.get(ref).push(row);
    }

    const conn = await pool.getConnection();
    let importedCount = 0;
    const errors = [];

    try {
      await conn.beginTransaction();

      const [existingCustomer] = await conn.query(
        `SELECT CustomerID FROM Customer WHERE ContactNo = 'IMPORTED' LIMIT 1`
      );
      let importCustomerId = existingCustomer[0]?.CustomerID;
      if (!importCustomerId) {
        const [created] = await conn.query(
          `INSERT INTO Customer (CustomerType, ContactNo, Address, Status)
           VALUES ('Residential', 'IMPORTED', 'Imported sales', 'Active')`
        );
        importCustomerId = created.insertId;
      }

      for (const [ref, lineItems] of groups.entries()) {
        try {
          const first = lineItems[0];
          const discount = Number(first.Discount) || 0;
          const paymentMethod = first.PaymentMethod || "Cash";
          const saleDate = first.SaleDate ? new Date(first.SaleDate) : new Date();
          if (isNaN(saleDate.getTime())) throw new Error(`Invalid SaleDate for ${ref}`);

          let subtotal = 0;
          const validatedItems = [];
          for (const li of lineItems) {
            const productId = Number(li.ProductID);
            const qty = Number(li.Quantity);
            const unitPrice = Number(li.UnitPrice);
            if (!Number.isInteger(productId) || productId <= 0 || !qty || qty <= 0 || isNaN(unitPrice)) {
              throw new Error(`Invalid row in group ${ref}: ${JSON.stringify(li)}`);
            }
            const [productRows] = await conn.query(`SELECT ProductID FROM Product WHERE ProductID = :pid`, {
              pid: productId,
            });
            if (!productRows[0]) throw new Error(`Product ID ${productId} does not exist (group ${ref})`);
            subtotal += qty * unitPrice;
            validatedItems.push({ productId, qty, unitPrice });
          }

          const vat = (subtotal - discount) * VAT_RATE;
          const totalAmount = subtotal - discount + vat;

          const orderNo = await nextSequence(pool, "`Order`", "OrderNo", "ORD");
          const [orderResult] = await conn.query(
            `INSERT INTO \`Order\` (CustomerID, OrderNo, OrderDate, OrderType, OrderStatus, TotalAmount, Remarks)
             VALUES (:customerId, :orderNo, :saleDate, 'Walk-in', 'Completed', :totalAmount, :remarks)`,
            {
              customerId: importCustomerId,
              orderNo,
              saleDate,
              totalAmount,
              remarks: `Imported from ${fileName || "CSV"} (ref: ${ref})`,
            }
          );
          const orderId = orderResult.insertId;

          for (const item of validatedItems) {
            await conn.query(
              `INSERT INTO OrderDetails (OrderID, ProductID, Quantity, UnitPrice, Subtotal)
               VALUES (:orderId, :productId, :qty, :unitPrice, :subtotal)`,
              {
                orderId,
                productId: item.productId,
                qty: item.qty,
                unitPrice: item.unitPrice,
                subtotal: item.qty * item.unitPrice,
              }
            );

            if (adjustInventory) {
              const [invRows] = await conn.query(
                `SELECT InventoryID, StockOnHand FROM Inventory WHERE WarehouseID = :wid AND ProductID = :pid FOR UPDATE`,
                { wid: DEFAULT_WAREHOUSE_ID, pid: item.productId }
              );
              let inv = invRows[0];
              if (!inv) {
                const [ins] = await conn.query(
                  `INSERT INTO Inventory (WarehouseID, ProductID, StockOnHand) VALUES (:wid, :pid, 0)`,
                  { wid: DEFAULT_WAREHOUSE_ID, pid: item.productId }
                );
                inv = { InventoryID: ins.insertId, StockOnHand: 0 };
              }
              if (inv.StockOnHand >= item.qty) {
                await conn.query(`UPDATE Inventory SET StockOnHand = StockOnHand - :qty WHERE InventoryID = :id`, {
                  qty: item.qty,
                  id: inv.InventoryID,
                });
                await conn.query(
                  `INSERT INTO InventoryTransaction (InventoryID, UserID, TransactionType, Quantity, Reason, ReferenceNo)
                   VALUES (:invId, :userId, 'Stock Out', :qty, 'Sale', :ref)`,
                  { invId: inv.InventoryID, userId: req.user.userId, qty: item.qty, ref: orderNo }
                );
              }
              // If insufficient stock, we silently skip the deduction for this line rather than
              // failing the whole import — historical data still gets recorded either way.
            }
          }

          const saleNo = await nextSequence(pool, "Sales", "SaleNo", "SALE");
          const [saleResult] = await conn.query(
            `INSERT INTO Sales (OrderID, CustomerID, UserID, SaleNo, SaleDate, SalesDiscount, TotalAmount, Remarks)
             VALUES (:orderId, :customerId, :userId, :saleNo, :saleDate, :discount, :totalAmount, :remarks)`,
            {
              orderId,
              customerId: importCustomerId,
              userId: req.user.userId,
              saleNo,
              saleDate,
              discount,
              totalAmount,
              remarks: `Imported (ref: ${ref})`,
            }
          );

          await conn.query(
            `INSERT INTO Payment (PaymentType, SaleID, PaymentMethod, AmountPaid, PaymentDate)
             VALUES ('Sale', :saleId, :method, :amount, :saleDate)`,
            { saleId: saleResult.insertId, method: paymentMethod, amount: totalAmount, saleDate }
          );

          importedCount++;
        } catch (groupErr) {
          errors.push(groupErr.message);
        }
      }

      if (importedCount === 0) {
        throw new ApiError(400, `No rows could be imported. Errors: ${errors.join("; ")}`);
      }

      await conn.query(
        `INSERT INTO DataActivityLog (UserID, ActivityType, DataType, FileName, FileFormat, Status)
         VALUES (:userId, 'Import', 'Sales Data', :fileName, 'CSV', :status)`,
        {
          userId: req.user.userId,
          fileName: fileName || "sales_import.csv",
          status: errors.length ? "Successful" : "Successful",
        }
      );

      await conn.commit();
      res.status(201).json({
        message: `Imported ${importedCount} sale(s) from ${groups.size} group(s).`,
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

// DELETE /sales/:id — "voids" the sale rather than hard-deleting it:
// restores the stock that was deducted, removes the Payment, marks the Order Cancelled,
// then removes the Sales/OrderDetails rows.
router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [saleRows] = await conn.query(
        `SELECT SaleID, OrderID FROM Sales WHERE SaleID = :id FOR UPDATE`,
        { id: req.params.id }
      );
      if (!saleRows[0]) throw new ApiError(404, "Sale not found.");
      const { OrderID: orderId } = saleRows[0];

      const [deliveryRows] = await conn.query(
        `SELECT DeliveryID FROM Delivery WHERE SaleID = :id`,
        { id: req.params.id }
      );
      if (deliveryRows[0]) {
        throw new ApiError(
          400,
          "This sale has an active delivery record. Cancel the delivery first before voiding the sale."
        );
      }

      const [items] = await conn.query(
        `SELECT ProductID, Quantity FROM OrderDetails WHERE OrderID = :orderId`,
        { orderId }
      );

      for (const item of items) {
        const [invRows] = await conn.query(
          `SELECT InventoryID FROM Inventory WHERE ProductID = :pid ORDER BY InventoryID LIMIT 1 FOR UPDATE`,
          { pid: item.ProductID }
        );
        if (invRows[0]) {
          await conn.query(
            `UPDATE Inventory SET StockOnHand = StockOnHand + :qty WHERE InventoryID = :id`,
            { qty: item.Quantity, id: invRows[0].InventoryID }
          );
          await conn.query(
            `INSERT INTO InventoryTransaction (InventoryID, UserID, TransactionType, Quantity, Reason, ReferenceNo, Remarks)
             VALUES (:invId, :userId, 'Stock In', :qty, 'Adjustment', :ref, 'Sale voided — stock restored')`,
            { invId: invRows[0].InventoryID, userId: req.user.userId, qty: item.Quantity, ref: `VOID-SALE-${req.params.id}` }
          );
        }
      }

      await conn.query(`DELETE FROM Payment WHERE SaleID = :id`, { id: req.params.id });
      await conn.query(`DELETE FROM Sales WHERE SaleID = :id`, { id: req.params.id });
      await conn.query(`DELETE FROM OrderDetails WHERE OrderID = :orderId`, { orderId });
      await conn.query(`UPDATE \`Order\` SET OrderStatus = 'Cancelled' WHERE OrderID = :orderId`, { orderId });

      await conn.commit();
      res.json({ message: "Sale voided and stock restored." });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  })
);

module.exports = router;