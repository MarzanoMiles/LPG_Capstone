// Run from Backend: node db/migrate_product_history.js
const pool = require('../config/db');
async function migrate() {
  const conn = await pool.getConnection();
  try {
    await conn.query('CREATE TABLE IF NOT EXISTS ProductHistory LIKE Product');
    const [columns] = await conn.query('SHOW COLUMNS FROM Product');
    const names = columns.map(c => c.Field);
    const quoted = names.map(n => `\`${n}\``).join(', ');
    const assignments = names.filter(n => n !== 'ProductID').map(n => `\`${n}\` = NEW.\`${n}\``).join(', ');
    for (const event of ['INSERT', 'UPDATE']) {
      const trigger = `product_history_${event.toLowerCase()}`;
      const [found] = await conn.query('SELECT TRIGGER_NAME FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE() AND TRIGGER_NAME = :trigger', {trigger});
      if (!found.length) await conn.query(`CREATE TRIGGER ${trigger} AFTER ${event} ON Product FOR EACH ROW INSERT INTO ProductHistory (${quoted}) VALUES (${names.map(n => `NEW.\`${n}\``).join(', ')}) ON DUPLICATE KEY UPDATE ${assignments}`);
    }
    await conn.query(`INSERT IGNORE INTO ProductHistory (${quoted}) SELECT ${quoted} FROM Product`);
    const [fks] = await conn.query(`SELECT TABLE_NAME, COLUMN_NAME, CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE REFERENCED_TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME = 'Product'`);
    for (const fk of fks) {
      const quote = value => '`' + value.replace(/`/g, '``') + '`';
      await conn.query(`ALTER TABLE ${quote(fk.TABLE_NAME)} DROP FOREIGN KEY ${quote(fk.CONSTRAINT_NAME)}, ADD CONSTRAINT ${quote("ph_" + fk.TABLE_NAME + "_" + fk.COLUMN_NAME)} FOREIGN KEY (${quote(fk.COLUMN_NAME)}) REFERENCES ProductHistory(ProductID)`);
    }
    console.log('ProductHistory ready; transaction references preserved.');
  } finally {conn.release();}
}
if (require.main === module) migrate().catch(e => {console.error(e.message); process.exitCode = 1;}).finally(() => pool.end());
module.exports = migrate;

