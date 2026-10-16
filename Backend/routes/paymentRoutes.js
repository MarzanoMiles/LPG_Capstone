const router = require("express").Router();
const pool = require("../config/db");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/apiError");
const { authenticate } = require("../middleware/auth");

router.use(authenticate);

router.get("/", asyncHandler(async (req, res) => {
  const { type } = req.query;
  let sql = `SELECT * FROM Payment WHERE 1=1`;
  const params = {};
  if (type) { sql += ` AND PaymentType = :type`; params.type = type; }
  sql += ` ORDER BY PaymentDate DESC`;
  const [rows] = await pool.query(sql, params);
  res.json(rows);
}));

router.post("/", asyncHandler(async (req, res) => {
  const { paymentType, saleId, purchaseOrderId, paymentMethod, amountPaid, referenceNo, remarks } = req.body;
  if (!paymentType || !paymentMethod || !amountPaid) {
    throw new ApiError(400, "paymentType, paymentMethod and amountPaid are required.");
  }
  if (!["Sale", "Purchase"].includes(paymentType)) throw new ApiError(400, "Use the authorized order refund workflow for refunds.");
  if (!Number.isFinite(Number(amountPaid)) || Number(amountPaid) <= 0) throw new ApiError(400, "Payment must be positive.");
  const id = await require('../utils/entityIds').nextEntityId(pool,'Payment');
  await pool.query(
    `INSERT INTO Payment (PaymentID, PaymentType, SaleID, PurchaseOrderID, PaymentMethod, AmountPaid, ReferenceNo, Remarks)
     VALUES (:id, :paymentType, :saleId, :purchaseOrderId, :paymentMethod, :amountPaid, :referenceNo, :remarks)`,
    {
      id, paymentType, saleId: saleId || null, purchaseOrderId: purchaseOrderId || null,
      paymentMethod, amountPaid, referenceNo: referenceNo || null, remarks: remarks || null,
    }
  );
  res.status(201).json({ id });
}));

module.exports = router;