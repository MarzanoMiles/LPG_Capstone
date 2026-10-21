const router = require("express").Router();
const pool = require("../config/db");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/apiError");
const { authenticate } = require("../middleware/auth");
const { findVehicleRate, signEstimate } = require("../utils/deliveryFee");
const { geocode, storeLocation, drivingDistanceKm } = require("../utils/routeDistance");

router.use(authenticate);

// POST /delivery-fee/estimate  { address, vehicleType }
router.post(
  "/estimate",
  asyncHandler(async (req, res) => {
    const address = typeof req.body.address === "string" ? req.body.address.trim() : "";
    const vehicleType = typeof req.body.vehicleType === "string" ? req.body.vehicleType.trim() : "";
    if (!address || address.length > 255) throw new ApiError(400, "Enter a delivery address (maximum 255 characters).");
    if (!vehicleType) throw new ApiError(400, "Select a delivery vehicle.");

    const rate = await findVehicleRate(pool, req.user.companyId, vehicleType);

    const [rows] = await pool.query(
      `SELECT COALESCE(NULLIF(s.Address,''), c.Address) AS address
       FROM Company c LEFT JOIN CompanySettings s ON s.CompanyID = c.CompanyID
       WHERE c.CompanyID = :companyId`,
      { companyId: req.user.companyId }
    );
    const storeAddress = rows[0]?.address || "";

    const origin = await storeLocation(storeAddress);
    const destination = await geocode(address);
    const distanceKm = await drivingDistanceKm(origin, destination);

    res.json({
      distanceKm,
      storeAddress,
      rate,
      estimateToken: signEstimate({ companyId: req.user.companyId, address, vehicleType: rate.name, distanceKm }),
    });
  })
);

module.exports = router;