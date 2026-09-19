const router = require("express").Router();
const pool = require("../config/db");
const asyncHandler = require("../utils/asyncHandler");
const { authenticate } = require("../middleware/auth");

router.use(authenticate);

router.get("/", asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT WarehouseID AS id, WarehouseName AS name, Location AS location, Status AS status FROM Warehouse`
  );
  res.json(rows);
}));

module.exports = router;