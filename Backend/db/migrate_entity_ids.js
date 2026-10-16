// Run with application writers stopped: npm run migrate:entity-ids
const pool = require('../config/db');
const {entities, quote} = require('../utils/entityIds');

async function migrate() {
  const conn = await pool.getConnection();
  let auditTrigger;
  try {
    const [triggers] = await conn.query('SHOW TRIGGERS');
    auditTrigger = triggers.find(t => t.Trigger === 'audit_no_update');
    if (auditTrigger) {
      await conn.query('DROP TRIGGER audit_no_update');
      await conn.query("CREATE TRIGGER audit_no_update BEFORE UPDATE ON UserActivity FOR EACH ROW BEGIN IF COALESCE(@entity_id_migration,0) <> 1 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Audit records are immutable'; END IF; END");
      await conn.query('SET @entity_id_migration=1');
    }
    await conn.query('CREATE TABLE IF NOT EXISTS EntityIdSequence (Entity VARCHAR(64) PRIMARY KEY, NextValue BIGINT UNSIGNED NOT NULL)');
    const [columns] = await conn.query('SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()');
    const [foreignKeys] = await conn.query('SELECT TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL');
    // InnoDB rolls back every ID and reference update together on any failure.
    const [tables] = await conn.query('SELECT TABLE_NAME, ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE=\'BASE TABLE\'');
    if (tables.some(t => t.ENGINE !== 'InnoDB')) throw new Error('ID migration requires all tables to use InnoDB.');
    await conn.beginTransaction();
    const orphanCount = async fk => {
      const [[row]] = await conn.query(`SELECT COUNT(*) AS n FROM ${quote(fk.TABLE_NAME)} c LEFT JOIN ${quote(fk.REFERENCED_TABLE_NAME)} p ON c.${quote(fk.COLUMN_NAME)}=p.${quote(fk.REFERENCED_COLUMN_NAME)} WHERE c.${quote(fk.COLUMN_NAME)} IS NOT NULL AND p.${quote(fk.REFERENCED_COLUMN_NAME)} IS NULL`);
      return Number(row.n);
    };
    const before = [];
    for (const fk of foreignKeys) before.push(await orphanCount(fk));
    await conn.query('SET FOREIGN_KEY_CHECKS=0');
    for (const [table, [key,prefix]] of Object.entries(entities)) {
      if (!tables.some(t => t.TABLE_NAME.toLowerCase() === table.toLowerCase())) continue;
      const refs = columns.filter(c => c.COLUMN_NAME.toLowerCase() === key.toLowerCase() || (key === 'CustomerID' && c.COLUMN_NAME === 'historical_customer_id') || foreignKeys.some(f => f.TABLE_NAME === c.TABLE_NAME && f.COLUMN_NAME === c.COLUMN_NAME && f.REFERENCED_TABLE_NAME.toLowerCase() === table.toLowerCase() && f.REFERENCED_COLUMN_NAME === key));
      if (refs.some(c => !['varchar','char','text'].includes(c.DATA_TYPE))) throw new Error(`${key} must be a string column before migrating.`);
      const values = new Set();
      for (const ref of refs) {
        const [rows] = await conn.query(`SELECT DISTINCT ${quote(ref.COLUMN_NAME)} AS id FROM ${quote(ref.TABLE_NAME)} WHERE ${quote(ref.COLUMN_NAME)} IS NOT NULL FOR UPDATE`);
        rows.forEach(row => values.add(String(row.id)));
      }
      const valid = new RegExp('^'+prefix+'-[0-9]{3,9}$');
      let next = Math.max(0,...[...values].filter(id => valid.test(id)).map(id => Number(id.slice(prefix.length+1))));
      let changed = 0;
      for (const oldId of [...values].sort()) {
        if (valid.test(oldId)) continue;
        const id = prefix+'-'+String(++next).padStart(3,'0');
        for (const ref of refs) await conn.query(`UPDATE ${quote(ref.TABLE_NAME)} SET ${quote(ref.COLUMN_NAME)}=:id WHERE ${quote(ref.COLUMN_NAME)}=:oldId`,{id,oldId});
        // Audit record pointers are polymorphic rather than declared foreign keys.
        if (tables.some(t => t.TABLE_NAME.toLowerCase() === 'useractivity')) await conn.query('UPDATE UserActivity SET RecordID=:id WHERE RecordID=:oldId',{id,oldId});
        changed++;
      }
      await conn.query('INSERT INTO EntityIdSequence (Entity,NextValue) VALUES (:table,:next) ON DUPLICATE KEY UPDATE NextValue=GREATEST(NextValue,VALUES(NextValue))',{table,next});
      if (table === 'User' && tables.some(t => t.TABLE_NAME.toLowerCase() === 'useridsequence')) await conn.query('UPDATE UserIdSequence SET NextValue=:next WHERE SequenceID=1',{next:next+1});
      console.log(`${table}: converted ${changed} IDs (${prefix}-001 format).`);
    }
    for (let i=0;i<foreignKeys.length;i++) if (await orphanCount(foreignKeys[i]) !== before[i]) throw new Error('Foreign key validation failed; rolling back.');
    await conn.query('SET FOREIGN_KEY_CHECKS=1');
    await conn.commit();
    console.log('ID migration committed; foreign key references verified.');
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    await conn.query('SET FOREIGN_KEY_CHECKS=1');
    if (auditTrigger) {
      await conn.query('DROP TRIGGER IF EXISTS audit_no_update');
      await conn.query(`CREATE TRIGGER audit_no_update ${auditTrigger.Timing} UPDATE ON ${quote(auditTrigger.Table)} FOR EACH ROW ${auditTrigger.Statement}`);
      await conn.query('SET @entity_id_migration=NULL');
    }
    conn.release();
  }
}
if (require.main === module) migrate().catch(error => { console.error(error.message); process.exitCode=1; }).finally(() => pool.end());
module.exports = migrate;
