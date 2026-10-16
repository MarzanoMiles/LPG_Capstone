const router = require('express').Router();
const pool = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/apiError');
const { authenticate, authorize } = require('../middleware/auth');
const { nextEntityId } = require('../utils/entityIds');
const { logUserActivity } = require('../utils/activityLogger');

// These names define permissions in the existing RBAC implementation.
const systemRoles = new Set(['admin', 'administrator', 'manager', 'operations supervisor',
  'assistant operations supervisor', 'store supervisor', 'assistant store supervisor',
  'stockman', 'head maintenance', 'driver', 'drivers', 'helper', 'helpers', 'customer']);
const configs = {
  roles: { table: 'Role', key: 'RoleID', prefix: 'RL', module: 'Role Settings', fields: { name: 'RoleName' } },
  branches: { table: 'Branch', key: 'BranchID', prefix: 'BRH', module: 'Branch Settings', fields: { name: 'BranchName', address: 'Address', contact: 'ContactNo' } },
  warehouses: { table: 'Warehouse', key: 'WarehouseID', prefix: 'WH', module: 'Warehouse Settings', fields: { name: 'WarehouseName', location: 'Location', branchId: 'BranchID' } },
};
const quote = value => '`' + value.replace(/`/g, '``') + '`';

router.use(authenticate);
router.param('kind', (req, res, next, kind) => {
  req.config = Object.hasOwn(configs, kind) ? configs[kind] : null;
  next(req.config ? undefined : new ApiError(404, 'Unknown settings.'));
});
router.get('/:kind', asyncHandler(async (req, res) => {
  const c = req.config;
  const [rows] = await pool.query(
    `SELECT ${c.key} AS id, ${Object.entries(c.fields).map(([alias, column]) => `${column} AS ${alias}`).join(', ')}
     FROM ${c.table}${c.table === 'Role' ? '' : ' WHERE CompanyID = :companyId'}`,
    { companyId: req.user.companyId }
  );
  res.json(rows);
}));

router.use(authorize('Admin'));
router.all('/:kind/:id?', asyncHandler(async (req, res) => {
  if (!['POST', 'PUT', 'DELETE'].includes(req.method)) throw new ApiError(405, 'Method not allowed.');
  if (req.method !== 'POST' && !req.params.id) throw new ApiError(400, 'Record ID is required.');
  if (req.method === 'POST' && req.params.id) throw new ApiError(400, 'Create records through the collection endpoint.');
  const c = req.config;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    let originalName;
    let originalRecord;
    const params = { id: req.params.id || await nextEntityId(conn, c.table), companyId: req.user.companyId };
    // Serialize name checks within a company; Role also has a database unique constraint.
    await conn.query('SELECT CompanyID FROM Company WHERE CompanyID = :companyId FOR UPDATE', params);
    if (req.params.id) {
      const [rows] = await conn.query(
        `SELECT * FROM ${c.table} WHERE ${c.key} = :id${c.table === 'Role' ? '' : ' AND CompanyID = :companyId'} FOR UPDATE`, params
      );
      if (!rows[0]) throw new ApiError(404, 'Record not found.');
      originalName = rows[0][c.fields.name];
      originalRecord = rows[0];
      if (c.table === 'Role' && systemRoles.has(originalName.toLowerCase())) {
        throw new ApiError(409, 'System roles cannot be renamed or deleted because permissions depend on them.');
      }
    }
    if (req.method === 'DELETE') {
      const [refs] = await conn.query(
        `SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE
         WHERE REFERENCED_TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME = :table`, { table: c.table }
      );
      for (const ref of refs) {
        const [used] = await conn.query(`SELECT 1 FROM ${quote(ref.TABLE_NAME)} WHERE ${quote(ref.COLUMN_NAME)} = :id LIMIT 1`, params);
        if (used.length) throw new ApiError(409, 'Record is assigned to users or operational records.');
      }
      await conn.query(`DELETE FROM ${c.table} WHERE ${c.key} = :id`, params);
    } else {
      for (const alias of Object.keys(c.fields)) {
        if (req.body[alias] != null && typeof req.body[alias] !== 'string') throw new ApiError(400, 'Settings fields must be text.');
        params[alias] = String(req.body[alias] || '').trim() || null;
      }
      if (!params.name || params.name.length > (c.table === 'Role' ? 50 : 100)) throw new ApiError(400, 'A valid name is required.');
      if ((c.table === 'Branch' && !params.address) || (c.table === 'Warehouse' && !params.location)) throw new ApiError(400, 'Address/location is required.');
      if (params.address?.length > 255 || params.location?.length > 255 || params.contact?.length > 30) throw new ApiError(400, 'Settings field is too long.');
      if (c.table === 'Role' && systemRoles.has(params.name.toLowerCase())) throw new ApiError(409, 'Reserved system role name.');
      if (c.table === 'Warehouse') {
        if (params.branchId) {
          const [branches] = await conn.query('SELECT BranchID FROM Branch WHERE BranchID = :branchId AND CompanyID = :companyId', params);
          if (!branches.length) throw new ApiError(400, 'Invalid branch.');
        }
        if (params.branchId && req.params.id) {
          const [users] = await conn.query('SELECT UserID FROM User WHERE WarehouseID = :id AND NOT (BranchID <=> :branchId) LIMIT 1', params);
          if (users.length) throw new ApiError(409, 'Reassign users to this branch before changing the warehouse branch.');
        }
      }
      const [duplicates] = await conn.query(
        `SELECT ${c.key} FROM ${c.table} WHERE LOWER(${c.fields.name}) = LOWER(:name) AND ${c.key} <> :id${c.table === 'Role' ? '' : ' AND CompanyID = :companyId'}`, params
      );
      if (duplicates.length) throw new ApiError(409, 'Name already exists.');
      if (originalRecord && Object.entries(c.fields).every(([alias,column]) => (originalRecord[column] || null) === params[alias])) {
        await conn.commit();
        return res.json({id:params.id,message:'No changes to save.'});
      }
      if (req.method === 'POST') {
        await conn.query(
          `INSERT INTO ${c.table} (${c.key}, ${Object.values(c.fields).join(', ')}${c.table === 'Role' ? '' : ', CompanyID'})
           VALUES (:id, ${Object.keys(c.fields).map(key => ':' + key).join(', ')}${c.table === 'Role' ? '' : ', :companyId'})`, params
        );
      } else {
        await conn.query(`UPDATE ${c.table} SET ${Object.entries(c.fields).map(([alias, column]) => `${column} = :${alias}`).join(', ')} WHERE ${c.key} = :id`, params);
      }
    }
    const action = req.method === 'DELETE' ? 'Delete' : req.method === 'POST' ? 'Create' : 'Update';
    const label = {roles:'role',branches:'branch',warehouses:'warehouse'}[req.params.kind];
    const description = originalName && params.name && originalName !== params.name
      ? `Renamed ${label} from ${originalName} to ${params.name}.`
      : `${action === 'Create' ? 'Created' : action === 'Delete' ? 'Deleted' : 'Updated'} ${label} ${originalName || params.name}.`;
    await logUserActivity({ userId: req.user.userId, activityType: action, module: c.module, recordId: params.id, description }, conn);
    await conn.commit();
    res.locals.auditWritten = true;
    res.status(req.method === 'POST' ? 201 : 200).json({ id: params.id, message: 'Settings saved.' });
  } catch (error) {
    await conn.rollback();
    if (['ER_ROW_IS_REFERENCED_2', 'ER_DUP_ENTRY'].includes(error.code)) throw new ApiError(409, 'Record is in use or name already exists.');
    throw error;
  } finally {
    conn.release();
  }
}));
module.exports = router;
