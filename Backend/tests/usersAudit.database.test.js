const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../config/db');
const { logUserActivity } = require('../utils/activityLogger');
const { nextUserId } = require('../utils/userIds');

test('audit snapshots and immutability persist in MySQL; user sequence rolls back safely', { skip: process.env.RUN_USERS_AUDIT_DB_TESTS !== '1' }, async () => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[actor]] = await conn.query("SELECT UserID,CompanyID,CONCAT(FirstName,' ',LastName) AS name FROM User LIMIT 1");
    assert.ok(actor);
    const id1 = await nextUserId(conn); const id2 = await nextUserId(conn);
    assert.match(id1, /^U-\d{3,}$/); assert.notEqual(id1, id2);
    await logUserActivity({ userId: actor.UserID, activityType: 'Update', module: 'Warehouse Settings', recordId: 'WH-AUDIT-TEST', description: 'Historical warehouse snapshot' }, conn);
    const [[row]] = await conn.query("SELECT * FROM UserActivity WHERE RecordID='WH-AUDIT-TEST' ORDER BY ActivityDate DESC LIMIT 1");
    assert.equal(row.ActorName, actor.name); assert.equal(row.CompanyID, actor.CompanyID); assert.equal(row.Outcome, 'Success');
    await assert.rejects(conn.query('UPDATE UserActivity SET Description=\'tampered\' WHERE UserActivityID=:id', { id: row.UserActivityID }), /immutable/);
    await assert.rejects(conn.query('DELETE FROM UserActivity WHERE UserActivityID=:id', { id: row.UserActivityID }), /immutable/);
    await conn.query("UPDATE User SET FirstName='Temporary Audit Test' WHERE UserID=:id", {id:actor.UserID});
    const [[snapshot]] = await conn.query('SELECT ActorName FROM UserActivity WHERE UserActivityID=:id', {id:row.UserActivityID});
    assert.equal(snapshot.ActorName, actor.name);
  } finally { await conn.rollback(); conn.release(); }
});

test('settings APIs enforce admin CRUD, duplicate names, dependency protection and audit search', { skip: process.env.RUN_USERS_AUDIT_DB_TESTS !== '1' }, async () => {
  const express = require('express');
  const jwt = require('jsonwebtoken');
  const conn = await pool.getConnection();
  const originalQuery = pool.query;
  const originalGetConnection = pool.getConnection;
  let server;
  try {
    await conn.beginTransaction();
    const [[admin]] = await conn.query("SELECT u.UserID,u.CompanyID FROM User u JOIN Role r ON r.RoleID=u.RoleID WHERE r.RoleName IN ('Admin','Administrator') AND u.Status='Active' LIMIT 1");
    assert.ok(admin);
    // Route transactions share this rollback-only test connection.
    const connection = new Proxy(conn, { get(target, key) {
      if (['beginTransaction','commit','rollback','release'].includes(key)) return async () => {};
      return typeof target[key] === 'function' ? target[key].bind(target) : target[key];
    } });
    pool.query = conn.query.bind(conn); pool.getConnection = async () => connection;
    const app = express(); app.use(express.json());
    app.use('/auth', require('../routes/authRoutes'));
    app.use('/user-settings', require('../routes/userSettingsRoutes'));
    app.use('/users', require('../routes/userRoutes'));
    app.use((error, req, res, _next) => res.status(error.statusCode || 500).json({error:error.message}));
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const token = jwt.sign({userId:admin.UserID}, process.env.JWT_SECRET);
    const call = async (path, method='GET', body, actorToken=token) => {
      const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, headers: {Authorization:`Bearer ${actorToken}`, 'Content-Type':'application/json'}, body:body ? JSON.stringify(body) : undefined });
      return {status:res.status, data:await res.json()};
    };
    const name = `Audit test ${Date.now()}`;
    const role = await call('/user-settings/roles','POST',{name}); assert.equal(role.status,201);
    assert.equal((await call('/user-settings/roles','POST',{name})).status,409);
    assert.equal((await call(`/user-settings/roles/${role.data.id}`,'PUT',{name:name+' renamed'})).status,200);
    const branch = await call('/user-settings/branches','POST',{name,address:'Test address',contact:'09123456789'}); assert.equal(branch.status,201);
    const warehouse = await call('/user-settings/warehouses','POST',{name,location:'Test location',branchId:branch.data.id}); assert.equal(warehouse.status,201);
    const email = `audit-${Date.now()}@example.invalid`;
    const created = await call('/users','POST',{firstName:'Juan Miguel',lastName:'Dela Cruz',usernameEmail:email,password:'Audit-test-password',role:name+' renamed',branch:name,branchId:branch.data.id,status:'Active'});
    assert.equal(created.status,201); assert.match(created.data.id,/^U-\d{3,}$/);
    const login = await call('/auth/login','POST',{email,password:'Audit-test-password'});
    assert.equal(login.status,200); assert.equal(login.data.user.id,created.data.id); assert.ok(login.data.token);
    assert.equal((await call('/users','GET',undefined,login.data.token)).status,403);
    assert.ok(Object.values(login.data.user.moduleAccess).every(value=>value===false));
    const saved = await call(`/users/${created.data.id}`);
    assert.ok(Object.values(saved.data.moduleAccess).every(value => value === false));
    assert.equal(saved.data.firstName,'Juan Miguel'); assert.equal(saved.data.lastName,'Dela Cruz');
    assert.equal((await call(`/users/${created.data.id}`,'PUT',{firstName:' ',lastName:'Dela Cruz'})).status,400);
    assert.equal((await call(`/users/${created.data.id}`,'PUT',{firstName:'Maria Ana',lastName:'De Leon'})).status,200);
    const renamedUser = await call(`/users/${created.data.id}`);
    assert.equal(renamedUser.data.firstName,'Maria Ana'); assert.equal(renamedUser.data.lastName,'De Leon');
    assert.equal(saved.data.branchId,branch.data.id); assert.equal(saved.data.warehouseId,warehouse.data.id);
    assert.equal((await call(`/user-settings/roles/${role.data.id}`,'DELETE')).status,409);
    await conn.query('UPDATE User SET ModuleAccess=:modules WHERE UserID=:id',{id:created.data.id,modules:JSON.stringify({dashboard:true})});
    assert.equal((await call(`/users/${created.data.id}`,'PUT',{fullName:'Audit Edited',role:name+' renamed',branch:name,branchId:branch.data.id})).status,200);
    assert.equal((await call(`/users/${created.data.id}`)).data.moduleAccess.dashboard,true);
    await conn.query('UPDATE User SET ModuleAccess=:modules WHERE UserID=:id',{id:created.data.id,modules:JSON.stringify(['Users','Data Module'])});
    const legacyAccess = (await call(`/users/${created.data.id}`)).data.moduleAccess;
    assert.equal(legacyAccess.users,true); assert.equal(legacyAccess.data,true);
    assert.equal((await call(`/users/${created.data.id}`,'PUT',{modules:{...legacyAccess,inventory:true}})).status,200);
    assert.equal((await call(`/users/${created.data.id}`)).data.moduleAccess.users,true);
    assert.equal((await call(`/users/${created.data.id}`,'PUT',{modules:{inventory:true,dashboard:false}})).status,200);
    const access = (await call(`/users/${created.data.id}`)).data.moduleAccess;
    assert.equal(access.inventory,true); assert.equal(access.dashboard,false);
    assert.equal((await call(`/users/${created.data.id}`,'PUT',{modules:{inventory:'true'}})).status,400);
    assert.equal((await call(`/users/${created.data.id}`,'PUT',{modules:{unknownModule:true}})).status,400);
    const [[managerRole]] = await conn.query("SELECT RoleID,RoleName FROM Role WHERE RoleName IN ('Manager','Operations Supervisor') LIMIT 1");
    assert.ok(managerRole);
    await conn.query('UPDATE User SET RoleID=:roleId WHERE UserID=:id',{roleId:managerRole.RoleID,id:created.data.id});
    const managerToken = jwt.sign({userId:created.data.id,roleName:'Administrator'},process.env.JWT_SECRET);
    assert.equal((await call(`/users/${created.data.id}`,'PUT',{modules:{inventory:false}},managerToken)).status,403);
    assert.equal((await call(`/users/${created.data.id}`,'PUT',{role:'Administrator'},managerToken)).status,403);
    assert.equal((await call('/users','POST',{modules:{users:true}},managerToken)).status,403);
    assert.equal((await call('/users','POST',{firstName:'Blocked',lastName:'Admin',usernameEmail:`blocked-${Date.now()}@example.invalid`,password:'Cannot-create-admin',role:'Administrator'},managerToken)).status,403);
    assert.equal((await call(`/users/${admin.UserID}`,'PUT',{password:'Cannot-reset-admin'},managerToken)).status,403);
    assert.equal((await call(`/users/${admin.UserID}`,'PUT',{status:'Inactive'},managerToken)).status,403);
    assert.equal((await call(`/users/${admin.UserID}`,'DELETE',undefined,managerToken)).status,403);
    assert.equal((await call(`/users/${created.data.id}`,'PUT',{firstName:'Manager',lastName:'Test'},managerToken)).status,200);
    assert.equal((await call(`/users/${created.data.id}`)).data.moduleAccess.inventory,true);
    assert.equal((await call('/auth/logout','POST',undefined,managerToken)).status,200);
    const [[adminRole]] = await conn.query('SELECT RoleName FROM Role WHERE RoleID=(SELECT RoleID FROM User WHERE UserID=:id)',{id:admin.UserID});
    assert.equal((await call(`/users/${created.data.id}`,'PUT',{role:adminRole.RoleName,branch:'',branchId:null})).status,200);
    const retainedAccess = (await call(`/users/${created.data.id}`)).data.moduleAccess;
    assert.equal(retainedAccess.inventory,true); assert.equal(retainedAccess.dashboard,false);
    assert.equal((await call(`/users/${created.data.id}`,'DELETE')).status,200);
    assert.equal((await call('/auth/login','POST',{email,password:'Audit-test-password'})).status,403);
    assert.equal((await call(`/user-settings/branches/${branch.data.id}`,'DELETE')).status,409);
    assert.equal((await call(`/user-settings/warehouses/${warehouse.data.id}`,'DELETE')).status,200);
    assert.equal((await call(`/user-settings/branches/${branch.data.id}`,'DELETE')).status,200);
    assert.equal((await call(`/user-settings/roles/${role.data.id}`,'DELETE')).status,200);
    const audit = await call('/users/activity-log?search='+encodeURIComponent(name)+'&module=Warehouse%20Settings');
    assert.equal(audit.status,200); assert.equal(audit.data.total,2);
    assert.ok(audit.data.rows.every(row => row.targetId===warehouse.data.id && row.outcome==='Success'));
    assert.equal((await call('/users')).status,200);
  } finally {
    if(server) await new Promise(resolve => server.close(resolve));
    pool.query=originalQuery; pool.getConnection=originalGetConnection;
    await conn.rollback(); conn.release();
  }
});
test.after(async () => { await pool.end(); });
