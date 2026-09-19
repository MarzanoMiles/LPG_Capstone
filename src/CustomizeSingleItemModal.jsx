import React, { useEffect, useState } from "react";
import "./CustomizeSingleItemModal.css";
import { apiRequest } from "./api";

export default function CustomizeSingleItemModal({ isOpen, onClose, selectedItem, onSaved }) {
  const [preferredQty, setPreferredQty] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (selectedItem) {
      setPreferredQty(selectedItem.suggestedQty);
      setError("");
    }
  }, [selectedItem]);

  if (!isOpen || !selectedItem) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    const qty = Number(preferredQty);
    if (!qty || qty <= 0) {
      setError("Preferred quantity must be a positive number.");
      return;
    }

    setIsSubmitting(true);
    setError("");
    try {
      await apiRequest(`/restocking/${selectedItem.restockId}`, {
        method: "PUT",
        body: JSON.stringify({ recommendedQuantity: qty }),
      });
      onSaved?.();
      onClose();
    } catch (err) {
      setError(err.message || "Failed to update recommendation.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="single-item-modal-overlay">
      <div className="single-item-modal-card">
        <h2 className="single-item-modal-title">Customize Restock Quantity</h2>

        {error && <p style={{ color: "#dc2626", fontWeight: 600, marginTop: -8 }}>{error}</p>}

        <form onSubmit={handleSubmit} className="single-item-form-grid">
          <div className="single-item-row">
            <div className="single-item-field">
              <label>Restock ID</label>
              <input type="text" value={`R-${String(selectedItem.restockId).padStart(3, "0")}`} disabled />
            </div>
            <div className="single-item-field">
              <label>Product</label>
              <input type="text" value={selectedItem.productName} disabled />
            </div>
          </div>

          <div className="single-item-row">
            <div className="single-item-field">
              <label>Current Stock</label>
              <input type="text" value={selectedItem.currentStock} disabled />
            </div>
            <div className="single-item-field">
              <label>Reorder Level</label>
              <input type="text" value={selectedItem.reorderLevel} disabled />
            </div>
          </div>

          <div className="single-item-field">
            <label>Preferred Order Quantity</label>
            <input
              type="number"
              min="1"
              value={preferredQty}
              onChange={(e) => setPreferredQty(e.target.value)}
              placeholder="Enter Number"
            />
          </div>

          {/* Footer Actions */}
          <div className="single-item-modal-actions">
            <button type="button" className="btn-single-cancel" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-single-save" disabled={isSubmitting}>
              {isSubmitting ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}