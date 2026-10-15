const router = require("express").Router();
const pool = require("../config/db");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/apiError");
const { authenticate } = require("../middleware/auth");
const { nextSequence } = require("../utils/generateNumbers");
const { parseCsv } = require("../utils/csv");

async function nextId(conn, table, column, prefix, pad = 3) {
  const normalizedPrefix = String(prefix || "").toUpperCase();
  const [rows] = await conn.query(
    `SELECT ${column} AS id FROM ${table} WHERE ${column} LIKE :pattern`,
    { pattern: `${normalizedPrefix}%` }
  );

  let max = 0;
  const matcher = new RegExp(`^${normalizedPrefix}-?([0-9]+)$`);
  for (const row of rows) {
    const candidate = String(row.id || "").toUpperCase();
    const match = candidate.match(matcher);
    if (!match) continue;
    const n = Number(match[1]);
    if (Number.isInteger(n) && n > max) max = n;
  }

  let next = max + 1;
  while (true) {
    const candidateId = `${normalizedPrefix}-${String(next).padStart(pad, "0")}`;
    const [existsRows] = await conn.query(
      `SELECT ${column} AS id FROM ${table} WHERE ${column} = :id LIMIT 1`,
      { id: candidateId }
    );
    if (!existsRows[0]) return candidateId;
    next += 1;
  }
}

const DEFAULT_WAREHOUSE_ID = "WH-001"; // fallback when an explicit warehouse is provided by callers

router.use(authenticate);

async function getTaxSettings(companyId) {
  const [rows] = await pool.query(
    `SELECT TaxRate, TaxEnabled FROM CompanySettings WHERE CompanyID = :companyId`,
    { companyId }
  );
  if (!rows[0]) return { rate: 0.12, enabled: true }; // sensible default if Settings was never saved
  return { rate: Number(rows[0].TaxRate) / 100, enabled: !!rows[0].TaxEnabled };
}

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

    // Hide demo/seeded rows from the Sales module listing.
    sql += `
      AND (s.Remarks IS NULL OR s.Remarks NOT LIKE 'Dashboard history seed %')`;

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
router.post(
  "/",
  asyncHandler(async (req, res) => {
    const { customerType, items, discount, paymentMethod, amountCollected, warehouseId, remarks, referenceNo, returnedCylinders = [] } = req.body;
    let { customerId } = req.body;
    const orderType = customerType || "Walk-in";
    const methods = orderType === "Walk-in" ? ["Cash", "GCash", "Card", "Bank Transfer"] : orderType === "Pickup" ? ["GCash", "Card", "Bank Transfer"] : orderType === "Delivery" ? ["GCash", "Card", "Bank Transfer", "Cash on Delivery"] : [];
    if (!methods.includes(paymentMethod)) throw new ApiError(400, "Invalid payment method for this order type.");
    if (["GCash", "Card", "Bank Transfer"].includes(paymentMethod) && (typeof referenceNo !== "string" || !referenceNo.trim() || referenceNo.length > 50)) throw new ApiError(400, "A reference number (up to 50 characters) is required.");
    if (!Array.isArray(returnedCylinders) || (returnedCylinders.length && orderType !== "Walk-in")) throw new ApiError(400, "Cylinder returns are only available for walk-in orders.");
    for (const item of returnedCylinders) {
      if (!item.productId || !Number.isSafeInteger(item.qty) || item.qty <= 0) throw new ApiError(400, "Returned cylinder quantities must be positive whole numbers.");
    }
    if (returnedCylinders.length && !warehouseId) throw new ApiError(400, "Select a warehouse for returned cylinders.");


    if (!Array.isArray(items) || !items.length) {
      throw new ApiError(400, "At least one item is required.");
    }

    for (const item of items) {
      if (!item.productId || !Number.isSafeInteger(Number(item.qty)) || Number(item.qty) <= 0 || !Number.isFinite(Number(item.unitPrice)) || Number(item.unitPrice) < 0) {
        throw new ApiError(400, `Invalid productId "${item.productId}" or quantity.`);
      }
      item.productId = String(item.productId);
      item.qty = Number(item.qty);
      item.unitPrice = Number(item.unitPrice);
    }

    const { rate: taxRate, enabled: taxEnabled } = await getTaxSettings(req.user.companyId);

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      if (warehouseId) {
        const [warehouses] = await conn.query("SELECT WarehouseID FROM Warehouse WHERE WarehouseID = ? AND CompanyID = ? FOR UPDATE", [warehouseId, req.user.companyId]);
        if (!warehouses.length) throw new ApiError(400, "The warehouse does not belong to your company.");
      }


      if (!customerId) {
        const [existing] = await conn.query(
          `SELECT CustomerID FROM Customer WHERE ContactNo = 'WALKIN' LIMIT 1`
        );
        if (existing[0]) {
          customerId = existing[0].CustomerID;
        } else {
          const newCustomerId = await nextId(conn, "Customer", "CustomerID", "CUST");
          await conn.query(
            `INSERT INTO Customer (CustomerID, CustomerType, ContactNo, Address, Status)
             VALUES (:customerId, :type, 'WALKIN', 'Walk-in', 'Active')`,
            {
              customerId: newCustomerId,
              type: customerType === "Business Account" ? "Commercial" : "Residential",
            }
          );
          customerId = newCustomerId;
        }
      }

      const subtotal = items.reduce((sum, it) => sum + it.qty * it.unitPrice, 0);
      const discountAmount = discount || 0;
      const vat = taxEnabled ? (subtotal - discountAmount) * taxRate / (1 + taxRate) : 0;
      const totalAmount = subtotal - discountAmount;
      if (!Number.isFinite(Number(amountCollected)) || Number(amountCollected) < totalAmount || totalAmount <= 0) throw new ApiError(400, "Amount collected must cover the total due.");
      const hasExplicitWarehouse = !!warehouseId;
      const wid = hasExplicitWarehouse ? warehouseId : DEFAULT_WAREHOUSE_ID;

      const orderNo = await nextSequence(conn, "`Order`", "OrderNo", "ORD");
      const orderId = await nextId(conn, "`Order`", "OrderID", "ORD");
      await conn.query(
        `INSERT INTO \`Order\` (OrderID, CustomerID, OrderNo, OrderType, OrderStatus, TotalAmount, Remarks)
         VALUES (:orderId, :customerId, :orderNo, :orderType, 'Completed', :totalAmount, :remarks)`,
        { orderId, customerId, orderNo, orderType, totalAmount, remarks: remarks || null }
      );

      for (const item of items) {
        const [productRows] = await conn.query(
          `SELECT ProductID FROM Product WHERE ProductID = :pid`,
          { pid: item.productId }
        );
        if (!productRows[0]) {
          throw new ApiError(400, `Product ID ${item.productId} does not exist.`);
        }

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

        if (hasExplicitWarehouse) {
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
            qty: item.qty,
            id: inv.InventoryID,
          });
          const transactionId = await nextId(conn, "InventoryTransaction", "TransactionID", "T");
          await conn.query(
            `INSERT INTO InventoryTransaction (TransactionID, InventoryID, UserID, TransactionType, Quantity, Reason, ReferenceNo)
             VALUES (:transactionId, :invId, :userId, 'Stock Out', :qty, 'Sale', :ref)`,
            { transactionId, invId: inv.InventoryID, userId: req.user.userId, qty: item.qty, ref: orderNo }
          );
        } else {
          const [invRows] = await conn.query(
            `SELECT i.InventoryID, i.StockOnHand
             FROM Inventory i
             JOIN Warehouse w ON w.WarehouseID = i.WarehouseID
             WHERE w.CompanyID = :companyId AND i.ProductID = :pid
             ORDER BY i.StockOnHand DESC, i.InventoryID
             FOR UPDATE`,
            { companyId: req.user.companyId, pid: item.productId }
          );

          const totalAvailable = invRows.reduce((sum, row) => sum + Number(row.StockOnHand || 0), 0);
          if (totalAvailable < item.qty) {
            throw new ApiError(400, `Insufficient stock for product ${item.productId}.`);
          }

          let remaining = item.qty;
          for (const inv of invRows) {
            if (remaining <= 0) break;
            const available = Number(inv.StockOnHand || 0);
            if (available <= 0) continue;

            const deductQty = Math.min(available, remaining);
            await conn.query(
              `UPDATE Inventory SET StockOnHand = StockOnHand - :qty WHERE InventoryID = :id`,
              { qty: deductQty, id: inv.InventoryID }
            );

            const transactionId = await nextId(conn, "InventoryTransaction", "TransactionID", "T");
            await conn.query(
              `INSERT INTO InventoryTransaction (TransactionID, InventoryID, UserID, TransactionType, Quantity, Reason, ReferenceNo)
               VALUES (:transactionId, :invId, :userId, 'Stock Out', :qty, 'Sale', :ref)`,
              { transactionId, invId: inv.InventoryID, userId: req.user.userId, qty: deductQty, ref: orderNo }
            );

            remaining -= deductQty;
          }
        }
      }

      const saleNo = await nextSequence(conn, "Sales", "SaleNo", "SALE");
      const saleId = await nextId(conn, "Sales", "SaleID", "S");
      await conn.query(
        `INSERT INTO Sales (SaleID, OrderID, CustomerID, UserID, SaleNo, SalesDiscount, TotalAmount, Remarks)
         VALUES (:saleId, :orderId, :customerId, :userId, :saleNo, :discount, :totalAmount, :remarks)`,
        {
          saleId,
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
        const paymentId = await nextId(conn, "Payment", "PaymentID", "PAY");
        await conn.query(
          `INSERT INTO Payment (PaymentID, PaymentType, SaleID, PaymentMethod, AmountPaid, ReferenceNo)
           VALUES (:paymentId, 'Sale', :saleId, :method, :amount, :referenceNo)`,
          { paymentId, saleId, method: paymentMethod, amount: amountCollected, referenceNo: referenceNo?.trim() || null }
        );
      }


      let emptyCylinderReference = null;
      if (returnedCylinders.length) {
        const [eligible] = await conn.query("SELECT p.ProductID FROM Product p JOIN Category c ON c.CategoryID=p.CategoryID WHERE p.ProductID IN (?) AND c.Category IN ('Cylinder', 'Gasul LPG')", [items.map((item) => item.productId)]);
        if (!eligible.length) throw new ApiError(400, "Cylinder returns require a Gasul LPG or Cylinder purchase.");
        // Lock the company row so ECR references are allocated serially across its warehouses.
        await conn.query("SELECT CompanyID FROM Company WHERE CompanyID=? FOR UPDATE", [req.user.companyId]);
        emptyCylinderReference = await nextSequence(conn, "InventoryTransaction", "ReferenceNo", "ECR");
        for (const item of returnedCylinders) {
          const [products] = await conn.query("SELECT p.ProductID FROM Product p JOIN Category c ON c.CategoryID=p.CategoryID WHERE p.ProductID=? AND c.Category='Cylinder' AND p.Status='Active'", [item.productId]);
          if (!products.length) throw new ApiError(400, "Only active Cylinder products can be returned.");
          const [inventory] = await conn.query("SELECT InventoryID FROM Inventory WHERE WarehouseID=? AND ProductID=? FOR UPDATE", [warehouseId, item.productId]);
          let inventoryId = inventory[0]?.InventoryID;
          if (!inventoryId) {
            inventoryId = await nextId(conn, "Inventory", "InventoryID", "INT");
            await conn.query("INSERT INTO Inventory (InventoryID,WarehouseID,ProductID,StockOnHand) VALUES (?,?,?,0)", [inventoryId,warehouseId,item.productId]);
          }
          await conn.query("UPDATE Inventory SET StockOnHand=StockOnHand+? WHERE InventoryID=?", [item.qty,inventoryId]);
          const transactionId = await nextId(conn, "InventoryTransaction", "TransactionID", "T");
          await conn.query("INSERT INTO InventoryTransaction (TransactionID,InventoryID,UserID,TransactionType,Quantity,Reason,ReferenceNo) VALUES (?,?,?,'Stock In',?,'Empty Cylinder Returned',?)", [transactionId,inventoryId,req.user.userId,item.qty,emptyCylinderReference]);
        }
      }
      const [[cashier]] = await conn.query("SELECT CONCAT(FirstName,' ',LastName) AS name FROM User WHERE UserID=?", [req.user.userId]);
      await conn.commit();
      res.status(201).json({
        cashierName: cashier?.name || "",
        emptyCylinderReference,
        saleId,
        saleNo,
        subtotal,
        vat,
        taxRate: taxEnabled ? taxRate : 0,
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

// POST /sales/import — bulk-import historical sales from a CSV (unchanged from before, still uses the
// company's saved tax rate rather than a hardcoded constant)
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

    const { rate: taxRate, enabled: taxEnabled } = await getTaxSettings(req.user.companyId);

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
        importCustomerId = await nextId(conn, "Customer", "CustomerID", "CUST");
        await conn.query(
          `INSERT INTO Customer (CustomerID, CustomerType, ContactNo, Address, Status)
           VALUES (:customerId, 'Residential', 'IMPORTED', 'Imported sales', 'Active')`,
          { customerId: importCustomerId }
        );
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
            const productId = String(li.ProductID || "").trim();
            const qty = Number(li.Quantity);
            const unitPrice = Number(li.UnitPrice);
            if (!productId || !qty || qty <= 0 || isNaN(unitPrice)) {
              throw new Error(`Invalid row in group ${ref}: ${JSON.stringify(li)}`);
            }
            const [productRows] = await conn.query(`SELECT ProductID FROM Product WHERE ProductID = :pid`, {
              pid: productId,
            });
            if (!productRows[0]) throw new Error(`Product ID ${productId} does not exist (group ${ref})`);
            subtotal += qty * unitPrice;
            validatedItems.push({ productId, qty, unitPrice });
          }

          const vat = taxEnabled ? (subtotal - discount) * taxRate : 0;
          const totalAmount = subtotal - discount + vat;

          const orderNo = await nextSequence(pool, "`Order`", "OrderNo", "ORD");
          const orderId = await nextId(conn, "`Order`", "OrderID", "ORD");
          await conn.query(
            `INSERT INTO \`Order\` (OrderID, CustomerID, OrderNo, OrderDate, OrderType, OrderStatus, TotalAmount, Remarks)
             VALUES (:orderId, :customerId, :orderNo, :saleDate, 'Walk-in', 'Completed', :totalAmount, :remarks)`,
            {
              orderId,
              customerId: importCustomerId,
              orderNo,
              saleDate,
              totalAmount,
              remarks: `Imported from ${fileName || "CSV"} (ref: ${ref})`,
            }
          );

          for (const item of validatedItems) {
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

            if (adjustInventory) {
              const [invRows] = await conn.query(
                `SELECT InventoryID, StockOnHand FROM Inventory WHERE WarehouseID = :wid AND ProductID = :pid FOR UPDATE`,
                { wid: DEFAULT_WAREHOUSE_ID, pid: item.productId }
              );
              let inv = invRows[0];
              if (!inv) {
                const inventoryId = await nextId(conn, "Inventory", "InventoryID", "INT");
                await conn.query(
                  `INSERT INTO Inventory (InventoryID, WarehouseID, ProductID, StockOnHand) VALUES (:inventoryId, :wid, :pid, 0)`,
                  { inventoryId, wid: DEFAULT_WAREHOUSE_ID, pid: item.productId }
                );
                inv = { InventoryID: inventoryId, StockOnHand: 0 };
              }
              if (inv.StockOnHand >= item.qty) {
                await conn.query(`UPDATE Inventory SET StockOnHand = StockOnHand - :qty WHERE InventoryID = :id`, {
                  qty: item.qty,
                  id: inv.InventoryID,
                });
                const transactionId = await nextId(conn, "InventoryTransaction", "TransactionID", "T");
                await conn.query(
                  `INSERT INTO InventoryTransaction (TransactionID, InventoryID, UserID, TransactionType, Quantity, Reason, ReferenceNo)
                   VALUES (:transactionId, :invId, :userId, 'Stock Out', :qty, 'Sale', :ref)`,
                  { transactionId, invId: inv.InventoryID, userId: req.user.userId, qty: item.qty, ref: orderNo }
                );
              }
            }
          }

          const saleNo = await nextSequence(pool, "Sales", "SaleNo", "SALE");
          const saleId = await nextId(conn, "Sales", "SaleID", "S");
          await conn.query(
            `INSERT INTO Sales (SaleID, OrderID, CustomerID, UserID, SaleNo, SaleDate, SalesDiscount, TotalAmount, Remarks)
             VALUES (:saleId, :orderId, :customerId, :userId, :saleNo, :saleDate, :discount, :totalAmount, :remarks)`,
            {
              saleId,
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

          const paymentId = await nextId(conn, "Payment", "PaymentID", "PAY");
          await conn.query(
            `INSERT INTO Payment (PaymentID, PaymentType, SaleID, PaymentMethod, AmountPaid, PaymentDate)
             VALUES (:paymentId, 'Sale', :saleId, :method, :amount, :saleDate)`,
            { paymentId, saleId, method: paymentMethod, amount: totalAmount, saleDate }
          );

          importedCount++;
        } catch (groupErr) {
          errors.push(groupErr.message);
        }
      }

      if (importedCount === 0) {
        throw new ApiError(400, `No rows could be imported. Errors: ${errors.join("; ")}`);
      }

      const dataActivityId = await nextId(conn, "DataActivityLog", "DataActivityID", "DA");
      await conn.query(
        `INSERT INTO DataActivityLog (DataActivityID, UserID, ActivityType, DataType, FileName, FileFormat, Status)
         VALUES (:dataActivityId, :userId, 'Import', 'Sales Data', :fileName, 'CSV', 'Successful')`,
        { dataActivityId, userId: req.user.userId, fileName: fileName || "sales_import.csv" }
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

// DELETE /sales/:id — "voids" the sale rather than hard-deleting it
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
          const transactionId = await nextId(conn, "InventoryTransaction", "TransactionID", "T");
          await conn.query(
            `INSERT INTO InventoryTransaction (TransactionID, InventoryID, UserID, TransactionType, Quantity, Reason, ReferenceNo, Remarks)
             VALUES (:transactionId, :invId, :userId, 'Stock In', :qty, 'Adjustment', :ref, 'Sale voided — stock restored')`,
            { transactionId, invId: invRows[0].InventoryID, userId: req.user.userId, qty: item.Quantity, ref: `VOID-SALE-${req.params.id}` }
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












