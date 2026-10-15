import React from "react";
import "./SalesInfoModal.css";

function formatPeso(amount) {
  return `₱ ${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ---------------------------------------------------------------------------
// SalesInfoModal
//
// Props:
// - isOpen: boolean
// - sale: the sale record to display (expects items[], cashierName, etc.)
// - storeName: string
// - onClose: () => void
// ---------------------------------------------------------------------------

export default function SalesInfoModal({ isOpen, sale, storeName = "Store Name", onClose }) {
  if (!isOpen || !sale) return null;

  const items = sale.items || [];
  const subtotal = items.reduce((sum, item) => sum + item.qty * item.costPrice, 0);
  const vat = subtotal * 0.12;
  const discount = sale.discount || 0;
  const total = subtotal + vat - discount;

  return (
    <div className="sales-info-overlay" onClick={onClose}>
      <div className="sales-info-modal" onClick={(e) => e.stopPropagation()}>
        <h2 className="sales-info-title">Sales Information</h2>

        <div className="sales-info-store">
          <p className="sales-info-store-name">{storeName}</p>
          <p className="sales-info-store-sub">Sales</p>
        </div>

        <div className="sales-info-meta">
          <div className="sales-info-meta-row">
            <span className="meta-label">Sales ID:</span>
            <span className="meta-value">{sale.id}</span>
          </div>
          <div className="sales-info-meta-row">
            <span className="meta-label">Date:</span>
            <span className="meta-value">{sale.datetime}</span>
          </div>
          <div className="sales-info-meta-row">
            <span className="meta-label">Cashier:</span>
            <span className="meta-value">{sale.cashierName || sale.cashier}</span>
          </div>
          <div className="sales-info-meta-row">
            <span className="meta-label">Customer:</span>
            <span className="meta-value">{sale.customerId == null ? " \u2014 " : (sale.customerName || " \u2014 ")}</span>
          </div>
          <div className="sales-info-meta-row">
            <span className="meta-label">Order ID:</span>
            <span className="meta-value">{sale.orderId}</span>
          </div>
        </div>

        <h3 className="sales-info-section">Items</h3>
        <div className="sales-info-items">
          <div className="items-header">
            <span className="col-product">Product Name</span>
            <span className="col-qty">Qty</span>
            <span className="col-price">Cost Price</span>
            <span className="col-subtotal">Subtotal</span>
          </div>
          {items.length === 0 ? (
            <p className="items-empty">No items recorded for this sale.</p>
          ) : (
            items.map((item, i) => (
              <div className="items-row" key={i}>
                <span className="col-product">{item.name}</span>
                <span className="col-qty">{item.qty}</span>
                <span className="col-price">{formatPeso(item.costPrice)}</span>
                <span className="col-subtotal">{formatPeso(item.qty * item.costPrice)}</span>
              </div>
            ))
          )}
        </div>

        <h3 className="sales-info-section">Total Summary</h3>
        <div className="sales-info-totals">
          <div className="totals-row">
            <span>Subtotal:</span>
            <span>{formatPeso(subtotal)}</span>
          </div>
          <div className="totals-row">
            <span>VAT (12%):</span>
            <span>{formatPeso(vat)}</span>
          </div>
          <div className="totals-row">
            <span>Discount:</span>
            <span>{formatPeso(discount)}</span>
          </div>
          <div className="totals-row totals-final">
            <span>TOTAL AMOUNT:</span>
            <span>{formatPeso(total)}</span>
          </div>
        </div>

        <button type="button" className="sales-info-close" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
