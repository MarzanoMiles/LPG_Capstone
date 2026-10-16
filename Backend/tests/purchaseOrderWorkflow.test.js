const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const file = path.resolve(__dirname, '../routes/purchaseOrderRoutes.js');
const originalRequire = createRequire(file);

function setup({ status = 'Out for Delivery', received = 0, invalidWarehouse = false, failAudit = false, failEmail = false } = {}) {
  let state = {
    po: { PurchaseOrderID: 'PO-001', PONo: 'PO-2026-001', Status: status, WarehouseID: 'WH-001', SupplierID: 'SUP-001' },
    items: [{ PurchaseOrderItemID: 'POI-001', ProductID: 'P-001', Quantity: 10, ReceivedQuantity: received }],
    stock: 20, audits: [],
  };
  let snapshot;
  const queries = [];
  const conn = {
    async beginTransaction() { snapshot = structuredClone(state); },
    async commit() {},
    async rollback() { state = snapshot; },
    release() {},
    async query(sql, params) {
      queries.push({ sql, params });
      if (sql.includes('SELECT Email,SupplierName FROM SupplierHistory')) return [[{ Email: 'supplier@example.test', SupplierName: 'Supplier' }]];
      if (sql.includes('SELECT WarehouseName,Location FROM Warehouse')) return [[{ WarehouseName: 'Destination', Location: 'Address' }]];
      if (sql.includes('SELECT p.ProductName,i.Quantity')) return [[{ ProductName: 'Product', Quantity: 10, UnitCost: 100, Subtotal: 1000 }]];
      if (sql.includes('FROM Company c LEFT JOIN CompanySettings')) return [[{ name: 'Business', address: 'Address', email: 'business@example.test', phone: '123' }]];
      if (sql.includes('SELECT po.*')) return [[{ ...state.po }]];
      if (sql.includes('SELECT TransactionID FROM InventoryTransaction')) return [state.audits.filter(a => a.remarks === params.remarks)];
      if (sql.includes('SELECT WarehouseID FROM Warehouse')) return [invalidWarehouse ? [] : [{ WarehouseID: 'WH-001' }]];
      if (sql.includes('SELECT * FROM PurchaseOrderItem')) return [structuredClone(state.items)];
      if (sql.includes('SELECT InventoryID FROM Inventory')) return [[{ InventoryID: 'INT-001' }]];
      if (sql.startsWith('UPDATE Inventory SET')) { state.stock += params.qty; return [{ affectedRows: 1 }]; }
      if (sql.includes('INSERT INTO InventoryTransaction')) {
        if (failAudit) throw new Error('Audit insert failed');
        state.audits.push(params); return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('UPDATE PurchaseOrderItem')) { state.items[0].ReceivedQuantity += params.qty; return [{ affectedRows: 1 }]; }
      if (sql.startsWith('UPDATE PurchaseOrder SET')) { state.po.Status = params.status || params.to || (sql.includes("Status='Sent'") ? 'Sent' : undefined); return [{ affectedRows: 1 }]; }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const routes = {};
  const router = { use() {}, get() {}, post() {}, put(url, handler) { routes[url] = handler; } };
  const sandbox = {
    module: { exports: {} }, console: { ...console, error() {} }, Buffer, process: { env: { SMTP_HOST: 'smtp.example.test', SMTP_USER: 'test', SMTP_PASS: 'test' } },
    require(name) {
      if (name === 'express') return { Router: () => router };
      if (name === '../config/db') return { getConnection: async () => conn };
      if (name === '../middleware/auth') return { authenticate() {} };
      if (name === '../config/mailer') return { transporter: { async sendMail(message) { assert.equal(message.to, 'supplier@example.test'); assert.equal(message.attachments.length, 1); if (failEmail) throw new Error('SMTP rejected'); return { accepted: [message.to] }; } } };
      return originalRequire(name);
    },
  };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
  async function call(action, body = {}) {
    return new Promise((resolve, reject) => routes[`/:id/${action}`]({
      params: { id: 'PO-001' }, user: { userId: 'U-001', companyId: 'C-001' }, body,
    }, { json: resolve }, reject));
  }
  return { call, state: () => state, queries };
}
const receipt = (qty, suffix = '0000000000000001') => ({ requestKey: `receipt-${suffix}`, items: [{ productId: 'P-001', qty }] });

test('full physical receipt credits only the persisted warehouse and records Stock In', async () => {
  const app = setup();
  const result = await app.call('receive', receipt(10));
  assert.equal(result.status, 'Received');
  assert.equal(app.state().stock, 30);
  assert.equal(app.state().audits.length, 1);
  assert.equal(app.state().audits[0].qty, 10);
  assert.match(app.queries.find(q => q.sql.includes('INSERT INTO InventoryTransaction')).sql, /'Stock In'/);
  assert.equal(app.queries.find(q => q.sql.includes('SELECT WarehouseID FROM Warehouse')).params.warehouseId, 'WH-001');
});
test('partial receipt then remaining delivery credits only new quantities', async () => {
  const app = setup();
  assert.equal((await app.call('receive', receipt(4))).status, 'Out for Delivery');
  assert.equal(app.state().stock, 24);
  assert.equal((await app.call('receive', receipt(6, '0000000000000002'))).status, 'Received');
  assert.equal(app.state().stock, 30);
  assert.equal(app.state().items[0].ReceivedQuantity, 10);
});
test('retry of a partial or completed receipt does not add stock twice', async () => {
  for (const qty of [4, 10]) {
    const app = setup();
    await app.call('receive', receipt(qty));
    await app.call('receive', receipt(qty));
    assert.equal(app.state().stock, 20 + qty);
    assert.equal(app.state().audits.length, 1);
  }
});
test('warehouse or audit failure rolls back stock, received quantity and PO status', async () => {
  for (const options of [{ invalidWarehouse: true }, { failAudit: true }]) {
    const app = setup(options);
    await assert.rejects(app.call('receive', receipt(10)));
    assert.equal(app.state().stock, 20);
    assert.equal(app.state().items[0].ReceivedQuantity, 0);
    assert.equal(app.state().po.Status, 'Out for Delivery');
    assert.equal(app.state().audits.length, 0);
  }
});
test('receiving rejects early states, overdelivery, negatives, fractions and warehouse substitution', async () => {
  for (const status of ['Pending', 'Sent', 'Approved', 'Received', 'Cancelled']) {
    const app = setup({ status });
    await assert.rejects(app.call('receive', receipt(1)));
    assert.equal(app.state().stock, 20);
  }
  for (const qty of [0, -1, 1.5, 11]) {
    const app = setup();
    await assert.rejects(app.call('receive', receipt(qty)));
    assert.equal(app.state().stock, 20);
  }
  const app = setup();
  await assert.rejects(app.call('receive', { ...receipt(1), warehouseId: 'WH-OTHER' }));
});
test('approval and dispatch enforce the linear state machine without stock movements', async () => {
  const app = setup({ status: 'Sent' });
  await assert.rejects(app.call('dispatch'));
  assert.equal((await app.call('confirm')).status, 'Approved');
  await assert.rejects(app.call('confirm'));
  assert.equal((await app.call('dispatch')).status, 'Out for Delivery');
  assert.equal(app.state().stock, 20);
  assert.equal(app.state().audits.length, 0);
});

test('SMTP failure leaves PO Pending; SMTP acceptance marks Sent without inventory changes', async () => {
  for (const failEmail of [true, false]) {
    const app = setup({ status: 'Pending', failEmail });
    if (failEmail) await assert.rejects(app.call('send'), /Supplier email failed/);
    else await app.call('send');
    assert.equal(app.state().po.Status, failEmail ? 'Pending' : 'Sent');
    assert.equal(app.state().stock, 20);
    assert.equal(app.state().audits.length, 0);
  }
});
