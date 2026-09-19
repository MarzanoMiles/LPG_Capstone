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
      params.sid = Number(search) || 0;
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
      `SELECT ProductID AS id, ProductName AS name, CostPrice AS costPrice, Unit AS unit,
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
    const [result] = await pool.query(
      `INSERT INTO Supplier (SupplierName, ContactPerson, Email, Address, Contact, LeadTimeDays, Status)
       VALUES (:name, :contactPerson, :email, :address, :phone, :leadTime, :status)`,
      {
        name: fullName,
        contactPerson: contactPerson || null,
        email: email || null,
        address: address || null,
        phone: phone || null,
        leadTime: Number(defaultLeadTime) || 0,
        status: status || "Active",
      }
    );
    res.status(201).json({ id: result.insertId });
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

// DELETE /suppliers/:id — soft delete: suppliers are referenced by Product, PurchaseOrder, RestockRecommendation.
router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const [result] = await pool.query(
      `UPDATE Supplier SET Status = 'Inactive' WHERE SupplierID = :id`,
      { id: req.params.id }
    );
    if (!result.affectedRows) throw new ApiError(404, "Supplier not found.");
    res.json({ message: "Supplier deactivated." });
  })
);

module.exports = router;