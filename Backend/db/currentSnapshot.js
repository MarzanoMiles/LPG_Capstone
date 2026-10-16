const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { pipeline } = require('node:stream/promises');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const snapshotPath = path.join(__dirname, 'snapshots/current.sql');

function client(name) {
  const override = process.env[name === 'mysql' ? 'MYSQL_CLIENT_PATH' : 'MYSQLDUMP_PATH'];
  if (override) return override;
  const windowsPath = path.join(process.env.ProgramFiles || 'C:/Program Files', 'MySQL/MySQL Server 8.0/bin', `${name}.exe`);
  return process.platform === 'win32' && fs.existsSync(windowsPath) ? windowsPath : name;
}

function connectionArgs() {
  if (!process.env.DB_NAME || !process.env.DB_USER || !process.env.DB_HOST) {
    throw new Error('Configure DB_HOST, DB_USER and DB_NAME in Backend/.env first.');
  }
  return ['--host', process.env.DB_HOST, '--port', process.env.DB_PORT || '3306',
    '--user', process.env.DB_USER, '--ssl-mode=REQUIRED', '--default-character-set=utf8mb4'];
}

async function runClient(name, args, input) {
  const child = spawn(client(name), args, {
    env: { ...process.env, MYSQL_PWD: process.env.DB_PASSWORD || '' },
    stdio: [input ? 'pipe' : 'ignore', 'ignore', 'pipe'], windowsHide: true,
  });
  let errors = '';
  child.stderr.on('data', chunk => { errors += chunk; });
  const completed = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`${name} failed (${code}): ${errors.trim()}`)));
  });
  await Promise.all([completed, input ? pipeline(fs.createReadStream(input), child.stdin) : Promise.resolve()]);
}

async function captureSnapshot() {
  const args = connectionArgs();
  fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
  const temporary = `${snapshotPath}.${process.pid}.tmp`;
  try {
    await runClient('mysqldump', [...args, '--single-transaction', '--skip-lock-tables', '--skip-add-locks',
      '--no-tablespaces', '--set-gtid-purged=OFF', '--hex-blob', '--skip-add-drop-table',
      '--routines', '--events', '--result-file', temporary, process.env.DB_NAME]);
    if (!fs.statSync(temporary).size) throw new Error('Database export was empty.');
    fs.renameSync(temporary, snapshotPath);
    return 'Saved current database to db/snapshots/current.sql. Keep this private snapshot with your backup.';
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

async function restoreSnapshot({ pool, restore = runClient } = {}) {
  connectionArgs();
  const ownPool = !pool;
  pool ||= require('../config/db');
  try {
    const [tables] = await pool.query('SHOW FULL TABLES');
    if (tables.length) return 'Existing database detected. Seed skipped; all current records and deletions preserved.';
    if (!fs.existsSync(snapshotPath)) throw new Error('Current database snapshot missing. Restore your private db/snapshots/current.sql backup; legacy seeds are not used.');
    // Stop application writers before restoring: MySQL schema changes do not roll back.
    await restore('mysql', [...connectionArgs(), process.env.DB_NAME], snapshotPath);
    return 'Restored the current database snapshot, including schema and saved records.';
  } finally {
    if (ownPool) await pool.end();
  }
}

if (require.main === module) captureSnapshot()
  .then(message => console.log(message))
  .catch(error => { console.error(error.message); process.exitCode = 1; });

module.exports = { captureSnapshot, restoreSnapshot, snapshotPath };
