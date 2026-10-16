const PDFDocument = require('pdfkit');
const date = value => value ? new Date(value).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' }) : 'Assigned upon creation';
const note = 'Please acknowledge receipt of this purchase order and advise on item availability and the expected delivery date. Include the purchase order number in all related correspondence and delivery documents.';
function purchaseOrderText({ po, business, supplier, warehouse, items }) {
  return [business.name, business.address, `${business.email} | ${business.phone}`, '', 'PURCHASE ORDER', `Purchase Order No.: ${po.PONo}`, `Issue Date: ${date(po.OrderDate)}`, '', `Issued To: ${supplier.SupplierName}`, `Supplier Email: ${supplier.Email}`, `Deliver To: ${warehouse.WarehouseName}`, warehouse.Location, '', 'Please confirm availability of the following requested items for delivery to the destination specified above.', ...items.map((item, index) => `${index + 1}. ${item.ProductName} | Quantity: ${item.Quantity}`), '', `Total Items: ${items.length}`, '', note].join('\n');
}
function purchaseOrderPDF({ po, business, supplier, warehouse, items, paymentReceipt = false }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true, info: { Title: `Purchase Order ${po.PONo}`, Author: business.name } });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const width = doc.page.width - 96;
    const gap = points => { doc.x = 48; doc.y += points; };
    const heading = text => {
      gap(12);
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#334155').text(text, 48, doc.y, {width, lineGap: 2});
      gap(6);
    };
    const body = text => {
      doc.font('Helvetica').fontSize(10).fillColor('#1e293b').text(String(text || ''), 48, doc.y, {width, lineGap: 3});
      gap(5);
    };
    doc.font('Helvetica-Bold').fontSize(20).fillColor('#142f43').text(business.name, {width, lineGap: 3});
    gap(8);
    body(business.address);
    body(`${business.email} | ${business.phone}`);
    gap(14);
    doc.font('Helvetica-Bold').fontSize(23).text(paymentReceipt ? 'PAYMENT ACKNOWLEDGMENT' : 'PURCHASE ORDER', 48, doc.y, {width});
    gap(10);
    body(`Purchase Order No.: ${po.PONo}`);
    body(`Issue Date: ${date(po.OrderDate)}`);
    gap(4);
    heading('ISSUED TO'); body(supplier.SupplierName); body(supplier.Email);
    heading('DELIVER TO'); body(warehouse.WarehouseName); body(warehouse.Location);
    gap(14);
    if (paymentReceipt) {
      heading('PAYMENT RECORDED AS PAID');
      body(`Payment Method: ${po.PaymentMethod}`);
      body(`Reference No.: ${po.PaymentReference}`);
      body(`Total Amount Due: PHP ${Number(po.TotalAmount || 0).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}`);
      body(`Total Amount Paid: ${po.AmountPaid == null ? 'Not recorded' : `PHP ${Number(po.AmountPaid).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}`}`);
    } else body('Please confirm availability of the following requested items for delivery to the destination specified above.');
    gap(10);
    const columns = paymentReceipt ? [58, 88, 287, 377, 447] : [58, 98, 447];
    const widths = paymentReceipt ? [22, 189, 80, 60, 90] : [30, 329, 90];
    const cellOptions = i => ({width: widths[i], lineGap: 3, align: paymentReceipt && (i === 2 || i === 4) ? 'right' : i === (paymentReceipt ? 3 : 2) ? 'center' : 'left'});
    function row(values, header = false) {
      doc.font(header ? 'Helvetica-Bold' : 'Helvetica').fontSize(9);
      const height = Math.max(...values.map((value, i) => doc.heightOfString(String(value), cellOptions(i)))) + 20;
      if (doc.y + height > doc.page.height - 70) { doc.addPage(); if (!header) tableHeader(); }
      doc.font(header ? 'Helvetica-Bold' : 'Helvetica').fontSize(9);
      const y = doc.y;
      if (header) doc.rect(48, y, width, height).fill('#e8eef3');
      doc.fillColor('#1e293b');
      values.forEach((value, i) => doc.text(String(value), columns[i], y + 10, cellOptions(i)));
      doc.moveTo(48, y + height).lineTo(48 + width, y + height).strokeColor('#cbd5e1').stroke();
      doc.x = 48; doc.y = y + height;
    }
    function tableHeader() { row(paymentReceipt ? ['No.', 'Item Description', 'Cost Price', 'Qty', 'Total Amount'] : ['No.', 'Item Description', 'Requested Qty'], true); }
    tableHeader();
    items.forEach((item, index) => row(paymentReceipt ? [index + 1, item.ProductName, `PHP ${Number(item.UnitCost || 0).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}`, item.Quantity, `PHP ${Number(item.Subtotal ?? Number(item.UnitCost || 0) * Number(item.Quantity || 0)).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}`] : [index + 1, item.ProductName, item.Quantity]));
    gap(18);
    doc.font('Helvetica').fontSize(10);
    const closingNote = paymentReceipt ? 'This document acknowledges the payment recorded by the purchasing business. Please retain it with the payment provider receipt and quote the purchase order number in related correspondence.' : note;
    const noteHeight = doc.heightOfString(closingNote, {width, lineGap: 3});
    // Keep the item count and closing note together above the page footer.
    if (doc.y + noteHeight + 38 > doc.page.height - 70) doc.addPage();
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#334155').text(`Total Items: ${items.length}`, 48, doc.y, {width, align: 'right'});
    gap(18);
    body(closingNote);
    const range = doc.bufferedPageRange();
    for (let page = range.start; page < range.start + range.count; page++) {
      doc.switchToPage(page);
      doc.font('Helvetica').fontSize(8).fillColor('#64748b').text(`${po.PONo}  |  Page ${page + 1} of ${range.count}`, 48, doc.page.height - 45, { width, align: 'center', lineBreak: false });
    }
    doc.end();
  });
}
module.exports = { purchaseOrderText, purchaseOrderPDF };
