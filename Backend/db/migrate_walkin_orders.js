// Run from Backend: node db/migrate_walkin_orders.js
const pool = require('../config/db');
const { resolveWalkInCustomer } = require('../utils/walkInCustomer');
const { fields } = require('../utils/customerHistory');

async function migrate() {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const id = await resolveWalkInCustomer(conn);
    const originals = ['CustomerID', 'CustomerName', 'ContactNo', 'Address', 'CustomerType'];
    const snapshot = alias => fields.map((field, i) => `${alias}.${field}=c.${originals[i]}`).join(', ');
    const [orders] = await conn.query(`UPDATE \`Order\` o JOIN Customer c ON c.CustomerID=:id
      SET o.CustomerID=:id, ${snapshot('o')} WHERE o.OrderType='Walk-in'`, { id });
    await conn.query(`UPDATE Sales s JOIN \`Order\` o ON o.OrderID=s.OrderID JOIN Customer c ON c.CustomerID=:id
      SET s.CustomerID=:id, ${snapshot('s')} WHERE o.OrderType='Walk-in'`, { id });
    for (const table of ['Payment', 'Delivery']) {
      await conn.query(`UPDATE \`${table}\` t JOIN Sales s ON s.SaleID=t.SaleID
        JOIN \`Order\` o ON o.OrderID=s.OrderID JOIN Customer c ON c.CustomerID=:id
        SET ${snapshot('t')} WHERE o.OrderType='Walk-in'`, { id });
    }
    await conn.commit();
    console.log(`Normalized ${orders.affectedRows} walk-in orders and linked customer snapshots to ${id}.`);
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally { conn.release(); }
}
if (require.main === module) migrate().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => pool.end());
module.exports = migrate;
