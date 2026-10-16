const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../config/db');
const jwt = require('jsonwebtoken');
const router = require('../routes/authRoutes');
const handler = router.stack.find(layer => layer.route?.path === '/register').route.stack[0].handle;
const body = {
  companyName: 'Example LPG', branchName: 'Main', completeAddress: '123 Main Street',
  firstName: 'Test', lastName: 'Admin', email: 'admin@example.test',
  password: 'Example123!', confirmPassword: 'Example123!',
};

function register(payload) {
  return new Promise((resolve, reject) => {
    let status = 200;
    handler({body: payload}, {
      status(value) { status = value; return this; },
      json(data) { resolve({status, data}); },
    }, reject);
  });
}

test('registration creates company and administrator using only the displayed fields', async t => {
  const inserts = [];
  let committed = false;
  let released = false;
  const connection = {
    beginTransaction: async () => {},
    commit: async () => { committed = true; },
    rollback: async () => assert.fail('must not roll back successful registration'),
    release: () => { released = true; },
    query: async (sql, params) => {
      if (sql.includes('INSERT INTO EntityIdSequence')) return [{insertId: 1}];
      if (sql.includes('SELECT NextValue')) return [[{NextValue: 1}]];
      if (sql.includes('FROM Role')) return [[{RoleID: 'RL-001', RoleName: 'Administrator'}]];
      if (sql.trim().startsWith('INSERT INTO')) inserts.push({sql, params});
      return [[]];
    },
  };
  t.mock.method(pool, 'getConnection', async () => connection);
  t.mock.method(jwt, 'sign', () => 'test-token');
  const result = await register({...body});
  assert.equal(result.status, 201);
  assert.equal(result.data.user.companyId, 'C-001');
  assert.equal(result.data.user.role, 'Administrator');
  assert.equal(inserts.length, 6);
  const company = inserts.find(entry => entry.sql.includes('INSERT INTO Company ('));
  assert.equal(company.params.address, body.completeAddress);
  assert.ok(!company.sql.includes('DTIRegNo'));
  const profile = inserts.find(entry => entry.sql.includes('INSERT INTO CompanySettings'));
  assert.ok(profile.sql.includes('CompanyName'));
  assert.equal(profile.params.companyName, body.companyName);
  assert.equal(profile.params.address, body.completeAddress);
  assert.equal(profile.params.email, body.email);
  const user = inserts.find(entry => entry.sql.includes('INSERT INTO `User`'));
  const branch = inserts.find(entry => entry.sql.includes('INSERT INTO Branch'));
  const warehouse = inserts.find(entry => entry.sql.includes('INSERT INTO Warehouse'));
  assert.equal(branch.params.name, body.branchName);
  assert.equal(branch.params.address, body.completeAddress);
  assert.equal(branch.params.companyId, result.data.user.companyId);
  assert.equal(user.params.branchId, branch.params.branchId);
  assert.equal(warehouse.params.branchId, branch.params.branchId);
  assert.notEqual(user.params.passwordHash, body.password);
  assert.ok(committed && released);
});

test('registration rejects missing or mismatched password confirmation before database access', async t => {
  t.mock.method(pool, 'getConnection', async () => assert.fail('must not access database'));
  await assert.rejects(register({...body, confirmPassword: ''}), {statusCode: 400});
  await assert.rejects(register({...body, confirmPassword: 'Different123!'}), {
    statusCode: 400, message: 'Passwords do not match.',
  });
});
