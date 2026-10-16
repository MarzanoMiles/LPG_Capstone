const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const jwt = require('jsonwebtoken');
const dbPath = require.resolve('../config/db');
const writes = [];
let actor;
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
  query: async (sql, params) => {
    if (sql.includes('INSERT INTO UserActivity')) { writes.push(params); return [{}]; }
    return [[actor].filter(Boolean)];
  },
} };
const {auditContext}=require('../utils/databaseAudit');
const { authenticate, authorize } = require('../middleware/auth');
process.env.JWT_SECRET = 'users-audit-test-secret';
function request(path, method = 'POST') {
  return { headers: { authorization: `Bearer ${jwt.sign({ userId: 'U-001', roleName: 'Administrator', companyId: 'forged-company' }, process.env.JWT_SECRET)}` }, originalUrl: path, path: '/', baseUrl: path.split('/').slice(0, 2).join('/'), method,
    body: { userId: 'forged-user', password: 'never-log-me', token: 'never-log-this' } };
}
function response() {
  const res = new EventEmitter(); res.locals = {}; res.statusCode = 201;
  res.json = body => body; res.end = () => {}; return res;
}
test('audit resolves full mounted path, authenticates actor from DB, captures target and excludes secrets', async () => {
  actor = { userId: 'U-001', companyId: 'C-001', roleName: 'Administrator', status: 'Active', moduleAccess:{users:true, inventory:true} };
  writes.length = 0;
  const req = request('/user-settings/warehouses?token=secret'); const res = response();
  let error; let context; await authenticate(req, res, e => { error = e; context=auditContext.getStore(); }); assert.equal(error, undefined);
  assert.equal(req.user.companyId, 'C-001');
  res.json({ id: 'WH-001', token: 'response-secret' }); res.end();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(writes.length, 0); assert.equal(context.module, 'Warehouse Settings');
  assert.equal(context.recordId, 'WH-001'); assert.equal(context.userId, 'U-001');
  assert.doesNotMatch(JSON.stringify(context), /secret|never-log|forged/);
});
test('failed requests without changes do not produce activity entries', async () => {
  writes.length = 0; const res = response(); res.statusCode = 409;
  await authenticate(request('/inventory/stock-in'), res, () => {}); res.end();
  await new Promise(resolve => setImmediate(resolve)); assert.equal(writes.length, 0);
});
test('inactive users and stale administrator claims cannot authorize settings changes', async () => {
  actor = { userId: 'U-001', companyId: 'C-001', roleName: 'Stockman', status: 'Inactive', moduleAccess:{users:true} };
  let error; await authenticate(request('/user-settings/roles'), response(), e => { error = e; });
  assert.equal(error.statusCode, 401);
  actor.status = 'Active'; const req = request('/user-settings/roles');
  await authenticate(req, response(), () => {});
  authorize('Admin')(req, response(), e => { error = e; }); assert.equal(error.statusCode, 403);
});

test('saved module denial is enforced despite an administrator role or stale token claims',async()=>{
  actor={userId:'U-001',companyId:'C-001',roleName:'Administrator',status:'Active',moduleAccess:{}};
  writes.length=0;let error;
  await authenticate(request('/users','GET'),response(),e=>{error=e;});
  assert.equal(error.statusCode,403);assert.equal(writes.length,0);
  actor.moduleAccess={users:true};error=null;
  await authenticate(request('/users','GET'),response(),e=>{error=e;});assert.equal(error,undefined);
});

test('previews, views and requests without committed writes do not create activity entries',async()=>{
  actor={userId:'U-001',companyId:'C-001',roleName:'Administrator',status:'Active',moduleAccess:{inventory:true,restocking:true,users:true}};
  for(const [path,method] of [
    ['/purchase-orders/document-preview','POST','Preview',null],
    ['/inventory/INV-001','DELETE','Delete','INV-001'],
    ['/users','GET','View',null],
  ]) {
    writes.length=0;const res=response();await authenticate(request(path,method),res,()=>{});res.end();
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(writes.length,0);
  }
});
