// Human-readable reference numbers: PREFIX-YEAR-000123
async function nextSequence(pool, table, column, prefix) {
  const year = new Date().getFullYear();
  const [rows] = await pool.query(
    `SELECT ${column} AS code FROM ${table} WHERE ${column} LIKE :pattern ORDER BY ${column} DESC LIMIT 1`,
    { pattern: `${prefix}-${year}-%` }
  );
  let next = 1;
  if (rows.length) {
    const last = rows[0].code.split("-").pop();
    next = parseInt(last, 10) + 1;
  }
  return `${prefix}-${year}-${String(next).padStart(3, "0")}`;
}

module.exports = { nextSequence };