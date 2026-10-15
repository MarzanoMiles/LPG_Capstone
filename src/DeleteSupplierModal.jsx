import { useEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import "./AddSupplierModal.css";

export default function DeleteSupplierModal({ supplier, onClose, onConfirm }) {
  const dialog = useRef(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    dialog.current.showModal();
  }, []);

  const confirm = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setError("");
    try {
      await onConfirm(supplier);
      onClose();
    } catch (err) {
      setError(err.message || "Failed to delete supplier. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <dialog ref={dialog} className="supplier-modal-card supplier-delete-dialog"
      aria-labelledby="supplier-delete-title" aria-describedby="supplier-delete-description"
      onCancel={(event) => { event.preventDefault(); if (!isSubmitting) onClose(); }}>
      <div className="supplier-delete-icon"><Trash2 size={24} aria-hidden="true" /></div>
      <h2 id="supplier-delete-title" className="supplier-modal-title">Delete Supplier?</h2>
      <p className="supplier-delete-name">{supplier.name} <span>({supplier.id})</span></p>
      <p id="supplier-delete-description">Permanently delete this supplier? Linked records will retain supplier details. This cannot be undone.</p>
      {error && <p className="supplier-delete-error" role="alert">{error}</p>}
      <div className="supplier-modal-actions">
        <button type="button" className="btn-modal-cancel" onClick={onClose} disabled={isSubmitting} autoFocus>Cancel</button>
        <button type="button" className="btn-modal-submit supplier-delete-confirm" onClick={confirm} disabled={isSubmitting}>{isSubmitting ? "Deleting…" : "Delete Supplier"}</button>
      </div>
    </dialog>
  );
}
