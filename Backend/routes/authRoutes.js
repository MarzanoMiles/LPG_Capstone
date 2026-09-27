const router = require("express").Router();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const pool = require("../config/db");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/apiError");
const { authenticate } = require("../middleware/auth");
const { sendMail } = require("../config/mailer");

// POST /auth/login
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

// POST /auth/register — (unchanged from before)
router.post(
  "/register",
  asyncHandler(async (req, res) => {
    const {
      companyName, dtiSecNo, doeLicenseNo, branchName, cityMunicipality,
      completeAddress, firstName, lastName, email, password,
    } = req.body;

    if (
      !companyName || !dtiSecNo || !branchName || !cityMunicipality ||
      !completeAddress || !firstName || !lastName || !email || !password
    ) {
      throw new ApiError(400, "All required fields must be filled in.");
    }

    const DTI_PATTERN = /^[A-Z]{2,4}\d{6,12}$/;
    const DOE_PATTERN = /^DOE-LPG-\d{4}-\d{3,4}$/;
    const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const NAME_PATTERN = /^[A-Za-z\u00F1\u00D1' .-]{2,50}$/;

    const dtiUpper = dtiSecNo.toUpperCase();
    if (!DTI_PATTERN.test(dtiUpper)) {
      throw new ApiError(400, "DTI/SEC registration number format is invalid. Expected format like CS202412345.");
    }
    if (doeLicenseNo && !DOE_PATTERN.test(doeLicenseNo.toUpperCase())) {
      throw new ApiError(400, "DOE distributor license number format is invalid. Expected format like DOE-LPG-2026-001.");
    }
    if (!EMAIL_PATTERN.test(email)) {
      throw new ApiError(400, "Please enter a valid email address.");
    }
    if (password.length < 8) {
      throw new ApiError(400, "Password must be at least 8 characters.");
    }
    if (!NAME_PATTERN.test(firstName) || !NAME_PATTERN.test(lastName)) {
      throw new ApiError(400, "First and last name may only contain letters, spaces, apostrophes, periods and hyphens.");
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [existingCompany] = await conn.query(
        `SELECT CompanyID FROM Company WHERE CompanyName = :name OR DTIRegNo = :dti`,
        { name: companyName, dti: dtiUpper }
      );
      if (existingCompany[0]) {
        throw new ApiError(409, "A company with this name or DTI/SEC registration number is already registered.");
      }

      const [existingUser] = await conn.query(`SELECT UserID FROM User WHERE Email = :email`, { email });
      if (existingUser[0]) {
        throw new ApiError(409, "An account with this email already exists.");
      }

      const fullAddress = `${completeAddress}, ${cityMunicipality}`;

      const [companyResult] = await conn.query(
        `INSERT INTO Company (CompanyName, DTIRegNo, DOENo, PrimaryBranch, Address)
         VALUES (:name, :dti, :doe, :branch, :address)`,
        { name: companyName, dti: dtiUpper, doe: doeLicenseNo ? doeLicenseNo.toUpperCase() : null, branch: branchName, address: fullAddress }
      );
      const companyId = companyResult.insertId;

      const [warehouseResult] = await conn.query(
        `INSERT INTO Warehouse (CompanyID, WarehouseName, Location) VALUES (:companyId, :name, :location)`,
        { companyId, name: branchName, location: fullAddress }
      );
      const warehouseId = warehouseResult.insertId;

      const [[adminRole]] = await conn.query(`SELECT RoleID FROM Role WHERE RoleName = 'Admin'`);
      if (!adminRole) throw new ApiError(500, "Admin role is not configured on this server.");

      const passwordHash = await bcrypt.hash(password, 10);
      const defaultModules = { dashboard: true, pos: true, inventory: true, products: true, suppliers: true, data: true };

      const [userResult] = await conn.query(
        `INSERT INTO User (CompanyID, RoleID, WarehouseID, FirstName, LastName, Email, PasswordHash, Status, ModuleAccess)
         VALUES (:companyId, :roleId, :warehouseId, :firstName, :lastName, :email, :passwordHash, 'Active', :modules)`,
        {
          companyId, roleId: adminRole.RoleID, warehouseId,
          firstName, lastName, email, passwordHash,
          modules: JSON.stringify(defaultModules),
        }
      );
      const userId = userResult.insertId;

      await conn.query(
        `INSERT INTO CompanySettings (CompanyID, FullName, Address, ContactEmail)
         VALUES (:companyId, :fullName, :address, :email)`,
        { companyId, fullName: companyName, address: fullAddress, email }
      );

      await conn.query(
        `INSERT INTO UserActivity (UserID, ActivityType, Module, Description)
         VALUES (:userId, 'Create', 'Auth', 'Company registered and admin account created')`,
        { userId }
      );

      await conn.commit();

      const token = jwt.sign(
        { userId, companyId, roleId: adminRole.RoleID, roleName: "Admin", email },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || "8h" }
      );

      res.status(201).json({
        token,
        user: { id: userId, firstName, lastName, email, role: "Admin", companyId },
      });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  })
);

// ---------------------------------------------------------------------------
// Password recovery
// ---------------------------------------------------------------------------

const RESET_TOKEN_TTL_MINUTES = 30;

function hashToken(rawToken) {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

// POST /auth/forgot-password  { email }
// Always responds with the same generic success message whether or not the
// email exists — this prevents attackers from using this endpoint to discover
// which emails are registered ("email enumeration").
router.post(
  "/forgot-password",
  asyncHandler(async (req, res) => {
    const { email } = req.body;
    if (!email) throw new ApiError(400, "Email is required.");

    const genericResponse = {
      message: "If an account exists for that email, a password reset link has been sent.",
    };

    const [rows] = await pool.query(
      `SELECT UserID, FirstName, Status FROM User WHERE Email = :email`,
      { email }
    );
    const user = rows[0];

    if (!user || user.Status !== "Active") {
      // Don't reveal whether the account exists — respond the same either way.
      return res.json(genericResponse);
    }

    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60 * 1000);

    // Invalidate any previous unused tokens for this user before issuing a new one.
    await pool.query(
      `UPDATE PasswordResetToken SET UsedAt = NOW() WHERE UserID = :userId AND UsedAt IS NULL`,
      { userId: user.UserID }
    );
    await pool.query(
      `INSERT INTO PasswordResetToken (UserID, TokenHash, ExpiresAt) VALUES (:userId, :tokenHash, :expiresAt)`,
      { userId: user.UserID, tokenHash, expiresAt }
    );

    const resetUrl = `${process.env.FRONTEND_URL || "http://localhost:5173"}${process.env.FRONTEND_BASE_PATH || ""}/#/reset-password?token=${rawToken}`;

    try {
      await sendMail({
        to: email,
        subject: "Reset your GasTrack password",
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
            <h2 style="color:#1e3a5f;">Reset your password</h2>
            <p>Hi ${user.FirstName || "there"},</p>
            <p>We received a request to reset your GasTrack password. Click the button below to choose a new one. This link expires in ${RESET_TOKEN_TTL_MINUTES} minutes.</p>
            <p style="text-align:center; margin: 28px 0;">
              <a href="${resetUrl}" style="background:#1e3a5f;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold;">Reset Password</a>
            </p>
            <p style="color:#6b7280; font-size:0.85rem;">If you didn't request this, you can safely ignore this email — your password will remain unchanged.</p>
            <p style="color:#9ca3af; font-size:0.75rem;">If the button doesn't work, copy and paste this link into your browser:<br>${resetUrl}</p>
          </div>
        `,
        text: `Reset your GasTrack password: ${resetUrl} (expires in ${RESET_TOKEN_TTL_MINUTES} minutes)`,
      });
    } catch (err) {
      console.error("Failed to send password reset email:", err);
      // Still return the generic success response — we don't want to leak
      // whether the email send failed vs. the account not existing, and a
      // transient SMTP outage shouldn't surface as a scary error to the user.
    }

    res.json(genericResponse);
  })
);

// GET /auth/reset-password/validate?token=...
// Lets the frontend check a token is still valid before showing the "new
// password" form, so the user isn't told "invalid" only after typing a new
// password.
router.get(
  "/reset-password/validate",
  asyncHandler(async (req, res) => {
    const { token } = req.query;
    if (!token) throw new ApiError(400, "Token is required.");

    const tokenHash = hashToken(token);
    const [rows] = await pool.query(
      `SELECT TokenID, ExpiresAt, UsedAt FROM PasswordResetToken WHERE TokenHash = :hash`,
      { hash: tokenHash }
    );
    const record = rows[0];

    if (!record || record.UsedAt || new Date(record.ExpiresAt) < new Date()) {
      return res.json({ valid: false });
    }
    res.json({ valid: true });
  })
);

// POST /auth/reset-password  { token, newPassword }
router.post(
  "/reset-password",
  asyncHandler(async (req, res) => {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) throw new ApiError(400, "Token and newPassword are required.");
    if (newPassword.length < 8) throw new ApiError(400, "Password must be at least 8 characters.");

    const tokenHash = hashToken(token);
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [rows] = await conn.query(
        `SELECT TokenID, UserID, ExpiresAt, UsedAt FROM PasswordResetToken WHERE TokenHash = :hash FOR UPDATE`,
        { hash: tokenHash }
      );
      const record = rows[0];

      if (!record || record.UsedAt || new Date(record.ExpiresAt) < new Date()) {
        throw new ApiError(400, "This reset link is invalid or has expired. Please request a new one.");
      }

      const passwordHash = await bcrypt.hash(newPassword, 10);
      await conn.query(`UPDATE User SET PasswordHash = :hash WHERE UserID = :id`, {
        hash: passwordHash,
        id: record.UserID,
      });
      await conn.query(`UPDATE PasswordResetToken SET UsedAt = NOW() WHERE TokenID = :id`, {
        id: record.TokenID,
      });
      await conn.query(
        `INSERT INTO UserActivity (UserID, ActivityType, Module, Description)
         VALUES (:userId, 'Update', 'Auth', 'Password reset via email link')`,
        { userId: record.UserID }
      );

      await conn.commit();
      res.json({ message: "Your password has been reset. You can now log in with your new password." });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
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