const pool = require('../config/db');

async function migrate() {
  try {
    const [columns] = await pool.query('SHOW COLUMNS FROM CompanySettings');
    const names = new Set(columns.map(column => column.Field));
    const changes = ['Branch', 'Warehouse', 'Brand'].filter(name => names.has(name))
      .map(name => `DROP COLUMN \`${name}\``);
    if (names.has('FullName') && !names.has('CompanyName')) {
      changes.push('CHANGE COLUMN FullName CompanyName VARCHAR(150) NULL');
    }
    if (changes.length) await pool.query(`ALTER TABLE CompanySettings ${changes.join(', ')}`);
    const [remaining] = await pool.query('SHOW COLUMNS FROM CompanySettings');
    if (!remaining.some(column => column.Field === 'CompanyName') ||
        remaining.some(column => ['Branch', 'Warehouse', 'Brand', 'FullName'].includes(column.Field))) {
      throw new Error('Company profile schema verification failed.');
    }
    console.log('Company profile migration complete: CompanyName available; unused columns removed.');
  } finally {
    await pool.end();
  }
}

migrate().catch(err => {
  console.error('Company profile migration failed:', err.code || err.message);
  process.exitCode = 1;
});
