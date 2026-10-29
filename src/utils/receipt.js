import { apiRequest } from "../api";

let cachedSettings = null;
let cacheTime = 0;

// Settings rarely change mid-session, so cache for a minute to avoid refetching on every print.
export function clearReceiptSettingsCache() {
  cachedSettings = null;
  cacheTime = 0;
}

async function getSettings({ forceRefresh = false } = {}) {
  const now = Date.now();
  if (!forceRefresh && cachedSettings && now - cacheTime < 60000) return cachedSettings;
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

export const DEFAULT_RECEIPT_HEADER = `GLORIOUS COMMERCIAL EXPORTS, INCORPORATED
#266 F. Blumentritt St., Batis 1500 City of San Juan
NCR, Second District, Philippines
VAT Reg. TIN: 000-315-874-00002`;

export function buildReceiptHtml(sale, settings = {}) {
  settings = settings || {};
  const money = (value) => Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const row = (label, value, cls = "") => `<div class="row ${cls}"><span>${esc(label)}</span><span>${esc(value)}</span></div>`;
  const amount = (label, value, cls) => row(label, `PHP ${money(value)}`, cls);
  const type = sale.orderType || sale.type || "Walk-in";
  const delivery = type === "Delivery";
  const details = (delivery ? sale.deliveryDetails : sale.pickupDetails) || {};
  const method = sale.paymentMethod || "Cash";
  const cod = delivery && /^(Cash on Delivery(?: \(COD\))?|COD)$/i.test(method) && !sale.completed;
  const slip = cod || sale.documentType === "slip";
  const title = slip ? (delivery ? "DELIVERY SLIP" : "ORDER SLIP") : "SALES INVOICE";
  const items = sale.items || [];
  const subtotal = Number(sale.subtotal ?? items.reduce((sum, it) => sum + Number(it.subtotal ?? it.qty * (it.unitPrice ?? it.costPrice)), 0));
  const discount = Number(sale.discount || 0);
  const totalSales = subtotal - discount;
  const rate = Number(sale.taxRate ?? (settings.taxEnabled === false ? 0 : Number(settings.taxRate ?? 12) / 100));
  const vat = Number(sale.vat ?? totalSales * rate / (1 + rate));
  const fee = delivery ? Number(sale.deliveryFee || 0) : 0;
  const total = Number(sale.totalAmount ?? totalSales + fee);
  const paid = sale.amountCollected ?? sale.amountPaid;
  const date = new Date(sale.datetime || sale.date || Date.now());
  const dateText = `${date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "Asia/Manila" })} | ${date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Manila" })}`;
  const blankRow = (label) => `<div class="row meta"><span>${esc(label)}</span><span class="blank-line"></span></div>`;
  const header = settings.receiptHeader?.trim() || DEFAULT_RECEIPT_HEADER;
  const width = settings.printSize === "58mm" ? 58 : 80;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)} ${esc(sale.saleNo || sale.orderNo || "")}</title>
  <style>
  @page { size: ${width}mm auto; margin: 0; }
  * { box-sizing: border-box; } body { width: ${width}mm; margin: 0 auto; padding: 4mm 3mm; color: #000; font: ${width === 58 ? 9 : 11}px 'Courier New', monospace; }
  header, footer, h1 { text-align: center; } header { white-space: pre-wrap; overflow-wrap: anywhere; } h1 { font-size: 1.15em; margin: 16px 0 8px; }
  hr { border: 0; border-top: 3px double #000; margin: 8px 0; }
  hr.customer-divider { border-top: 1px solid #000; }
  .meta .blank-line { border-bottom: 1px solid #000; align-self: end; min-height: 1em; }
  .row { display: flex; justify-content: space-between; gap: 8px; margin: 4px 0; } .row span:last-child { text-align: right; overflow-wrap: anywhere; min-width: 0; }
  .meta { display: grid; grid-template-columns: 17ch minmax(0, 1fr); gap: 2px; margin: 4px 0; } .meta span:last-child { text-align: left; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; } th, td { padding: 4px 1px; text-align: right; vertical-align: top; overflow-wrap: anywhere; } th:first-child, td:first-child { width: 40%; text-align: left; } th:nth-child(2) { width: 10%; } th { border-bottom: 1px dashed; } .strong { font-weight: bold; } footer { margin-top: 16px; white-space: pre-wrap; }
  </style></head><body><header>${esc(header)}</header><h1>${title}</h1><hr>
  ${slip ? `${delivery ? row("Delivery No :", sale.deliveryNo || sale.drNo || "?", "meta") : ""}${row("Order Ref No. :", sale.saleNo || sale.orderNo || "?", "meta")}` : row("Sales No :", sale.saleNo || "?", "meta")}
  ${row("Date & Time :", dateText, "meta")}${row("Transaction :", type, "meta")}${row("Cashier :", sale.cashierName || "?", "meta")}
  ${delivery ? `${row("Driver :", sale.driverName || details.riderName || "?", "meta")}${row("Vehicle Type :", sale.vehicleType || details.vehicleType || "?", "meta")}${!slip ? row("Delivery No :", sale.deliveryNo || sale.drNo || "?", "meta") : ""}` : ""}
  ${type === "Walk-in" ? (sale.customerId == null ? row("Customer Name :", " \u2014 ", "meta") : blankRow("Customer Name :")) : row("Customer Name :", sale.customerName || details.customerName || "?", "meta")}
  ${type !== "Walk-in" ? row("Contact No :", sale.customerPhone || details.contactNumber || "?", "meta") : ""}
  ${type === "Walk-in" ? blankRow("Address :") : row(delivery ? "Delivery Address:" : "Address :", sale.deliveryAddress || sale.customerAddress || details.address || "?", "meta")}
  ${delivery ? row("Delivery Notes :", sale.deliveryNotes || details.notes || details.instructions || "", "meta") : ""}
  ${delivery && sale.deliveryDistanceKm != null ? row("Distance :", `${sale.deliveryDistanceKm} km`, "meta") : ""}<hr class="customer-divider">
  <table><thead><tr><th>Item</th><th>Qty</th><th>Unit Price</th><th>Total</th></tr></thead><tbody>${items.map(it => `<tr><td>${esc(it.name)}</td><td>${esc(it.qty)}</td><td>${money(it.unitPrice ?? it.costPrice)}</td><td>${money(it.subtotal ?? it.qty * (it.unitPrice ?? it.costPrice))}</td></tr>`).join("")}</tbody></table>
  <hr>${row("Items Purchased:", items.reduce((sum, it) => sum + Number(it.qty || 0), 0))}<hr>
  ${amount("Subtotal (VAT Inclusive)", subtotal)}${amount("Less: Discount", discount)}${amount("Total Sales (VAT Inclusive)", totalSales)}
  ${settings.showTaxBreakdown !== false ? `${amount(`Less: VAT (${Math.round(rate * 100)}%)`, vat)}${amount("Amount Net of VAT", totalSales - vat)}` : ""}
  ${delivery ? row("Delivery Fee", fee > 0 ? `PHP ${money(fee)}` : "PHP 0.00 (FREE)") : ""}<hr>${amount("TOTAL AMOUNT DUE", total, "strong")}<hr>
  ${row("Payment Method", cod ? "Cash on Delivery (COD)" : method)}
  ${["GCash", "Card", "Bank Transfer"].includes(method) ? row("Reference No.", sale.referenceNo || "?") : ""}
  ${cod ? amount("Amount to Collect", total) : `${amount("Amount Paid", paid ?? total)}${amount("Change", sale.changeDue ?? Math.max(0, Number(paid ?? total) - total))}`}<hr>
  <footer>${slip ? "THIS IS NOT AN OFFICIAL SALES INVOICE." : esc(settings.footerMessage || "Thank you for your purchase!\nPlease come again and visit us.")}</footer></body></html>`;
}

// Prints via a hidden same-page iframe instead of window.open(). This is the
// key fix for printing not working on other devices/browsers: window.open()
// called after an `await` loses the "triggered by a real user click" status
// in most browsers (especially mobile Safari/Chrome), so it gets silently
// blocked as a popup. An iframe never opens a new window/tab at all, so
// there's nothing for a popup blocker to block — it works the same whether
// print() runs synchronously or after an async fetch.
function printViaIframe(html) {
  return new Promise((resolve, reject) => {
    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    iframe.setAttribute("aria-hidden", "true");
    document.body.appendChild(iframe);

    const cleanup = () => {
      // Give the print dialog time to actually open before we rip the iframe out —
      // removing it too early can silently cancel printing on some mobile browsers.
      setTimeout(() => {
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
        resolve();
      }, 1000);
    };

    iframe.onload = () => {
      try {
        const win = iframe.contentWindow;
        const doc = win.document;
        const images = Array.from(doc.images || []);

        const waitForImages = Promise.all(
          images.map(
            (img) =>
              new Promise((resolve) => {
                if (img.complete) return resolve();
                img.onload = () => resolve();
                img.onerror = () => resolve();
              })
          )
        );

        waitForImages.finally(() => {
          win.focus();
          // Some mobile browsers need a tick after focus before print() reliably opens the dialog.
          setTimeout(() => {
            try {
              win.print();
            } catch (err) {
              reject(err);
            }
            cleanup();
          }, 150);
        });
      } catch (err) {
        reject(err);
        cleanup();
      }
    };

    const doc = iframe.contentWindow.document;
    doc.open();
    doc.write(html);
    doc.close();
  });
}

/**
 * Prints a branded receipt using the company's saved logo, header, footer and
 * print-size settings. Falls back gracefully (opens a new tab with the receipt
 * so the user can still print/share manually) if in-page printing isn't
 * supported at all in the current browser.
 *
 * @param {object} sale - { saleNo, datetime, cashierName, customerName, orderType,
 *                          items: [{ name, qty, unitPrice, subtotal }],
 *                          subtotal, discount, vat, taxRate, deliveryFee, totalAmount }
 */
export async function getReceiptHtml(sale) {
  const settings = await getSettings({ forceRefresh: true });
  return buildReceiptHtml(sale, settings);
}

export async function printReceiptHtml(html) {
  try {
    await printViaIframe(html);
  } catch (err) {
    console.error("In-page print failed, falling back to a new tab:", err);
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
}

export async function printReceipt(sale) {
  return printReceiptHtml(await getReceiptHtml(sale));
}

