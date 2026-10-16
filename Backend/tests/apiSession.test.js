const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('API session handling attaches tokens, signs out invalid sessions, and preserves login errors', async () => {
  const original = Object.fromEntries(['localStorage', 'window', 'CustomEvent', 'fetch'].map(key => [key, global[key]]));
  const store = new Map(); const events = []; const calls = [];
  global.localStorage = { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value), removeItem: key => store.delete(key) };
  global.window = { dispatchEvent: event => events.push(event) };
  global.CustomEvent = class { constructor(type, options) { this.type = type; this.detail = options.detail; } };
  let status = 200;
  global.fetch = async (url, options) => {
    calls.push({url, options});
    return { ok: status === 200, status, json: async () => status === 200 ? {RoleName:'Administrator'} : {error:'Invalid email or password.'} };
  };
  try {
    const source = fs.readFileSync(path.join(__dirname, '../../src/api.js'), 'utf8').replace('import.meta.env.VITE_API_BASE_URL', JSON.stringify('http://localhost:4000'));
    const {apiRequest} = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
    await assert.rejects(apiRequest('/auth/me'), error => error.status === 401 && /sign in again/.test(error.message));
    assert.equal(calls.length, 0); assert.equal(events.length, 1);
    store.set('token','valid-session'); store.set('user','admin');
    assert.equal((await apiRequest('/auth/me', {headers:new Headers({'X-Test':'kept'})})).RoleName,'Administrator');
    assert.equal(calls[0].options.headers.get('Authorization'),'Bearer valid-session');
    assert.equal(calls[0].options.headers.get('X-Test'),'kept');
    status = 401;
    await assert.rejects(apiRequest('/auth/login',{method:'POST'}), /Invalid email or password/);
    assert.equal(store.get('token'),'valid-session'); assert.equal(events.length,1);
    await assert.rejects(apiRequest('/users'), /sign in again/);
    assert.equal(store.has('token'),false); assert.equal(store.has('user'),false); assert.equal(events.length,2);
    store.set('token','undefined');
    await assert.rejects(apiRequest('/auth/me'), /sign in again/);
    assert.equal(calls.length,3);
  } finally {
    for(const [key,value] of Object.entries(original)) {
      if(value === undefined) delete global[key]; else global[key]=value;
    }
  }
});
