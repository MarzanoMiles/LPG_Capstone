import { apiRequest } from "../api";

let cachedSettings = null;
let cacheTime = 0;

// Settings rarely change mid-session, so cache for a minute to avoid refetching on every print.
async function getSettings() {
  const now = Date.now();
  if (cachedSettings && now - cacheTime < 60000) return cachedSettings;
  try {
    cachedSettings = await apiRequest("/settings");
    cacheTime = now;
  } catch {
    cachedSettings = null;
  }
  return cachedSettings;
}

function esc(val) {
  return String(val ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function formatMoney(amount, currency = "PHP") {
  const symbol = currency === "PHP" ? "₱" : currency + " ";
  return `${symbol}${Number(amount || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Opens a print-ready window styled like a real receipt/invoice, using the
 * company's saved logo, header, footer and print-size settings.
 *
 * @param {object} sale - { saleNo, datetime, cashierName, customerName, orderType,
 *                          items: [{ name, qty, unitPrice, subtotal }],
 *                          subtotal, discount, vat, taxRate, deliveryFee, totalAmount }
 */
export async function printReceipt(sale) {
  const settings = await getSettings();

  const businessName = settings?.fullName || "GasTrack";
  const address = settings?.address || "";
  const phone = settings?.phone || "";
  const email = settings?.contactEmail || "";
  const logo = settings?.showLogoOnReceipt !== false ? settings?.logoDataUrl : null;
  const headerText = settings?.receiptHeader || "";
  const footerMessage = settings?.footerMessage || "Thank you for your purchase!";
  const currency = settings?.currency || "PHP";
  const showTaxBreakdown = settings?.showTaxBreakdown !== false;
  const printSize = settings?.printSize === "58mm" ? "58mm" : "80mm";
  const pageWidthMm = printSize === "58mm" ? 58 : 80;

  const items = sale.items || [];
  const subtotal = sale.subtotal ?? items.reduce((s, it) => s + Number(it.subtotal ?? it.qty * it.unitPrice), 0);
  const discount = Number(sale.discount || 0);
  const vat = Number(sale.vat || 0);
  const deliveryFee = Number(sale.deliveryFee || 0);
  const total = sale.totalAmount ?? subtotal - discount + vat + deliveryFee;

  const itemRows = items
    .map(
      (it) => `
      <tr>
        <td class="cell-name">${esc(it.name)}</td>
        <td class="cell-qty">${esc(it.qty)}</td>
        <td class="cell-price">${formatMoney(it.unitPrice ?? it.costPrice, currency)}</td>
        <td class="cell-total">${formatMoney(it.subtotal ?? it.qty * (it.unitPrice ?? it.costPrice), currency)}</td>
      </tr>`
    )
    .join("");

  const printWindow = window.open("", "_blank", "width=420,height=700");
  if (!printWindow) {
    alert("Please allow popups for printing.");
    return;
  }

  printWindow.document.write(`
    <html>
      <head>
        <title>Receipt ${esc(sale.saleNo || "")}</title>
        <style>
          @page { size: ${pageWidthMm}mm auto; margin: 0; }
          * { box-sizing: border-box; }
          body {
            font-family: 'Courier New', Consolas, monospace;
            width: ${pageWidthMm}mm;
            margin: 0 auto;
            padding: 10px 8px;
            color: #111827;
            font-size: ${pageWidthMm === 58 ? "10px" : "11px"};
          }
          .center { text-align: center; }
          .logo { max-width: 70%; max-height: 64px; object-fit: contain; margin-bottom: 6px; }
          .business-name { font-weight: 700; font-size: 1.15em; margin: 0; letter-spacing: 0.5px; }
          .business-meta { font-size: 0.85em; color: #374151; margin: 2px 0; line-height: 1.4; }
          .header-text { font-size: 0.9em; font-style: italic; margin: 4px 0; }
          hr { border: none; border-top: 1px dashed #9ca3af; margin: 8px 0; }
          .meta-row { display: flex; justify-content: space-between; font-size: 0.9em; margin: 2px 0; }
          table { width: 100%; border-collapse: collapse; margin-top: 6px; }
          th { text-align: left; font-size: 0.85em; border-bottom: 1px solid #111827; padding-bottom: 3px; }
          td { padding: 3px 0; font-size: 0.88em; vertical-align: top; }
          .cell-name { width: 46%; }
          .cell-qty { width: 12%; text-align: center; }
          .cell-price { width: 21%; text-align: right; }
          .cell-total { width: 21%; text-align: right; }
          .totals { margin-top: 8px; }
          .totals-row { display: flex; justify-content: space-between; font-size: 0.9em; padding: 1px 0; }
          .grand-total { font-weight: 700; font-size: 1.05em; border-top: 1px solid #111827; margin-top: 4px; padding-top: 4px; }
          .footer { text-align: center; margin-top: 14px; font-size: 0.85em; color: #374151; }
          .official-tag { text-align: center; font-size: 0.7em; color: #9ca3af; margin-top: 10px; letter-spacing: 0.5px; }
        </style>
      </head>
      <body>
        <div class="center">
          ${logo ? `<img src="${logo}" class="logo" alt="Logo" />` : ""}
          <p class="business-name">${esc(businessName)}</p>
          ${address ? `<p class="business-meta">${esc(address)}</p>` : ""}
          ${phone || email ? `<p class="business-meta">${[phone, email].filter(Boolean).map(esc).join(" · ")}</p>` : ""}
          ${headerText ? `<p class="header-text">${esc(headerText)}</p>` : ""}
        </div>

        <hr />

        <div class="meta-row"><span>Receipt No.</span><span>${esc(sale.saleNo || "—")}</span></div>
        <div class="meta-row"><span>Date</span><span>${esc(sale.datetime ? new Date(sale.datetime).toLocaleString() : new Date().toLocaleString())}</span></div>
        ${sale.cashierName ? `<div class="meta-row"><span>Cashier</span><span>${esc(sale.cashierName)}</span></div>` : ""}
        ${sale.customerName ? `<div class="meta-row"><span>Customer</span><span>${esc(sale.customerName)}</span></div>` : ""}
        ${sale.orderType ? `<div class="meta-row"><span>Type</span><span>${esc(sale.orderType)}</span></div>` : ""}

        <hr />

        <table>
          <thead>
            <tr>
              <th class="cell-name">Item</th>
              <th class="cell-qty">Qty</th>
              <th class="cell-price">Price</th>
              <th class="cell-total">Total</th>
            </tr>
          </thead>
          <tbody>${itemRows}</tbody>
        </table>

        <hr />

        <div class="totals">
          <div class="totals-row"><span>Subtotal</span><span>${formatMoney(subtotal, currency)}</span></div>
          ${discount > 0 ? `<div class="totals-row"><span>Discount</span><span>-${formatMoney(discount, currency)}</span></div>` : ""}
          ${showTaxBreakdown && vat > 0 ? `<div class="totals-row"><span>Tax${sale.taxRate ? ` (${(sale.taxRate * 100).toFixed(0)}%)` : ""}</span><span>${formatMoney(vat, currency)}</span></div>` : ""}
          ${deliveryFee > 0 ? `<div class="totals-row"><span>Delivery Fee</span><span>${formatMoney(deliveryFee, currency)}</span></div>` : ""}
          <div class="totals-row grand-total"><span>TOTAL</span><span>${formatMoney(total, currency)}</span></div>
          ${sale.amountCollected != null ? `<div class="totals-row"><span>Amount Paid</span><span>${formatMoney(sale.amountCollected, currency)}</span></div>` : ""}
          ${sale.changeDue != null ? `<div class="totals-row"><span>Change</span><span>${formatMoney(sale.changeDue, currency)}</span></div>` : ""}
        </div>

        <div class="footer">${esc(footerMessage)}</div>
        <div class="official-tag">This serves as your official receipt · Powered by GasTrack</div>

        <script>
          window.onload = function () {
            window.print();
            window.close();
          };
        <\/script>
      </body>
    </html>
  `);
  printWindow.document.close();
}