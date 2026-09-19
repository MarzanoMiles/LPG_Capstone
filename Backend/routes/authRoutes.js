const router = require("express").Router();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("../config/db");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/apiError");
const { authenticate } = require("../middleware/auth");

// POST /auth/login  -> matches App.jsx's apiRequest("/auth/login", { email, password })
router.post(
  "/login",
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) throw new ApiError(400, "Email and password are required.");

    const [rows] = await pool.query(
      `SELECT u.UserID, u.CompanyID, u.RoleID, r.RoleName, u.FirstName, u.LastName,
              u.Email, u.PasswordHash, u.Status
       FROM User u
       JOIN Role r ON r.RoleID = u.RoleID
       WHERE u.Email = :email`,
      { email }
    );

    const user = rows[0];
    if (!user) throw new ApiError(401, "Invalid email or password.");
    if (user.Status !== "Active") throw new ApiError(403, "This account is inactive.");

    const valid = await bcrypt.compare(password, user.PasswordHash);
    if (!valid) throw new ApiError(401, "Invalid email or password.");

    const token = jwt.sign(
      {
        userId: user.UserID,
        companyId: user.CompanyID,
        roleId: user.RoleID,
        roleName: user.RoleName,
        email: user.Email,
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || "8h" }
    );

    await pool.query(
      `INSERT INTO UserActivity (UserID, ActivityType, Module, Description)
       VALUES (:userId, 'Login', 'Auth', 'User logged in')`,
      { userId: user.UserID }
    );

    res.json({
      token,
      user: {
        id: user.UserID,
        firstName: user.FirstName,
        lastName: user.LastName,
        email: user.Email,
        role: user.RoleName,
        companyId: user.CompanyID,
      },
    });
  })
);

// GET /auth/me
router.get(
  "/me",
  authenticate,
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT u.UserID, u.FirstName, u.LastName, u.Email, r.RoleName, u.Status
       FROM User u JOIN Role r ON r.RoleID = u.RoleID WHERE u.UserID = :id`,
      { id: req.user.userId }
    );
    if (!rows[0]) throw new ApiError(404, "User not found.");
    res.json(rows[0]);
  })
);

module.exports = router;