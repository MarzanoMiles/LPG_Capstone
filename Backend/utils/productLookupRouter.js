const routerFactory = require("express").Router;
const { randomUUID } = require("crypto");
const pool = require("../config/db");
const asyncHandler = require("./asyncHandler");
const ApiError = require("./apiError");
const { authenticate } = require("../middleware/auth");
module.exports = function productLookupRouter(table, column, prefix) {
  const router = routerFactory();
  router.use(authenticate);
  router.get("/", asyncHandler(async (req, res) => {
    const [rows] = await pool.query(`SELECT ${column} AS id, ${table} AS name FROM ${table} ORDER BY ${table}`);
    res.json(rows);
  }));
  const save = async (req, res, editing) => {
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    if (!name || name.length > 100) throw new ApiError(400, 'Name is required and must be at most 100 characters.');
    const id = editing ? req.params.id : `${prefix}-${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [result] = await conn.query(editing ? `UPDATE ${table} SET ${table} = :name WHERE ${column} = :id` : `INSERT INTO ${table} (${column}, ${table}) VALUES (:id, :name)`, {id, name});
      if (editing && !result.affectedRows) throw new ApiError(404, `${table} not found.`);
      await conn.commit(); res.status(editing ? 200 : 201).json({id, name});
    } catch (e) {
      await conn.rollback();
      if (e.code === 'ER_DUP_ENTRY') throw new ApiError(409, `${table} name already exists.`);
      throw e;
    } finally {conn.release();}
  };
  router.post('/', asyncHandler((req, res) => save(req, res, false)));
  router.put('/:id', asyncHandler((req, res) => save(req, res, true)));
  router.delete('/:id', asyncHandler(async (req, res) => {
    try {
      const [result] = await pool.query(`DELETE FROM ${table} WHERE ${column} = :id`, {id: req.params.id});
      if (!result.affectedRows) throw new ApiError(404, `${table} not found.`);
      res.json({message: `${table} deleted.`});
    } catch (e) {
      if (e.code === 'ER_ROW_IS_REFERENCED_2') throw new ApiError(409, `This ${table.toLowerCase()} is used by a product. Reassign its products before deleting it.`);
      throw e;
    }
  }));
  return router;
};
