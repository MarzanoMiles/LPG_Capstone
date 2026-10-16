const test = require('node:test');
const assert = require('node:assert/strict');
let state, draft, failAudit;
const connection = {
 beginTransaction: async()=>{draft=structuredClone(state);},
 query: async(sql,params)=>{

  if (sql.startsWith('SELECT u.FirstName')) return [[draft.user].filter(u=>u && u.id===params.id && u.companyId===params.companyId).map(u=>({...u}))];
  if (sql.startsWith('DELETE FROM PasswordResetToken')) {draft.tokens=[];return [{affectedRows:1}];}
  if (sql.startsWith('DELETE FROM User ')) {draft.archive={...draft.user};draft.user=null;return [{affectedRows:1}];}
  if (sql.startsWith('UPDATE UserHistory')) {draft.archive.Status='Deleted';return [{affectedRows:1}];}
  if (sql.includes('INSERT INTO UserActivity')) {if(failAudit)throw Error('Audit unavailable');draft.history.push(params);return [{affectedRows:1}];}
  throw Error('Unexpected query: '+sql);
 },
 commit:async()=>{state=draft;},rollback:async()=>{},release:()=>{},
};
function mock(module,exports){const id=require.resolve(module);require.cache[id]={id,filename:id,loaded:true,exports};}
mock('../config/db',{getConnection:async()=>connection});
mock('../utils/entityIds',{nextEntityId:async()=> 'UAD-001'});
const router=require('../routes/userRoutes');
const handler=router.stack.find(layer=>layer.route?.methods.delete).route.stack.at(-1).handle;
function call(id,companyId='C-001',userId='U-001') {
 return new Promise(resolve=>handler({params:{id},user:{companyId,userId,roleName:'Administrator'}},{json:body=>resolve({status:200,body})},error=>resolve({status:error.statusCode||500})));
}
function reset(){state={user:{id:'U-002',companyId:'C-001',FirstName:'Test',LastName:'User',Status:'Active',RoleName:'Stockman'},tokens:[{UserID:'U-002'}],history:[{recordId:'old'}],sales:[{UserID:'U-002'}]};failAudit=false;}
test('deletion removes the live account and tokens, retains history and records deletion',async()=>{
 reset();assert.equal((await call('U-002')).status,200);
 assert.equal(state.user,null);assert.equal(state.archive.id,'U-002');assert.deepEqual(state.tokens,[]);assert.equal(state.history[0].recordId,'old');
 assert.deepEqual(state.sales,[{UserID:'U-002'}]);assert.equal(state.history[1].recordId,'U-002');
 assert.equal((await call('U-002')).status,404);
});
test('self-deletion and cross-company deletion are blocked',async()=>{
 reset();assert.equal((await call('U-001')).status,400);
 assert.equal((await call('U-002','C-002')).status,404);assert.equal(state.user.Status,'Active');
});
test('failed audit prevents a committed deletion',async()=>{
 reset();failAudit=true;assert.equal((await call('U-002')).status,500);
 assert.equal(state.user.Status,'Active');assert.equal(state.history.length,1);
});
