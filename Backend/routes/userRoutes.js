const router = require("express").Router();
const bcrypt = require("bcryptjs");
const pool = require("../config/db");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/apiError");
const { authenticate, authorize } = require("../middleware/auth");

router.use(authenticate);

// GET /users?search=&role=&status=&branch=
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { search, role, status } = req.query;
    let sql = `
      SELECT u.UserID AS id, CONCAT(u.FirstName, ' ', u.LastName) AS name, u.Email AS email,
             r.RoleName AS role, u.Status AS status, u.CreatedAt AS createdAt
      FROM User u
      JOIN Role r ON r.RoleID = u.RoleID
      WHERE u.CompanyID = :companyId`;
    const params = { companyId: req.user.companyId };
    if (search) {
      sql += ` AND (u.FirstName LIKE :s OR u.LastName LIKE :s OR u.Email LIKE :s)`;
      params.s = `%${search}%`;
    }
    if (role) {
      sql += ` AND r.RoleName = :role`;
      params.role = role;
    }
    if (status) {
      sql += ` AND u.Status = :status`;
      params.status = status;
    }
    sql += ` ORDER BY u.UserID DESC`;
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  })
);

// GET /users/activity-log
router.get(
  "/activity-log",
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(`
      SELECT a.UserActivityID AS id, u.UserID AS userId, CONCAT(u.FirstName,' ',u.LastName) AS name,
             r.RoleName AS role, a.Module AS module, a.ActivityType AS action, a.ActivityDate AS datetime
      FROM UserActivity a
      JOIN User u ON u.UserID = a.UserID
      JOIN Role r ON r.RoleID = u.RoleID
      ORDER BY a.ActivityDate DESC
      LIMIT 200
    `);
    res.json(rows);
  })
);

router.post(
  "/",
  authorize("Admin", "Manager"),
  asyncHandler(async (req, res) => {
    const { fullName, usernameEmail, password, role, status } = req.body;
    if (!fullName || !usernameEmail || !password || !role) {
      throw new ApiError(400, "fullName, usernameEmail, password and role are required.");
    }

    const [roleRows] = await pool.query(`SELECT RoleID FROM Role WHERE RoleName = :role`, { role });
    if (!roleRows[0]) throw new ApiError(400, "Invalid role.");

    const [existing] = await pool.query(`SELECT UserID FROM User WHERE Email = :email`, { email: usernameEmail });
    if (existing[0]) throw new ApiError(409, "A user with this email already exists.");

    const [firstName, ...rest] = fullName.trim().split(" ");
    const lastName = rest.join(" ") || firstName;
    const passwordHash = await bcrypt.hash(password, 10);

    const [result] = await pool.query(
      `INSERT INTO User (CompanyID, RoleID, FirstName, LastName, Email, PasswordHash, Status)
       VALUES (:companyId, :roleId, :firstName, :lastName, :email, :passwordHash, :status)`,
      {
        companyId: req.user.companyId,
        roleId: roleRows[0].RoleID,
        firstName,
        lastName,
        email: usernameEmail,
        passwordHash,
        status: status || "Active",
      }
    );

    await pool.query(
      `INSERT INTO UserActivity (UserID, ActivityType, Module, RecordID, Description)
       VALUES (:userId, 'Create', 'Users', :recordId, 'Created a new user')`,
      { userId: req.user.userId, recordId: result.insertId }
    );

    res.status(201).json({ id: result.insertId });
  })
);

router.put(
  "/:id",
  authorize("Admin", "Manager"),
  asyncHandler(async (req, res) => {
    const { fullName, status, role } = req.body;
    const params = { id: req.params.id };
    const sets = [];

    if (fullName) {
      const [firstName, ...rest] = fullName.trim().split(" ");
      sets.push(`FirstName = :firstName`, `LastName = :lastName`);
      params.firstName = firstName;
      params.lastName = rest.join(" ") || firstName;
    }
    if (status) {
      sets.push(`Status = :status`);
      params.status = status;
    }
    if (role) {
      const [roleRows] = await pool.query(`SELECT RoleID FROM Role WHERE RoleName = :role`, { role });
      if (!roleRows[0]) throw new ApiError(400, "Invalid role.");
      sets.push(`RoleID = :roleId`);
      params.roleId = roleRows[0].RoleID;
    }
    if (!sets.length) throw new ApiError(400, "No fields provided to update.");

    const [result] = await pool.query(`UPDATE User SET ${sets.join(", ")} WHERE UserID = :id`, params);
    if (!result.affectedRows) throw new ApiError(404, "User not found.");
    res.json({ message: "User updated." });
  })
);

router.delete(
  "/:id",
  authorize("Admin"),
  asyncHandler(async (req, res) => {
    const [result] = await pool.query(`DELETE FROM User WHERE UserID = :id`, { id: req.params.id });
    if (!result.affectedRows) throw new ApiError(404, "User not found.");
    res.json({ message: "User deleted." });
  })
);

module.exports = router;