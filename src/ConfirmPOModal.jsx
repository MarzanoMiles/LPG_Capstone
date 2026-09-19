import React, { useState } from "react";
import "./ConfirmPOModal.css";

export default function ConfirmPOModal({ isOpen, onClose, onConfirm }) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  if (!isOpen) return null;

  const handleConfirm = async () => {
    setIsSubmitting(true);
    setError("");
    try {
      await onConfirm();
    } catch (err) {
      setError(err.message || "Failed to confirm purchase order.");
      setIsSubmitting(false);
    }
  };

  return (
    <div className="po-modal-overlay">
      <div className="po-modal-card">
        <h2 className="po-modal-title">
          Are you sure you want to confirm this purchase order?
        </h2>
        <p className="po-modal-description">
          Once confirmed, the purchase order will be submitted and sent to the supplier.
        </p>

        {error && <p style={{ color: "#dc2626", fontWeight: 600 }}>{error}</p>}

        <div className="po-modal-actions">
          <button className="po-modal-btn-cancel" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </button>
          <button className="po-modal-btn-confirm" onClick={handleConfirm} disabled={isSubmitting}>
            {isSubmitting ? "Confirming…" : "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}