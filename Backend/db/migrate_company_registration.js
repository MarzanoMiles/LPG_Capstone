const pool = require('../config/db');

async function migrate() {
  try {
    const legacyColumns = new Set(['dtiregno', 'doeno', 'citymunicipality']);
    const [columns] = await pool.query('SHOW COLUMNS FROM Company');
    const removed = columns.filter(column => legacyColumns.has(column.Field.toLowerCase()));
    if (removed.length) {
      await pool.query(`ALTER TABLE Company ${removed.map(column =>
        `DROP COLUMN \`${column.Field}\``).join(', ')}`);
    }
    const [remaining] = await pool.query('SHOW COLUMNS FROM Company');
    if (remaining.some(column => legacyColumns.has(column.Field.toLowerCase()))) {
      throw new Error('Legacy company registration columns still exist.');
    }
    console.log('Company registration migration complete: legacy license and city/municipality columns are absent.');
  } finally {
    await pool.end();
  }
}

migrate().catch(err => {
  console.error('Company registration migration failed:', err.code || err.message);
  process.exitCode = 1;
});
