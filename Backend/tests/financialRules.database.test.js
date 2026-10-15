const {test} = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../config/db');
const migrate = require('../db/migrate_financial_rules');
test('migration reruns, SQL persistence, concurrent ledger uniqueness', async () => {
 let a, b;
 const orderId = `TEST-${Date.now()}`;
 try {
  await migrate();
  a = await pool.getConnection(); b = await pool.getConnection();
  const [[user]] = await a.query('SELECT UserID, CompanyID FROM User LIMIT 1');
  assert.ok(user);
  await a.beginTransaction();
  await a.query('INSERT IGNORE INTO CompanySettings (CompanyID) VALUES (?)', [user.CompanyID]);
  await a.query("UPDATE CompanySettings SET AllowIssueRefund=0, EnableCancellationFee=1, CancellationFeeType='Percentage', CancellationFeeValue=10.25 WHERE CompanyID=?", [user.CompanyID]);
  const [[row]] = await a.query('SELECT * FROM CompanySettings WHERE CompanyID=?', [user.CompanyID]);
  assert.equal(row.AllowIssueRefund,0); assert.equal(row.EnableCancellationFee,1);
  assert.equal(row.CancellationFeeType,'Percentage'); assert.equal(Number(row.CancellationFeeValue),10.25);
  const router = require('../routes/settingsRoutes');
  const originalQuery = pool.query;
  pool.query = a.query.bind(a);
  const invoke = (method,path,body) => new Promise((resolve,reject) => {
   const route = router.stack.find(layer => layer.route?.path === path && layer.route.methods[method]).route;
   route.stack.at(-1).handle({user:{companyId:user.CompanyID},body}, {json:resolve}, reject);
  });
  try {
   const payload = {allowIssueRefund:true,enableCancellationFee:true,cancellationFeeType:'Fixed',cancellationFeeValue:50,taxRate:12,taxEnabled:true,currency:'PHP',roundUp:false,roundDown:false,twoDecimalStandard:true};
   await invoke('put','/tax',payload);
   assert.equal((await invoke('get','/')).cancellationFeeValue,50);
   await invoke('put','/tax',{...payload,allowIssueRefund:false,cancellationFeeType:'Percentage',cancellationFeeValue:10});
   const saved = await invoke('get','/');
   assert.equal(saved.allowIssueRefund,false); assert.equal(saved.enableCancellationFee,true);
   assert.equal(saved.cancellationFeeType,'Fixed'); assert.equal(saved.cancellationFeeValue,50);
   await assert.rejects(invoke('put','/tax',{...payload,cancellationFeeType:'Percentage',cancellationFeeValue:101}), e => e.statusCode===400);
   await invoke('put','/tax',{...payload,allowIssueRefund:0,enableCancellationFee:'1'});
   const numeric = await invoke('get','/');
   assert.equal(numeric.allowIssueRefund,false); assert.equal(numeric.enableCancellationFee,true);
   await invoke('put','/tax',{taxRate:8});
   const legacy = await invoke('get','/');
   assert.equal(legacy.allowIssueRefund,false); assert.equal(legacy.enableCancellationFee,true);
   assert.equal(legacy.cancellationFeeValue,50); assert.equal(legacy.taxRate,8);
   const {financialSettingsPayload} = await import('../../src/utils/financialSettings.js');
   const fromPage = financialSettingsPayload(await invoke('get','/'));
   const response = await invoke('put','/tax',JSON.parse(JSON.stringify(fromPage)));
   assert.equal(response.settings.allowIssueRefund,false);
   assert.equal(response.settings.enableCancellationFee,true);

  } finally { pool.query = originalQuery; }
  await a.rollback();
  const sql = "INSERT INTO RefundLedger (CompanyID,OrderID,UserID,Reason,EligibleAmount,FeeType,FeeValue,CancellationFee,RefundAmount) VALUES (?,?,?,'Refund',100,'Fixed',10,10,90)";
  const values = [user.CompanyID,orderId,user.UserID];
  await a.beginTransaction(); await b.beginTransaction();
  await a.query(sql, values);
  const duplicate = assert.rejects(b.query(sql, values), error => error.code === 'ER_DUP_ENTRY');
  await a.commit(); await duplicate; await b.rollback();
  const [[count]] = await a.query('SELECT COUNT(*) AS n FROM RefundLedger WHERE OrderID=?',[orderId]);
  assert.equal(count.n,1);
 } finally {
  if (a) { await a.rollback(); await a.query('DELETE FROM RefundLedger WHERE OrderID=?',[orderId]); a.release(); }
  if (b) { await b.rollback(); b.release(); }
  await pool.end();
 }
});
