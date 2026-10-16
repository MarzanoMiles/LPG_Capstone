const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const PDFDocument = require('pdfkit');

test('wrapped product descriptions have padded rows and stay above page footers', async () => {
  const rows = [];
  const headers = [];
  const summaries = [];
  class MeasuredPDF extends PDFDocument {
    text(value, x, y, options) {
      if (typeof value === 'string' && value.startsWith('Test product ')) {
        const height = this.heightOfString(value, options);
        rows.push({page:this.page, y, bottom:y + height});
        assert.ok(y >= 48);
        assert.ok(y + height <= this.page.height - 70);
      }
      if (typeof value === 'string' && value.startsWith('Total Items:')) {
        summaries.push(value);
        assert.ok(y >= 48 && y + this.heightOfString(value, options) <= this.page.height - 70);
      }
      if (value === 'Item Description') headers.push(this.page);
      return super.text(value, x, y, options);
    }
  }
  const sandbox = {module:{exports:{}}, Buffer, require: name => { assert.equal(name, 'pdfkit'); return MeasuredPDF; }};
  vm.runInNewContext(fs.readFileSync(require.resolve('../utils/purchaseOrderDocument'), 'utf8'), sandbox);
  const pdf = await sandbox.module.exports.purchaseOrderPDF({
    po:{PONo:'PO-SPACING',OrderDate:'2026-10-16'},
    business:{name:'Business with a long registered name',address:'A long business address '.repeat(8),email:'buyer@example.test',phone:'123'},
    supplier:{SupplierName:'Supplier',Email:'supplier@example.test'},
    warehouse:{WarehouseName:'Main warehouse',Location:'Delivery address '.repeat(10)},
    items:Array.from({length:60}, (_, i) => ({ProductName:`Test product ${i} ` + 'Long product description '.repeat(12), Quantity:i + 1})),
  });
  assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
  assert.equal(rows.length, 60);
  assert.deepEqual(summaries, ['Total Items: 60']);
  assert.ok(new Set(rows.map(row => row.page)).size > 1);
  rows.forEach((row, index) => {
    assert.ok(headers.includes(row.page), 'every item page repeats the table header');
    if (index && row.page === rows[index - 1].page) assert.ok(row.y - rows[index - 1].bottom >= 19, 'wrapped rows have consistent vertical padding');
  });
});
