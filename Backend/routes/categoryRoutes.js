const router = require("express").Router();
const pool = require("../config/db");
const asyncHandler = require("../utils/asyncHandler");
const { authenticate } = require("../middleware/auth");

router.use(authenticate);

router.get("/", asyncHandler(async (req, res) => {
  const [rows] = await pool.query(`SELECT CategoryID AS id, Category AS name FROM Category ORDER BY Category`);
  res.json(rows);
}));

router.post("/", asyncHandler(async (req, res) => {
  const [result] = await pool.query(`INSERT INTO Category (Category) VALUES (:name)`, {
    name: req.body.name,
  });
  res.status(201).json({ id: result.insertId, name: req.body.name });
}));

module.exports = router;