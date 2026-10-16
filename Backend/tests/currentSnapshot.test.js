const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {restoreSnapshot, snapshotPath} = require('../db/currentSnapshot');

test('existing tables prevent any snapshot import, preserving edits and deletions', async () => {
  const pool = {query: async sql => {
    assert.equal(sql, 'SHOW FULL TABLES');
    return [[{name: 'Role'}]];
  }};
  const message = await restoreSnapshot({pool, restore: async () => assert.fail('must not restore')});
  assert.match(message, /Seed skipped/);
});

test('an empty database imports only the current snapshot', async t => {
  t.mock.method(fs, 'existsSync', file => file === snapshotPath);
  let calls = 0;
  const message = await restoreSnapshot({pool: {query: async () => [[]]},
    restore: async (name, args, file) => {
      calls++;
      assert.equal(name, 'mysql');
      assert.equal(file, snapshotPath);
      assert.equal(args.at(-1), process.env.DB_NAME);
      assert.ok(!args.some(arg => arg.startsWith('--password')));
    }});
  assert.equal(calls, 1);
  assert.match(message, /Restored/);
});

test('failed imports surface errors instead of silently starting', async t => {
  t.mock.method(fs, 'existsSync', file => file === snapshotPath);
  await assert.rejects(restoreSnapshot({pool: {query: async () => [[]]},
    restore: async () => {throw new Error('import failed');}}), /import failed/);
});

test('missing snapshot prevents fresh initialization without legacy fallback', async t => {
  t.mock.method(fs, 'existsSync', () => false);
  await assert.rejects(restoreSnapshot({pool: {query: async () => [[]]},
    restore: async () => assert.fail('must not restore')}), /snapshot missing/);
});
