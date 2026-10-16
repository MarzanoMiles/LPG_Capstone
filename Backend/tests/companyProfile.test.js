const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../config/db');
const router = require('../routes/settingsRoutes');

test('Business Profile returns the registered company name, address and email', async t => {
  t.mock.method(pool, 'query', async (sql, params) => {
    assert.equal(params.companyId, 'C-001');
    return [[{
      CompanyName: 'Example LPG', Address: '123 Main Street', ContactEmail: 'admin@example.test',
      BusinessDays: 'Monday', OpeningTime: '08:00:00', ClosingTime: '17:00:00',
    }]];
  });
  const handler = router.stack.find(layer => layer.route?.path === '/').route.stack[0].handle;
  const profile = await new Promise((resolve, reject) => {
    handler({user: {companyId: 'C-001'}}, {json: resolve}, reject);
  });
  assert.equal(profile.companyName, 'Example LPG');
  assert.equal(profile.address, '123 Main Street');
  assert.equal(profile.contactEmail, 'admin@example.test');
  assert.ok(!Object.hasOwn(profile, 'fullName'));
});
