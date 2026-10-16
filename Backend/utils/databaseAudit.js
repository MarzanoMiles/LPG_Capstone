const { AsyncLocalStorage } = require('node:async_hooks');
const auditContext = new AsyncLocalStorage();
const {describeAction} = require('./activityDescriptions');

function mutation(sql, params, result) {
  const text = typeof sql === 'string' ? sql : sql?.sql || '';
  const match = text.match(/^\s*(INSERT(?:\s+IGNORE)?\s+INTO|UPDATE|DELETE\s+FROM)\s+`?(\w+)`?/i);
  if (!match || ['useractivity','dataactivitylog','entityidsequence'].includes(match[2].toLowerCase()) || !result?.affectedRows) return null;
  const verb = match[1].toUpperCase().startsWith('INSERT') ? 'Create' : match[1].toUpperCase().startsWith('DELETE') ? 'Delete' : 'Update';
  if (verb === 'Update' && result.changedRows === 0) return null;
  let id = params && !Array.isArray(params) ? params.id || null : null;
  if (!id && verb === 'Create' && params && !Array.isArray(params)) {
    const columns = text.match(/\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/i);
    const firstValue = columns?.[2].split(',')[0].trim().match(/^:(\w+)$/);
    if (firstValue) id = params[firstValue[1]] || null;
  }
  if (!id && params && !Array.isArray(params)) {
    const where = text.match(/WHERE[\s\S]*?\b\w*ID`?\s*=\s*:(\w+)/i);
    if (where) id = params[where[1]] || null;
  }
  if (!id && result.insertId) id = result.insertId;
  let fields = verb === 'Update' ? [...(text.split(/\bSET\b/i)[1]?.split(/\bWHERE\b/i)[0] || '').matchAll(/\b(\w+)`?\s*=/g)].map(item=>item[1]) : [];
  const boundFields = [...text.matchAll(/\b(\w+)`?\s*=\s*(?:COALESCE\s*\(\s*)?:(\w+)/gi)]
    .filter(item => params && !Array.isArray(params) && params[item[2]] != null).map(item=>item[1]);
  if(boundFields.length)fields=boundFields;
  return { table: match[2], verb, id: id == null ? null : String(id), fields };
}
const isAuditInsert = sql => /^\s*INSERT\s+INTO\s+`?UserActivity\b/i.test(typeof sql === 'string' ? sql : sql?.sql || '');

async function writeAudit(conn, context, changes) {
  const { logUserActivity } = require('./activityLogger');
  const ids = changes.map(change => change.id).filter(Boolean);
  const fields = [...new Set(changes.flatMap(change=>change.fields || []))];
  const action = context.action === 'View' ? changes[0].verb : context.action;
  await logUserActivity({ userId: context.userId, activityType: action,
    module: context.module, recordId: context.recordId || ids[0] || null,
    description: describeAction(action, context.resource || 'record', fields).slice(0,500) }, conn);
}

function wrapConnection(conn) {
  let pending = []; let explicit = false; let inTransaction = false;
  return new Proxy(conn, { get(target, key) {
    if (key === 'beginTransaction') return async () => {
      await target.beginTransaction(); pending=[]; explicit=false; inTransaction=true;
    };
    if (key === 'query' || key === 'execute') return async (sql, params) => {
      const context = auditContext.getStore();
      const text = typeof sql === 'string' ? sql : sql?.sql || '';
      if (context && !inTransaction && isAuditInsert(sql)) {
        if (context.records || context.attempted) return [{affectedRows:1}];
        const result=await target[key](sql,params);context.records++;return result;
      }
      if (context && inTransaction && isAuditInsert(sql) && !pending.length && context.attempted) return [{affectedRows:1}];
      if (context && !isAuditInsert(sql) && /^\s*(INSERT|UPDATE|DELETE)\b/i.test(text)) context.attempted = true;
      if (context && !inTransaction && /^\s*(INSERT|UPDATE|DELETE)\b/i.test(text)) {
        try {
          await target.beginTransaction();
          const result=await target[key](sql,params);
          const change=mutation(sql,params,result[0]);
          if(change)await writeAudit(target,context,[change]);
          await target.commit();if(change)context.records++;return result;
        } catch(error) {await target.rollback();throw error;}
      }
      const result = await target[key](sql, params);
      if (auditContext.getStore()) {
        if (isAuditInsert(sql)) explicit = true;
        const change = mutation(sql, params, result[0]);
        if (change) pending.push(change);
      }
      return result;
    };
    if (key === 'commit') return async () => {
      const context = auditContext.getStore();
      if (context && pending.length && !explicit) await writeAudit(target, context, pending);
      await target.commit();
      if (context && (pending.length || explicit)) context.records++;
      pending = []; explicit = false; inTransaction=false;
    };
    if (key === 'rollback') return async () => { pending = []; explicit = false; inTransaction=false; return target.rollback(); };
    return typeof target[key] === 'function' ? target[key].bind(target) : target[key];
  } });
}

function installDatabaseAudit(pool) {
  const getConnection = pool.getConnection.bind(pool);
  const query = pool.query.bind(pool);
  const execute = pool.execute?.bind(pool);
  pool.getConnection = async () => wrapConnection(await getConnection());
  for (const [name, original] of [['query', query], ['execute', execute]]) {
    if (!original) continue;
    pool[name] = async (sql, params) => {
      const context = auditContext.getStore();
      if (!context) return original(sql, params);
      if (isAuditInsert(sql)) {
        // Legacy handlers write after an autocommit mutation already audited below.
        if (context.records || context.attempted) return [{ affectedRows: 1 }];
        const result = await original(sql, params); context.records++; return result;
      }
      const text = typeof sql === 'string' ? sql : sql?.sql || '';
      if (!/^\s*(INSERT|UPDATE|DELETE)\b/i.test(text)) return original(sql, params);
      context.attempted = true;
      const conn = await getConnection();
      try {
        await conn.beginTransaction();
        const result = await conn[name](sql, params);
        const change = mutation(sql, params, result[0]);
        if (change) await writeAudit(conn, context, [change]);
        await conn.commit();
        if (change) context.records++;
        return result;
      } catch (error) { await conn.rollback(); throw error; }
      finally { conn.release(); }
    };
  }
}
module.exports = { auditContext, installDatabaseAudit, wrapConnection, mutation };
