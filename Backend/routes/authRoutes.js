const router = require("express").Router();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("../config/db");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/apiError");
const { authenticate } = require("../middleware/auth");

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

// POST /auth/register — self-service company + first admin account signup.
// Creates: Company, its primary Warehouse (branch), the Admin User, and a starter
// CompanySettings row, all in one transaction. Returns a token so the caller can
// be logged in immediately, same shape as /auth/login.
router.post(
  "/register",
  asyncHandler(async (req, res) => {
    const {
      companyName,
      dtiSecNo,
      doeLicenseNo,
      branchName,
      cityMunicipality,
      completeAddress,
      firstName,
      lastName,
      email,
      password,
    } = req.body;

    if (
      !companyName || !dtiSecNo || !branchName || !cityMunicipality ||
      !completeAddress || !firstName || !lastName || !email || !password
    ) {
      throw new ApiError(400, "All required fields must be filled in.");
    }

    // Server-side format validation — mirrors the frontend's guards, since the
    // frontend can always be bypassed. This is the actual source of truth.
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