const assert = require('node:assert/strict');
const pool = require('../config/db');
async function verify() {
 const conn = await pool.getConnection();
 try {
  await conn.beginTransaction();
  const [[product]] = await conn.query('SELECT ProductID FROM Product LIMIT 1');
  assert.ok(product);
  const id = product.ProductID;
  const [[before]] = await conn.query('SELECT COUNT(*) AS n FROM InventoryTransaction t JOIN Inventory i ON i.InventoryID = t.InventoryID JOIN ProductHistory p ON p.ProductID = i.ProductID');
  await conn.query("UPDATE Product SET Unit = 'kg', UnitValue = '11.5' WHERE ProductID = :id", {id});
  const [[saved]] = await conn.query('SELECT Unit, UnitValue FROM ProductHistory WHERE ProductID = :id', {id});
  assert.equal(saved.Unit, 'kg'); assert.equal(Number(saved.UnitValue), 11.5);
  await conn.query('DELETE FROM Product WHERE ProductID = :id', {id});
  const [catalog] = await conn.query('SELECT ProductID FROM Product WHERE ProductID = :id', {id});
  const [history] = await conn.query('SELECT ProductName FROM ProductHistory WHERE ProductID = :id', {id});
  assert.equal(catalog.length, 0); assert.equal(history.length, 1);
  const [[after]] = await conn.query('SELECT COUNT(*) AS n FROM InventoryTransaction t JOIN Inventory i ON i.InventoryID = t.InventoryID JOIN ProductHistory p ON p.ProductID = i.ProductID');
  assert.equal(after.n, before.n);
  console.log('PASS: decimal/unit persistence, physical catalog deletion, preserved transaction history. Verification changes rolled back.');
 } finally { await conn.rollback(); conn.release(); }
}
verify().catch(e => {console.error(e); process.exitCode = 1;}).finally(() => pool.end());
