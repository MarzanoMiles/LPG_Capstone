const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeModuleAccess } = require('../utils/moduleAccess');

test('legacy arrays, JSON strings and boolean maps normalize consistently in backend and form', async () => {
  const fs = require('node:fs'); const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '../../src/rbac.js'), 'utf8');
  const frontend = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
  const fixtures = [
    ['Users'], ['Dashboard', 'POS Terminal', 'Report Generation & Compliance', 'Data Module', 'Order and Delivery'],
    '["Users","Inventory"]', {users:1,inventory:'true',dashboard:'false',sales:0,unknown:true}, null, 'invalid JSON',
  ];
  for (const raw of fixtures) {
    const result = normalizeModuleAccess(raw);
    assert.deepEqual(frontend.normalizeModuleAccess(raw), result);
    assert.ok(Object.values(result).every(value => typeof value === 'boolean'));
    assert.equal(Object.keys(result).length, 12);
  }
  assert.equal(normalizeModuleAccess(['Users']).users, true);
  assert.equal(normalizeModuleAccess(['Users']).dashboard, false);
  assert.equal(normalizeModuleAccess(['Report Generation & Compliance']).report, true);
  assert.equal(normalizeModuleAccess({dashboard:'false'}).dashboard, false);
  assert.deepEqual(frontend.getAllowedNavIds({role:'Administrator',moduleAccess:{users:true}}),['users']);
  assert.deepEqual(frontend.getAllowedNavIds({role:'Administrator',moduleAccess:{}}),[]);
  assert.deepEqual(frontend.getAllowedNavIds({role:'Custom',moduleAccess:{inventory:true}}),['inventory']);
});
