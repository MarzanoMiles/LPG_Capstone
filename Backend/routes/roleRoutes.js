const router = require("express").Router();
const pool = require("../config/db");
const asyncHandler = require("../utils/asyncHandler");
const { authenticate } = require("../middleware/auth");

router.use(authenticate);

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(`SELECT RoleID AS id, RoleName AS name FROM Role ORDER BY RoleID`);
    res.json(rows);
  })
);

module.exports = router;