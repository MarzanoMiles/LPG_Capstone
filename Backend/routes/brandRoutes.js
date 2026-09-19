const router = require("express").Router();
const pool = require("../config/db");
const asyncHandler = require("../utils/asyncHandler");
const { authenticate } = require("../middleware/auth");

router.use(authenticate);

router.get("/", asyncHandler(async (req, res) => {
  const [rows] = await pool.query(`SELECT BrandID AS id, Brand AS name FROM Brand ORDER BY Brand`);
  res.json(rows);
}));

router.post("/", asyncHandler(async (req, res) => {
  const [result] = await pool.query(`INSERT INTO Brand (Brand) VALUES (:name)`, {
    name: req.body.name,
  });
  res.status(201).json({ id: result.insertId, name: req.body.name });
}));

module.exports = router;