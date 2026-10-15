const {test} = require('node:test');
const assert = require('node:assert/strict');
const {validateSettings, calculateRefund, issueRefund} = require('../utils/financialRules');
const base = {allowIssueRefund: false, enableCancellationFee: false, cancellationFeeType: 'Fixed', cancellationFeeValue: 50};
const config = {AllowIssueRefund: 1, EnableCancellationFee: 1, CancellationFeeType: 'Fixed', CancellationFeeValue: 50};
test('validates booleans, both fee types and numeric bounds', () => {
 for (const value of [0, 50, 100]) assert.equal(validateSettings({...base, cancellationFeeType: 'Percentage', cancellationFeeValue:value}).cancellationFeeValue, value);
 for (const value of [-1, 101, NaN, Infinity, '', null, 0.001]) assert.throws(() => validateSettings({...base, cancellationFeeType:'Percentage', cancellationFeeValue:value}));
 assert.equal(validateSettings({...base, allowIssueRefund:'false'}).allowIssueRefund,0);
 assert.throws(() => validateSettings({...base, cancellationFeeType:'Other'}));
 assert.equal(validateSettings({...base, cancellationFeeValue:9999999999.99}).cancellationFeeValue,9999999999.99);
 assert.throws(() => validateSettings({...base, cancellationFeeValue:10000000000}));
 assert.equal(validateSettings({...base, enableCancellationFee:true}).enableCancellationFee, 1);
});
test('fixed and percentage fees, cent rounding, caps and disabled dependencies', () => {
 assert.deepEqual(calculateRefund(200,config,true),{eligibleAmount:200,cancellationFee:50,refundAmount:150});
 assert.equal(calculateRefund(20,config,true).refundAmount,0);
 assert.equal(calculateRefund(123.45,{...config,CancellationFeeType:'Percentage',CancellationFeeValue:10},true).cancellationFee,12.35);
 assert.equal(calculateRefund(200,{...config,CancellationFeeType:'Percentage',CancellationFeeValue:100},true).refundAmount,0);
 for (const settings of [{...config,AllowIssueRefund:0},{...config,EnableCancellationFee:0}]) assert.equal(calculateRefund(200,settings,true).cancellationFee,0);
 assert.equal(calculateRefund(200,config,false).cancellationFee,0);
 assert.throws(() => calculateRefund(0,config,true));
});
function connection({settings=config,paid=200,status='Preparing',existing=null}={}) {
 const ledger=[];
 return {ledger, async query(sql,params) {
  if(sql.includes('SELECT o.*')) return [[{TotalAmount:200,OrderStatus:status}]];
  if(sql.includes('SELECT s.SaleID')) return [[{SaleID:'S-TEST'}]];
  if(sql.includes('SELECT * FROM RefundLedger')) return [[...(existing?[existing]:ledger)]];
  if(sql.includes('SELECT * FROM CompanySettings')) return [[settings]];
  if(sql.includes('SELECT p.AmountPaid')) return [[{AmountPaid:paid}]];
  if(sql.includes('INSERT INTO RefundLedger')) {ledger.push(params);return [{}];}
  throw new Error(sql);
 }};
}
const user={companyId:'TEST',userId:'TEST',roleName:'Admin'};
test('server rejects disabled refunds and unauthorized users',async()=>{
 await assert.rejects(issueRefund(connection({settings:{...config,AllowIssueRefund:0}}),user,'ORDER','Refund'), /disabled/);
 await assert.rejects(issueRefund(connection(),{...user,roleName:'Cashier'},'ORDER','Refund'), /administrators/);
});
test('prepaid eligibility, unpaid rejection and no fee on ordinary refunds',async()=>{
 assert.equal((await issueRefund(connection(),user,'ORDER','Cancellation')).cancellationFee,50);
 assert.equal((await issueRefund(connection({paid:100}),user,'ORDER','Cancellation')).cancellationFee,0);
 assert.equal((await issueRefund(connection({status:'Completed'}),user,'ORDER','Cancellation')).cancellationFee,0);
 assert.equal((await issueRefund(connection(),user,'ORDER','Refund')).cancellationFee,0);
 await assert.rejects(issueRefund(connection({paid:0}),user,'ORDER','Cancellation'), /eligible/);
});
test('repeat requests return original refund without another ledger entry',async()=>{
 const conn=connection();
 await issueRefund(conn,user,'ORDER','Cancellation');
 await issueRefund(conn,user,'ORDER','Cancellation');
 assert.equal(conn.ledger.length,1);
});

test('inactive fees preserve stored type and value instead of validating hidden drafts', () => {
 const saved = {CancellationFeeType:'Fixed', CancellationFeeValue:'250.00'};
 for (const switches of [{allowIssueRefund:false,enableCancellationFee:true},{allowIssueRefund:true,enableCancellationFee:false}]) {
  const result = validateSettings({...switches,cancellationFeeType:'Percentage',cancellationFeeValue:''}, saved);
  assert.equal(result.cancellationFeeType,'Fixed');
  assert.equal(result.cancellationFeeValue,250);
 }
 assert.throws(() => validateSettings({...base,allowIssueRefund:true,enableCancellationFee:true,cancellationFeeValue:-1},saved));
});
test('frontend ignores hidden fee inputs and validates active fees', async () => {
 const {financialSettingsPayload} = await import('../../src/utils/financialSettings.js');
 for (const switches of [{allowIssueRefund:false,enableCancellationFee:true},{allowIssueRefund:true,enableCancellationFee:false}]) {
  for (const value of ['',undefined,250]) {
   const payload = financialSettingsPayload({...base,...switches,cancellationFeeType:'Percentage',cancellationFeeValue:value});
   assert.equal('cancellationFeeValue' in payload,false);
   assert.equal('cancellationFeeType' in payload,false);
  }
 }
 const active = {...base,allowIssueRefund:true,enableCancellationFee:true};
 for (const value of ['0','50.00','12.35']) assert.equal(financialSettingsPayload({...active,cancellationFeeValue:value}).cancellationFeeValue,Number(value));
 for (const value of ['',null,undefined,-1,'0.001']) assert.throws(() => financialSettingsPayload({...active,cancellationFeeValue:value}));
 assert.throws(() => financialSettingsPayload({...active,cancellationFeeType:'Percentage',cancellationFeeValue:101}), /between 0 and 100/);
});

test('switches accept explicit database representations and preserve omitted saved values', () => {
 for (const value of [true,1,'1','true']) assert.equal(validateSettings({...base,allowIssueRefund:value}).allowIssueRefund,1);
 for (const value of [false,0,'0','false']) assert.equal(validateSettings({...base,enableCancellationFee:value}).enableCancellationFee,0);
 for (const value of [null,'yes',2,{},[]]) assert.throws(() => validateSettings({...base,allowIssueRefund:value}));
 const saved = {AllowIssueRefund:0,EnableCancellationFee:1,CancellationFeeType:'Fixed',CancellationFeeValue:'50.00'};
 const result = validateSettings({taxRate:12},saved);
 assert.equal(result.allowIssueRefund,0); assert.equal(result.enableCancellationFee,1); assert.equal(result.cancellationFeeValue,50);
});
test('frontend always sends JSON boolean switches including missing or numeric settings', async () => {
 const {financialSettingsPayload} = await import('../../src/utils/financialSettings.js');
 for (const value of [undefined,0,'0','false',false]) {
  const payload = JSON.parse(JSON.stringify(financialSettingsPayload({taxRate:12,allowIssueRefund:value,enableCancellationFee:1})));
  assert.equal(payload.allowIssueRefund,false); assert.equal(payload.enableCancellationFee,true);
 }
});
