const router = require("express").Router();
const pool = require("../config/db");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/apiError");
const { authenticate } = require("../middleware/auth");
const { nextSequence } = require("../utils/generateNumbers");

router.use(authenticate);

// GET /deliveries?status=&search=
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { status, search } = req.query;
    let sql = `
      SELECT d.DeliveryID AS deliveryId, d.DRNo AS drNo, s.SaleID AS saleId, s.SaleNo AS saleNo,
             d.DeliveredByUserID AS riderId, d.DeliveryStatus AS status,
             d.DeliveryDate AS deliveredAt, d.DeliveryAddress AS address
      FROM Delivery d JOIN Sales s ON s.SaleID = d.SaleID
      WHERE 1=1`;
    const params = {};
    if (status) { sql += ` AND d.DeliveryStatus = :status`; params.status = status; }
    if (search) { sql += ` AND (d.DRNo LIKE :s OR s.SaleNo LIKE :s)`; params.s = `%${search}%`; }
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  })
);

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const { saleId, deliveredByUserId, deliveryCharge, deliveryAddress, remarks } = req.body;
    if (!saleId || !deliveryAddress) throw new ApiError(400, "saleId and deliveryAddress are required.");
    const drNo = await nextSequence(pool, "Delivery", "DRNo", "DR");
    const [result] = await pool.query(
      `INSERT INTO Delivery (SaleID, DRNo, DeliveredByUserID, DeliveryCharge, DeliveryAddress, DeliveryStatus, Remarks)
       VALUES (:saleId, :drNo, :riderId, :charge, :address, 'Pending', :remarks)`,
      {
        saleId,
        drNo,
        riderId: deliveredByUserId || null,
        charge: deliveryCharge || 0,
        address: deliveryAddress,
        remarks: remarks || null,
      }
    );
    res.status(201).json({ id: result.insertId, drNo });
  })
);

router.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const { deliveryStatus, deliveredByUserId, deliveryDate } = req.body;
    const [result] = await pool.query(
      `UPDATE Delivery SET
         DeliveryStatus = COALESCE(:status, DeliveryStatus),
         DeliveredByUserID = COALESCE(:riderId, DeliveredByUserID),
         DeliveryDate = COALESCE(:deliveryDate, DeliveryDate)
       WHERE DeliveryID = :id`,
      {
        id: req.params.id,
        status: deliveryStatus || null,
        riderId: deliveredByUserId || null,
        deliveryDate: deliveryDate || null,
      }
    );
    if (!result.affectedRows) throw new ApiError(404, "Delivery not found.");
    res.json({ message: "Delivery updated." });
  })
);

module.exports = router;