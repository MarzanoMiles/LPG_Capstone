const router = require("express").Router();
const pool = require("../config/db");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/apiError");
const { authenticate } = require("../middleware/auth");

router.use(authenticate);

router.get("/", asyncHandler(async (req, res) => {
  const { search } = req.query;
  let sql = `SELECT CustomerID AS id, CustomerType AS type, ContactNo AS phone,
                    Address AS address, Status AS status, CreatedAt AS created
             FROM Customer WHERE 1=1`;
  const params = {};
  if (search) {
    sql += ` AND (ContactNo LIKE :s OR CustomerID = :sid)`;
    params.s = `%${search}%`;
    params.sid = Number(search) || 0;
  }
  const [rows] = await pool.query(sql, params);
  res.json(rows);
}));

router.post("/", asyncHandler(async (req, res) => {
  const { customerType, phone, address, status } = req.body;
  if (!phone || !address) throw new ApiError(400, "phone and address are required.");
  const [result] = await pool.query(
    `INSERT INTO Customer (CustomerType, ContactNo, Address, Status)
     VALUES (:type, :phone, :address, :status)`,
    { type: customerType || "Residential", phone, address, status: status || "Active" }
  );
  res.status(201).json({ id: result.insertId });
}));

router.put("/:id", asyncHandler(async (req, res) => {
  const { phone, address, status } = req.body;
  const [result] = await pool.query(
    `UPDATE Customer SET ContactNo = COALESCE(:phone, ContactNo), Address = COALESCE(:address, Address),
            Status = COALESCE(:status, Status) WHERE CustomerID = :id`,
    { id: req.params.id, phone: phone || null, address: address || null, status: status || null }
  );
  if (!result.affectedRows) throw new ApiError(404, "Customer not found.");
  res.json({ message: "Customer updated." });
}));

router.delete("/:id", asyncHandler(async (req, res) => {
  const [result] = await pool.query(`DELETE FROM Customer WHERE CustomerID = :id`, { id: req.params.id });
  if (!result.affectedRows) throw new ApiError(404, "Customer not found.");
  res.json({ message: "Customer deleted." });
}));

module.exports = router;