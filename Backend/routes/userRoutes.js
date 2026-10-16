const router = require("express").Router();
const bcrypt = require("bcryptjs");
const pool = require("../config/db");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/apiError");
const { authenticate, authorize } = require("../middleware/auth");
const { nextUserId } = require("../utils/userIds");
const { mapActivityRow } = require("../utils/activityLog");
const { emptyModuleAccess, normalizeModuleAccess: parseModules } = require('../utils/moduleAccess');

router.use(authenticate);


const LIST_SELECT = `
  SELECT u.UserID AS id, CONCAT(u.FirstName, ' ', u.LastName) AS name, u.FirstName AS firstName,
         u.LastName AS lastName, u.Email AS email, r.RoleName AS role, r.RoleID AS roleId,
         w.WarehouseName AS branch, u.WarehouseID AS warehouseId, u.BranchID AS branchId, b.BranchName AS branchName,
         u.Status AS status, u.ModuleAccess AS moduleAccess, u.CreatedAt AS createdAt
  FROM User u
  JOIN Role r ON r.RoleID = u.RoleID
  LEFT JOIN Warehouse w ON w.WarehouseID = u.WarehouseID
  LEFT JOIN Branch b ON b.BranchID = u.BranchID
`;

function isAdministrator(req) {
  return ['admin', 'administrator'].includes(String(req.user.roleName || '').trim().toLowerCase());
}

function readModuleOverrides(req, defaults) {
  if (req.body.modules === undefined) return defaults;
  if (!isAdministrator(req)) throw new ApiError(403, 'Only administrators can change module access.');
  const modules = req.body.modules;
  const keys = Object.keys(emptyModuleAccess());
  if (!modules || Array.isArray(modules) || typeof modules !== 'object' ||
      Object.entries(modules).some(([key, value]) => !keys.includes(key) || typeof value !== 'boolean')) {
    throw new ApiError(400, 'Module access must contain known module names with boolean values.');
  }
  return {...defaults, ...modules};
}

async function validateAssignment(req, warehouseId) {
 const branchId = req.body.branchId || null;
 if (branchId) {
  const [rows] = await pool.query('SELECT BranchID FROM Branch WHERE BranchID=:branchId AND CompanyID=:companyId', {branchId,companyId:req.user.companyId});
  if (!rows.length) throw new ApiError(400,'Invalid branch.');
 }
 if (warehouseId) {
  const [rows] = await pool.query('SELECT BranchID FROM Warehouse WHERE WarehouseID=:warehouseId AND CompanyID=:companyId',{warehouseId,companyId:req.user.companyId});
  if (!rows.length || (rows[0].BranchID && rows[0].BranchID !== branchId)) throw new ApiError(400,'Warehouse does not belong to the selected branch.');
 }
 return branchId;
}

function readUserName(body) {
  if (body.firstName !== undefined || body.lastName !== undefined) {
    const firstName = typeof body.firstName === 'string' ? body.firstName.trim() : '';
    const lastName = typeof body.lastName === 'string' ? body.lastName.trim() : '';
    if (!firstName || !lastName || firstName.length > 50 || lastName.length > 50) {
      throw new ApiError(400, 'First name and last name are required and must each be at most 50 characters.');
    }
    return {firstName, lastName};
  }
  // Retain compatibility with existing API clients that send fullName.
  if (typeof body.fullName !== 'string' || !body.fullName.trim()) throw new ApiError(400, 'First name and last name are required.');
  const [firstName, ...rest] = body.fullName.trim().split(/\s+/);
  const lastName = rest.join(' ') || firstName;
  if (firstName.length > 50 || lastName.length > 50) throw new ApiError(400, 'Names must each be at most 50 characters.');
  return {firstName, lastName};
}

// GET /users?search=&role=&status=&branch=
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { search, role, status, branch } = req.query;
    let sql = LIST_SELECT + ` WHERE u.CompanyID = :companyId`;
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
      if (target.Status !== status) changes.push(`Changed status from ${target.Status} to ${status}`);
    }
    if (branch) {
      sql += ` AND w.WarehouseName = :branch`;
      params.branch = branch;
    }
    sql += ` ORDER BY u.UserID DESC`;
    const [rows] = await pool.query(sql, params);
    res.json(rows.map((r) => ({ ...r, moduleAccess: parseModules(r.moduleAccess) })));
  })
);

// GET /users/activity-log  -- must come before /:id so it isn't swallowed by the param route
router.get(
  "/activity-log",
  authorize("Admin", "Manager"),
  asyncHandler(async (req, res) => {
    const { search, role, status, module, action } = req.query;
    const requestedPage = Math.max(1, Math.trunc(Number(req.query.page)) || 1);
    const pageSize = Math.max(1, Math.min(100, Math.trunc(Number(req.query.pageSize)) || 7));

    let whereClause = `
      WHERE a.CompanyID = :companyId`;

    const params = { companyId: req.user.companyId };
    if (search) {
      whereClause += ` AND (a.ActorName LIKE :s OR a.UserID LIKE :s OR a.RecordID LIKE :s OR a.Module LIKE :s OR a.ActivityType LIKE :s OR a.Description LIKE :s)`;
      params.s = `%${search}%`;
    }
    if (role) {
      whereClause += ` AND a.ActorRole = :role`;
      params.role = role;
    }
    if (status) {
      whereClause += ` AND u.Status = :status`;
      params.status = status;
      if (target.Status !== status) changes.push(`Changed status from ${target.Status} to ${status}`);
    }

    if (module) { whereClause += ` AND a.Module = :module`; params.module = module; }
    if (action) { whereClause += ` AND a.ActivityType = :action`; params.action = action; }
    const [countRows] = await pool.query(
      `SELECT COUNT(*) AS total
       FROM UserActivity a
       LEFT JOIN User u ON u.UserID = a.UserID
       LEFT JOIN Role r ON r.RoleID = u.RoleID
       ${whereClause}`,
      params
    );
    const total = Number(countRows[0]?.total || 0);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(requestedPage, totalPages);
    const offset = (page - 1) * pageSize;

    const sql = `
      SELECT a.UserActivityID AS id, a.UserID AS userId, a.ActorName AS name,
             a.ActorRole AS role, u.Status AS status, a.Module AS module, a.ActivityType AS action,
             a.RecordID AS targetId, a.Outcome AS outcome, a.Description AS description, UNIX_TIMESTAMP(a.ActivityDate) AS datetime
      FROM UserActivity a
      LEFT JOIN User u ON u.UserID = a.UserID
      LEFT JOIN Role r ON r.RoleID = u.RoleID
      ${whereClause}
      ORDER BY a.ActivityDate DESC, a.UserActivityID DESC
      LIMIT :limit OFFSET :offset`;

    params.limit = pageSize;
    params.offset = offset;
    const [rows] = await pool.query(sql, params);

    res.json({
      rows: rows.map((row) => mapActivityRow(row, "datetime")),
      total,
      page,
      pageSize,
    });
  })
);

// GET /users/:id
router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(LIST_SELECT + ` WHERE u.UserID = :id AND u.CompanyID = :companyId`, { id: req.params.id, companyId: req.user.companyId });
    if (!rows[0]) throw new ApiError(404, "User not found.");
    res.json({ ...rows[0], moduleAccess: parseModules(rows[0].moduleAccess) });
  })
);

router.post(
  "/",
  authorize("Admin", "Manager"),
  asyncHandler(async (req, res) => {
    const { usernameEmail, password, role, branch, status } = req.body;
    const moduleAccess = readModuleOverrides(req, emptyModuleAccess());
    if (!usernameEmail || !password || !role) {
      throw new ApiError(400, "Email, password and role are required.");
    }

    const [roleRows] = await pool.query(`SELECT RoleID FROM Role WHERE RoleName = :role`, { role });
    if (!roleRows[0]) throw new ApiError(400, "Invalid role.");
    if (!isAdministrator(req) && ['admin','administrator'].includes(String(role).trim().toLowerCase())) throw new ApiError(403, 'Only administrators can create administrator accounts.');

    let warehouseId = null;
    if (branch) {
      const [whRows] = await pool.query(`SELECT WarehouseID FROM Warehouse WHERE WarehouseName = :branch AND CompanyID = :companyId`, {
        branch, companyId: req.user.companyId,
      });
      if (!whRows[0]) throw new ApiError(400, "Invalid branch/warehouse.");
      warehouseId = whRows[0].WarehouseID;
    }

    const branchId = await validateAssignment(req, warehouseId);
    const [existing] = await pool.query(`SELECT UserID FROM User WHERE Email = :email`, {
      email: usernameEmail,
    });
    if (existing[0]) throw new ApiError(409, "A user with this email already exists.");

    const { firstName, lastName } = readUserName(req.body);
    const passwordHash = await bcrypt.hash(password, 10);

    const conn = await pool.getConnection();
    let userId;
    try {
    await conn.beginTransaction();
    userId = await nextUserId(conn);

    await conn.query(
      `INSERT INTO User (UserID, CompanyID, RoleID, WarehouseID, BranchID, FirstName, LastName, Email, PasswordHash, Status, ModuleAccess)
       VALUES (:userId, :companyId, :roleId, :warehouseId, :branchId, :firstName, :lastName, :email, :passwordHash, :status, :modules)`,
      {
        userId,
        companyId: req.user.companyId,
        roleId: roleRows[0].RoleID,
        warehouseId,
        branchId,
        firstName,
        lastName,
        email: usernameEmail,
        passwordHash,
        status: status || "Active",
        modules: JSON.stringify(moduleAccess),
      }
    );

    const userActivityId = await require('../utils/entityIds').nextEntityId(conn, 'UserActivity');
    await conn.query(
      `INSERT INTO UserActivity (UserActivityID, UserID, ActivityType, Module, RecordID, Description)
       VALUES (:userActivityId, :userId, 'Create', 'Users — User Management', :recordId, 'Created a new user')`,
      { userActivityId, userId: req.user.userId, recordId: userId }
    );

    await conn.commit();
    } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
    res.status(201).json({ id: userId });
  })
);

router.put(
  "/:id",
  authorize("Admin", "Manager"),
  asyncHandler(async (req, res) => {
    const conn = await pool.getConnection();
    try {
    await conn.beginTransaction();
    const { status, role, branch, password } = req.body;
    const params = { id: req.params.id, companyId: req.user.companyId };
    const sets = [];
    const [targets] = await conn.query(`SELECT u.*,r.RoleName FROM User u JOIN Role r ON r.RoleID=u.RoleID WHERE u.UserID=:id AND u.CompanyID=:companyId FOR UPDATE`, params);
    const target = targets[0];
    if (!target) throw new ApiError(404, 'User not found.');
    if (!isAdministrator(req) && ['admin','administrator'].includes(String(target.RoleName).trim().toLowerCase())) throw new ApiError(403, 'Only administrators can modify administrator accounts.');
    const changes = [];


    if (req.body.firstName !== undefined || req.body.lastName !== undefined || req.body.fullName !== undefined) {
      const { firstName, lastName } = readUserName(req.body);
      sets.push(`FirstName = :firstName`, `LastName = :lastName`);
      params.firstName = firstName;
      params.lastName = lastName;
      if (target.FirstName !== firstName || target.LastName !== lastName) changes.push(`Changed name from ${target.FirstName} ${target.LastName} to ${firstName} ${lastName}`);
    }
    if (status) {
      sets.push(`Status = :status`);
      params.status = status;
      if (target.Status !== status) changes.push(`Changed status from ${target.Status} to ${status}`);
    }
    if (role) {
      const [roleRows] = await conn.query(`SELECT RoleID FROM Role WHERE RoleName = :role`, { role });
      if (!roleRows[0]) throw new ApiError(400, "Invalid role.");
      sets.push(`RoleID = :roleId`);
      params.roleId = roleRows[0].RoleID;
      if (target.RoleName !== role) changes.push(`Changed role from ${target.RoleName} to ${role}`);
    }
    if (branch !== undefined) {
      if (branch) {
        const [whRows] = await conn.query(`SELECT WarehouseID FROM Warehouse WHERE WarehouseName = :branch AND CompanyID = :companyId`, {
          branch, companyId: req.user.companyId,
        });
        if (!whRows[0]) throw new ApiError(400, "Invalid branch/warehouse.");
        sets.push(`WarehouseID = :warehouseId`);
        params.warehouseId = whRows[0].WarehouseID;
      } else {
        sets.push(`WarehouseID = NULL`);
      }
    }
    if (role || req.body.modules !== undefined) {
      const [currentRoles] = await conn.query(`SELECT r.RoleName, u.ModuleAccess FROM User u JOIN Role r ON r.RoleID=u.RoleID WHERE u.UserID=:id AND u.CompanyID=:companyId FOR UPDATE`, params);
      if (!currentRoles[0]) throw new ApiError(404, 'User not found.');
      const roleChanged = role && role !== currentRoles[0].RoleName;
      if (roleChanged && !isAdministrator(req)) throw new ApiError(403, 'Only administrators can change roles and module access.');
      if (req.body.modules !== undefined) {
        const defaults = { ...emptyModuleAccess(), ...parseModules(currentRoles[0].ModuleAccess) };
        params.modules = JSON.stringify(readModuleOverrides(req, defaults));
        sets.push('ModuleAccess = :modules');
        const nextModules = JSON.parse(params.modules);
        for (const key of Object.keys(nextModules)) if (defaults[key] !== nextModules[key]) changes.push(`${nextModules[key] ? 'Enabled' : 'Disabled'} ${({pos:'POS Terminal',orders:'Order and Delivery',report:'Report and Compliance',data:'Data',restocking:'Restocking'})[key] || key.charAt(0).toUpperCase()+key.slice(1)} access`);
      }
    }
    if (req.body.branchId !== undefined || branch !== undefined) {
      const [current] = await conn.query("SELECT WarehouseID FROM User WHERE UserID=:id AND CompanyID=:companyId", params);
      if (!current[0]) throw new ApiError(404, "User not found.");
      params.branchId = await validateAssignment(req, branch !== undefined ? params.warehouseId || null : current[0].WarehouseID);
      sets.push("BranchID = :branchId");
      if (target.BranchID !== params.branchId) changes.push('Changed branch assignment');
      if (branch !== undefined && target.WarehouseID !== (params.warehouseId || null)) changes.push('Changed warehouse assignment');
    }
    if (password) {
      sets.push(`PasswordHash = :passwordHash`);
      params.passwordHash = await bcrypt.hash(password, 10);
      changes.push('Changed password');
    }
    if (!sets.length) throw new ApiError(400, "No fields provided to update.");

    const [result] = await conn.query(`UPDATE User SET ${sets.join(", ")} WHERE UserID = :id AND CompanyID = :companyId`, params);
    if (!result.affectedRows) throw new ApiError(404, "User not found.");

    if (changes.length) {
    const userActivityId = await require('../utils/entityIds').nextEntityId(conn, 'UserActivity');
    await conn.query(
      `INSERT INTO UserActivity (UserActivityID, UserID, ActivityType, Module, RecordID, Description)
       VALUES (:userActivityId, :userId, 'Update', 'Users — User Management', :recordId, :description)`,
      { userActivityId, userId: req.user.userId, recordId: req.params.id, description: `Updated user ${target.FirstName} ${target.LastName}. ${changes.length ? changes.join('. ')+'.' : 'Saved user details.'}`.slice(0,500) }
    );
    }

    await conn.commit();
    } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
    res.json({ message: "User updated." });
  })
);

// DELETE /users/:id — soft delete: users are referenced by Sales, InventoryTransaction, UserActivity, etc.
router.delete(
  "/:id",
  authorize("Admin", "Manager"),
  asyncHandler(async (req, res) => {
    const conn = await pool.getConnection();
    try {
    await conn.beginTransaction();
    if (String(req.params.id) === String(req.user.userId)) {
      throw new ApiError(400, "You cannot deactivate your own account.");
    }
    const [targets] = await conn.query(`SELECT u.FirstName,u.LastName,u.Status,r.RoleName FROM User u JOIN Role r ON r.RoleID=u.RoleID WHERE u.UserID=:id AND u.CompanyID=:companyId FOR UPDATE`, {id:req.params.id,companyId:req.user.companyId});
    const target = targets[0];
    if (!target) throw new ApiError(404, 'User not found.');
    if (!isAdministrator(req) && ['admin','administrator'].includes(String(target.RoleName).trim().toLowerCase())) throw new ApiError(403, 'Only administrators can deactivate administrator accounts.');
    const [result] = await conn.query(`UPDATE User SET Status = 'Inactive' WHERE UserID = :id AND CompanyID = :companyId`, {
      id: req.params.id, companyId: req.user.companyId,
    });
    if (!result.affectedRows) throw new ApiError(404, "User not found.");

    if (target.Status !== 'Inactive') {
    const userActivityId = await require('../utils/entityIds').nextEntityId(conn, 'UserActivity');
    await conn.query(
      `INSERT INTO UserActivity (UserActivityID, UserID, ActivityType, Module, RecordID, Description)
       VALUES (:userActivityId, :userId, 'Delete', 'Users — User Management', :recordId, :description)`,
      { userActivityId, userId: req.user.userId, recordId: req.params.id, description:`Deactivated user ${target.FirstName} ${target.LastName}.` }
    );
    }

    await conn.commit();
    } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
    res.json({ message: "User deactivated." });
  })
);

module.exports = router;

