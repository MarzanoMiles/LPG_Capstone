const router = require("express").Router();
const pool = require("../config/db");
const asyncHandler = require("../utils/asyncHandler");
const { authenticate } = require("../middleware/auth");

router.use(authenticate);

// GET /data/logs?activityType=Export|Import
router.get(
  "/logs",
  asyncHandler(async (req, res) => {
    const { activityType } = req.query;
    let sql = `
      SELECT DataActivityID AS id, FileName AS file, DataType AS type, FileFormat AS format,
             Status AS status, ActivityDate AS date
      FROM DataActivityLog WHERE 1=1`;
    const params = {};
    if (activityType) { sql += ` AND ActivityType = :activityType`; params.activityType = activityType; }
    sql += ` ORDER BY ActivityDate DESC LIMIT 200`;
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  })
);

// POST /data/export { dataType, dateFrom, dateTo, format }
router.post(
  "/export",
  asyncHandler(async (req, res) => {
    const { dataType, dateFrom, dateTo, format } = req.body;
    const fileName = `${dataType.replace(/\s+/g, "_")}_${Date.now()}.${(format || "csv").toLowerCase()}`;

    // NOTE: actual file generation is out of scope here — this logs the export request.
    const [result] = await pool.query(
      `INSERT INTO DataActivityLog (UserID, ActivityType, DataType, FileName, FileFormat, DateFrom, DateTo, Status)
       VALUES (:userId, 'Export', :dataType, :fileName, :format, :dateFrom, :dateTo, 'Successful')`,
      {
        userId: req.user.userId, dataType, fileName, format: format || "CSV",
        dateFrom: dateFrom || null, dateTo: dateTo || null,
      }
    );
    res.status(201).json({ id: result.insertId, fileName });
  })
);

// POST /data/import { dataType, fileName, format }
router.post(
  "/import",
  asyncHandler(async (req, res) => {
    const { dataType, fileName, format } = req.body;
    const [result] = await pool.query(
      `INSERT INTO DataActivityLog (UserID, ActivityType, DataType, FileName, FileFormat, Status)
       VALUES (:userId, 'Import', :dataType, :fileName, :format, 'Successful')`,
      { userId: req.user.userId, dataType, fileName, format: format || "CSV" }
    );
    res.status(201).json({ id: result.insertId });
  })
);

module.exports = router;