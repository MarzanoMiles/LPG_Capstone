import React, { useEffect, useState } from "react";
import "./CustomizeRestockModal.css";
import { apiRequest } from "./api";

export default function CustomizeRestockModal({ isOpen, onClose, items, onApplied }) {
  const [rows, setRows] = useState([]); // [{restockId, productId, productName, suggestedQty, preferredQty, costPrice}]
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (isOpen) {
      setRows(
        items.map((it) => ({
          restockId: it.restockId,
          productId: it.productId,
          productName: it.productName,
          suggestedQty: it.suggestedQty,
          preferredQty: it.suggestedQty,
          costPrice: it.costPrice,
        }))
      );
      setError("");
    }
  }, [isOpen, items]);

  if (!isOpen) return null;

  const updateQty = (restockId, value) => {
    setRows((prev) => prev.map((r) => (r.restockId === restockId ? { ...r, preferredQty: value } : r)));
  };

  const handleApply = async () => {
    setIsSubmitting(true);
    setError("");
    try {
      await Promise.all(
        rows
          .filter((r) => Number(r.preferredQty) !== r.suggestedQty)
          .map((r) =>
            apiRequest(`/restocking/${r.restockId}`, {
              method: "PUT",
              body: JSON.stringify({ recommendedQuantity: Number(r.preferredQty) }),
            })
          )
      );
      onApplied?.();
      onClose();
    } catch (err) {
      setError(err.message || "Failed to apply changes.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const totalBudget = rows.reduce((sum, r) => sum + Number(r.preferredQty || 0) * Number(r.costPrice || 0), 0);

  return (
    <div className="customize-modal-overlay">
      <div className="customize-modal-card">
        <h2 className="customize-modal-title">Restocking Customize</h2>

        {error && <p style={{ color: "#dc2626", fontWeight: 600 }}>{error}</p>}

        <div className="customize-section-header">
          <h3 className="customize-section-title">Selected Items ({rows.length})</h3>
        </div>

        {/* Items Table */}
        <div className="customize-table-wrap">
          <table className="customize-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Product</th>
                <th>Suggested</th>
                <th>Preferred</th>
                <th>Est. Cost</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={5}>No items selected. Check items in the Restocking table first.</td></tr>
              )}
              {rows.map((row, idx) => (
                <tr key={row.restockId}>
                  <td>{idx + 1}</td>
                  <td>{row.productName}</td>
                  <td>{row.suggestedQty}</td>
                  <td>
                    <input
                      type="number"
                      min="1"
                      value={row.preferredQty}
                      onChange={(e) => updateQty(row.restockId, e.target.value)}
                      style={{ width: 70, padding: "4px 6px", textAlign: "center" }}
                    />
                  </td>
                  <td>₱ {(Number(row.preferredQty || 0) * Number(row.costPrice || 0)).toLocaleString("en-US", { minimumFractionDigits: 2 })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <hr className="customize-divider" />

        <div className="modal-summary" style={{ padding: 0 }}>
          <div className="summary-row" style={{ fontWeight: 700 }}>
            Estimated Total: ₱ {totalBudget.toLocaleString("en-US", { minimumFractionDigits: 2 })}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="customize-modal-actions">
          <button type="button" className="btn-modal-cancel" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn-modal-apply" onClick={handleApply} disabled={isSubmitting || rows.length === 0}>
            {isSubmitting ? "Applying…" : "Apply"}
          </button>
        </div>
      </div>
    </div>
  );
}