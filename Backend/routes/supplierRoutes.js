const router = require("express").Router();
const pool = require("../config/db");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/apiError");
const { authenticate } = require("../middleware/auth");

router.use(authenticate);

// GET /suppliers?search=&status=
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { search, status } = req.query;
    let sql = `SELECT SupplierID AS id, SupplierName AS name, ContactPerson AS contactPerson,
                      Email AS email, Address AS address, Contact AS phone,
                      LeadTimeDays AS leadTime, Status AS status
               FROM Supplier WHERE 1=1`;
    const params = {};
    if (search) {
      sql += ` AND (SupplierName LIKE :s OR ContactPerson LIKE :s OR SupplierID = :sid)`;
      params.s = `%${search}%`;
      params.sid = search.trim();
    }
    if (status) {
      sql += ` AND Status = :status`;
      params.status = status;
    }
    sql += ` ORDER BY SupplierID DESC`;
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  })
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT SupplierID AS id, SupplierName AS name, ContactPerson AS contactPerson,
              Email AS email, Address AS address, Contact AS phone,
              LeadTimeDays AS leadTime, Status AS status
       FROM Supplier WHERE SupplierID = :id`,
      { id: req.params.id }
    );
    if (!rows[0]) throw new ApiError(404, "Supplier not found.");
    res.json(rows[0]);
  })
);

// Supplier products / PO history / delivery history — powers ViewSupplierModal.jsx
router.get(
  "/:id/products",
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT ProductID AS id, ProductName AS name, CostPrice AS costPrice, Unit AS unit, UnitValue AS unitValue,
              ReorderLevel AS reorderLevel, Status AS status
       FROM Product WHERE SupplierID = :id ORDER BY ProductID`,
      { id: req.params.id }
    );
    res.json(rows);
  })
);

router.get(
  "/:id/purchase-orders",
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT PurchaseOrderID AS id, PONo AS poNo, OrderDate AS orderDate,
              ExpectedDeliveryDate AS expectedDeliveryDate, TotalAmount AS totalAmount, Status AS status
       FROM PurchaseOrder WHERE SupplierID = :id ORDER BY OrderDate DESC`,
      { id: req.params.id }
    );
    res.json(rows);
  })
);

// Delivery history for a supplier = received purchase orders + their items, flattened
router.get(
  "/:id/deliveries",
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT po.PurchaseOrderID AS poId, po.PONo AS poNo, po.OrderDate AS orderDate,
              SUM(poi.Quantity) AS totalQty, po.Status AS status
       FROM PurchaseOrder po
       JOIN PurchaseOrderItem poi ON poi.PurchaseOrderID = po.PurchaseOrderID
       WHERE po.SupplierID = :id AND po.Status = 'Received'
       GROUP BY po.PurchaseOrderID
       ORDER BY po.OrderDate DESC`,
      { id: req.params.id }
    );
    res.json(rows);
  })
);

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const { fullName, defaultLeadTime, status, contactPerson, email, phone, address } = req.body;
    if (!fullName) throw new ApiError(400, "fullName is required.");
    const conn = await pool.getConnection();
    try {
      const [[lock]] = await conn.query("SELECT GET_LOCK('gastrack_supplier_ids', 10) AS acquired");
      if (Number(lock.acquired) !== 1) throw new ApiError(503, "Supplier ID allocation busy. Please retry.");
      const [[row]] = await conn.query("SELECT COALESCE(MAX(CAST(SUBSTRING(SupplierID, 5) AS UNSIGNED)), 0) AS lastId FROM SupplierHistory WHERE SupplierID REGEXP '^SUP-[0-9]+$'");
      const id = `SUP-${String(Number(row.lastId) + 1).padStart(3, "0")}`;
      await conn.query(
      `INSERT INTO Supplier (SupplierID, SupplierName, ContactPerson, Email, Address, Contact, LeadTimeDays, Status)
       VALUES (:id, :name, :contactPerson, :email, :address, :phone, :leadTime, :status)`,
      {
        id,
        name: fullName,
        contactPerson: contactPerson || null,
        email: email || null,
        address: address || null,
        phone: phone || null,
        leadTime: Number(defaultLeadTime) || 0,
        status: status || "Active",
      }
    );
      res.status(201).json({ id });
    } finally {
      try { await conn.query("SELECT RELEASE_LOCK('gastrack_supplier_ids')"); }
      finally { conn.release(); }
    }
  })
);

router.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const { fullName, status, contactPerson, email, phone, address, defaultLeadTime } = req.body;
    const [result] = await pool.query(
      `UPDATE Supplier SET
         SupplierName = COALESCE(:name, SupplierName),
         ContactPerson = COALESCE(:contactPerson, ContactPerson),
         Email = COALESCE(:email, Email),
         Address = COALESCE(:address, Address),
         Contact = COALESCE(:phone, Contact),
         LeadTimeDays = COALESCE(:leadTime, LeadTimeDays),
         Status = COALESCE(:status, Status)
       WHERE SupplierID = :id`,
      {
        id: req.params.id,
        name: fullName || null,
        contactPerson: contactPerson || null,
        email: email || null,
        address: address || null,
        phone: phone || null,
        leadTime: defaultLeadTime != null ? Number(defaultLeadTime) : null,
        status: status || null,
      }
    );
    if (!result.affectedRows) throw new ApiError(404, "Supplier not found.");
    res.json({ message: "Supplier updated." });
  })
);

// Linked records retain the same SupplierID through SupplierHistory snapshots.
router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [rows] = await conn.query("SELECT * FROM Supplier WHERE SupplierID = :id FOR UPDATE", { id: req.params.id });
      if (!rows[0]) throw new ApiError(404, "Supplier not found.");
      // Refresh the snapshot atomically before removing the live supplier.
      const columns = Object.keys(rows[0]);
      const quote = value => '`' + value.replace(/`/g, '``') + '`';
      await conn.query(
        `INSERT INTO SupplierHistory (${columns.map(quote).join(', ')})
         SELECT ${columns.map(quote).join(', ')} FROM Supplier WHERE SupplierID = :id
         ON DUPLICATE KEY UPDATE ${columns.filter(column => column !== 'SupplierID').map(column => `${quote(column)} = VALUES(${quote(column)})`).join(', ')}`,
        { id: req.params.id }
      );
      await conn.query("DELETE FROM Supplier WHERE SupplierID = :id", { id: req.params.id });
      await conn.commit();
      res.json({ message: "Supplier deleted permanently. Linked records retain a supplier snapshot." });
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  })
);

module.exports = router;
