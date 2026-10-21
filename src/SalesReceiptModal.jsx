import React, { useEffect, useState } from "react";
import { Printer, X } from "lucide-react";
import { getReceiptHtml, printReceiptHtml } from "./utils/receipt";
import "./SalesReceiptModal.css";

export default function SalesReceiptModal({ isOpen, sale, onClose }) {
  const [html, setHtml] = useState("");
  const [error, setError] = useState("");
  const [isPrinting, setIsPrinting] = useState(false);

  useEffect(() => {
    if (!isOpen || !sale) return;
    let active = true;
    setHtml("");
    setError("");
    getReceiptHtml(sale)
      .then((result) => { if (active) setHtml(result); })
      .catch((err) => { if (active) setError(err.message || "Failed to build the receipt."); });
    return () => { active = false; };
  }, [isOpen, sale]);

  if (!isOpen || !sale) return null;

  const handlePrint = async () => {
    setIsPrinting(true);
    try { await printReceiptHtml(html); }
    finally { setIsPrinting(false); }
  };

  return (
    <div className="sales-receipt-overlay" onClick={onClose}>
      <div className="sales-receipt-modal" role="dialog" aria-modal="true" aria-label="Receipt" onClick={(e) => e.stopPropagation()}>
        <div className="sales-receipt-header">
          <h2>Receipt</h2>
          <button type="button" className="sales-receipt-close" aria-label="Close receipt" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        {error && <p className="sales-receipt-error" role="alert">{error}</p>}
        {!error && !html && <p className="sales-receipt-loading">Loading receipt…</p>}
        {html && <iframe className="sales-receipt-frame" title={`Receipt ${sale.saleNo || ""}`} srcDoc={html} sandbox="" />}

        <div className="sales-receipt-actions">
          <button type="button" className="sales-receipt-btn secondary" onClick={onClose}>Close</button>
          <button type="button" className="sales-receipt-btn primary" onClick={handlePrint} disabled={!html || isPrinting}>
            <Printer size={16} /> {isPrinting ? "Printing…" : "Print Receipt"}
          </button>
        </div>
      </div>
    </div>
  );
}