const test = require('node:test');
const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const path = require('node:path');
const {seedSystemRoles} = require('../db/seedSystemRoles');

function fixture({existing=false, applied=false, fail=false}={}) {
  const state = {roles:[], applied, commits:0, rollbacks:0, released:false};
  let draft;
  const conn = {
    beginTransaction: async () => { draft={roles:[...state.roles],applied:state.applied}; },
    query: async (sql, params) => {
      if (sql.includes('GET_LOCK')) return [[{acquired:1}]];
      if (sql.startsWith('SELECT SeedKey')) return [draft.applied ? [{SeedKey:'system-roles-v1'}] : []];
      if (sql.includes('information_schema.TABLES')) return [[{TABLE_NAME:'producthistory'},{TABLE_NAME:'role'}]];
      if (sql.startsWith('SELECT 1 FROM')) return [existing ? [{present:1}] : []];
      if (sql.startsWith('INSERT INTO Role')) {
        if (fail) throw new Error('write failed');
        draft.roles.push(params);
      }
      if (sql.startsWith('INSERT INTO SetupSeedHistory')) draft.applied=true;
      assert.ok(!/DROP TABLE|DELETE FROM|UPDATE |TRUNCATE/i.test(sql));
      return [{affectedRows:1}];
    },
    commit: async () => { Object.assign(state,draft); state.commits++; },
    rollback: async () => {state.rollbacks++;},
    release: () => {state.released=true;},
  };
  return {state,pool:{getConnection:async()=>conn}};
}

test('fresh seed initializes roles once and never restores deleted roles', async () => {
  const {pool,state}=fixture();
  await seedSystemRoles(pool);
  assert.equal(state.roles.length,10);
  assert.equal(state.roles[0].id,'RL-001');
  state.roles=[];
  await seedSystemRoles(pool);
  assert.deepEqual(state.roles,[]);
  assert.equal(state.applied,true);
});
test('existing application or archived data prevents replacement seed rows', async () => {
  const {pool,state}=fixture({existing:true});
  await seedSystemRoles(pool);
  assert.deepEqual(state.roles,[]);
  assert.equal(state.applied,true);
  assert.equal(state.released,true);
});
test('failed role seed rolls back without recording success', async () => {
  const {pool,state}=fixture({fail:true});
  await assert.rejects(seedSystemRoles(pool),/write failed/);
  assert.equal(state.applied,false);
  assert.equal(state.rollbacks,1);
  assert.equal(state.released,true);
});
test('retired seed entry points do not connect to the database', () => {
  for (const file of ['seedProducts.js','seedReports.js','seedJoseDemo.js','seedDashboardHistory.js']) {
    const result=spawnSync(process.execPath,[path.join(__dirname,'../db',file)],{
      encoding:'utf8',env:{...process.env,DB_HOST:'invalid.invalid',DB_PORT:'1'},timeout:3000,
    });
    assert.equal(result.status,0,result.stderr);
    assert.match(result.stdout,/retired/);
    assert.match(result.stdout,/No database records were created or changed/);
  }
});
