const test = require('node:test');
const assert = require('node:assert/strict');
const {auditContext, installDatabaseAudit} = require('../utils/databaseAudit');
function fixture() {
  let state={value:0,logs:[]}; let failAudit=false; let noOp=false;
  const getConnection=async()=> {
    let draft;
    return {
      beginTransaction:async()=>{draft=structuredClone(state);},
      query:async(sql,params)=>{
        if(sql.includes('INSERT INTO UserActivity')) {
          if(failAudit) throw new Error('Audit unavailable');
          draft.logs.push(params); return [{affectedRows:1}];
        }
        if(sql.startsWith('UPDATE') || sql.startsWith('DELETE')) {
          if(noOp)return [{affectedRows:1,changedRows:0}];
          draft.value++;return [{affectedRows:1}];
        }
        return [[]];
      },
      commit:async()=>{state=draft;}, rollback:async()=>{draft=null;}, release:()=>{},
    };
  };
  const pool={getConnection,query:async()=>[[]]}; installDatabaseAudit(pool);
  return {pool,state:()=>state,fail:()=>{failAudit=true;},noop:()=>{noOp=true;}};
}
const context=()=>({userId:'U-001',action:'Delete',module:'Inventory',recordId:'INV-001',description:'Delete inventory',records:0});
test('autocommit changes and audits commit together; legacy explicit logging is not duplicated',async()=>{
  const f=fixture();
  await auditContext.run(context(),async()=>{
    await f.pool.query('DELETE FROM Inventory WHERE InventoryID=:id',{id:'INV-001'});
    await f.pool.query('INSERT INTO UserActivity (UserID) VALUES (:userId)',{userId:'U-001'});
  });
  assert.equal(f.state().value,1);assert.equal(f.state().logs.length,1);
  assert.equal(f.state().logs[0].recordId,'INV-001');
});
test('an audit failure rolls back an autocommit business write',async()=>{
  const f=fixture();f.fail();
  await assert.rejects(auditContext.run(context(),()=>f.pool.query('UPDATE Inventory SET StockOnHand=1 WHERE InventoryID=:id',{id:'INV-001'})),/Audit unavailable/);
  assert.equal(f.state().value,0);assert.equal(f.state().logs.length,0);
});
test('transaction changes and audit commit once; audit errors prevent business commit',async()=>{
  for(const fail of [false,true]) {
    const f=fixture();if(fail)f.fail();
    await auditContext.run(context(),async()=>{
      const conn=await f.pool.getConnection();await conn.beginTransaction();
      await conn.query('UPDATE Inventory SET StockOnHand=1 WHERE InventoryID=:id',{id:'INV-001'});
      if(fail){await assert.rejects(conn.commit(),/Audit unavailable/);await conn.rollback();}
      else await conn.commit();conn.release();
    });
    assert.equal(f.state().value,fail?0:1);assert.equal(f.state().logs.length,fail?0:1);
  }
});
test('a transaction with its own audit does not receive a second generic audit',async()=>{
  const f=fixture();
  await auditContext.run(context(),async()=>{
    const conn=await f.pool.getConnection();await conn.beginTransaction();
    await conn.query('UPDATE Delivery SET DeliveryStatus=:status WHERE DeliveryID=:id',{id:'DEL-001',status:'Delivered'});
    await conn.query('INSERT INTO UserActivity (UserID) VALUES (:userId)',{userId:'U-001'});
    await conn.commit();conn.release();
  });
  assert.equal(f.state().logs.length,1);
});
test('writes through an acquired connection without beginTransaction are audited atomically',async()=>{
  const f=fixture();
  await auditContext.run(context(),async()=>{
    const conn=await f.pool.getConnection();
    await conn.query('UPDATE Inventory SET StockOnHand=1 WHERE InventoryID=:id',{id:'INV-001'});
    conn.release();
  });
  assert.equal(f.state().value,1);assert.equal(f.state().logs.length,1);
});
test('saving unchanged values does not create an automatic or legacy audit entry',async()=>{
  const f=fixture();f.noop();
  await auditContext.run(context(),async()=>{
    await f.pool.query('UPDATE Inventory SET StockOnHand=1 WHERE InventoryID=:id',{id:'INV-001'});
    await f.pool.query('INSERT INTO UserActivity (UserID) VALUES (:userId)',{userId:'U-001'});
  });
  assert.equal(f.state().value,0);assert.equal(f.state().logs.length,0);
});
