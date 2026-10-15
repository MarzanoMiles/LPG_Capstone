// Run from Backend: node db/migrate_supplier_ids.js
const pool = require('../config/db');
const quote = value => '`' + value.replace(/`/g, '``') + '`';

async function migrate() {
  const conn = await pool.getConnection();
  try {
    const [[lock]] = await conn.query("SELECT GET_LOCK('gastrack_supplier_ids', 10) AS acquired");
    if (Number(lock.acquired) !== 1) throw new Error('Supplier ID allocation busy. Retry migration.');
    await conn.beginTransaction();
    const [suppliers] = await conn.query('SELECT * FROM Supplier ORDER BY SupplierID FOR UPDATE');
    const used = new Set(suppliers.map(row => row.SupplierID));
    let next = Math.max(0, ...suppliers.map(row => /^SUP-\d+$/.test(row.SupplierID) ? Number(row.SupplierID.slice(4)) : 0));
    // Include snapshots/history tables as well as declared foreign keys.
    const [references] = await conn.query("SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME = 'SupplierID' AND TABLE_NAME <> 'Supplier'");
    const columns = Object.keys(suppliers[0] || {});
    let changed = 0;
    for (const supplier of suppliers) {
      const oldId = supplier.SupplierID;
      if (/^SUP-\d{3,}$/.test(oldId)) continue;
      const suffix = String(oldId).match(/^(?:SP-|SUP-)?(\d+)$/);
      let id = suffix ? `SUP-${suffix[1].padStart(3, '0')}` : null;
      if (!id || used.has(id)) {
        do { id = `SUP-${String(++next).padStart(3, '0')}`; } while (used.has(id));
      }
      used.add(id);
      next = Math.max(next, Number(id.slice(4)));
      // Create the new parent first so FK checks remain enabled throughout.
      await conn.query(`INSERT INTO Supplier (${columns.map(quote).join(', ')}) VALUES (${columns.map((_, i) => ':v' + i).join(', ')})`, Object.fromEntries(columns.map((column, i) => ['v' + i, column === 'SupplierID' ? id : supplier[column]])));
      for (const ref of references) {
        await conn.query(`UPDATE ${quote(ref.TABLE_NAME)} SET ${quote(ref.COLUMN_NAME)} = :id WHERE ${quote(ref.COLUMN_NAME)} = :oldId`, { id, oldId });
      }
      await conn.query('DELETE FROM Supplier WHERE SupplierID = :oldId', { oldId });
      changed++;
    }
    await conn.commit();
    console.log(`Converted ${changed} supplier IDs to SUP format; linked references preserved.`);
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    try { await conn.query("SELECT RELEASE_LOCK('gastrack_supplier_ids')"); }
    finally { conn.release(); }
  }
}
if (require.main === module) migrate().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => pool.end());
module.exports = migrate;
