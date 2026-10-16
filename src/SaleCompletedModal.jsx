import { useEffect, useRef } from "react";
import "./PaymentModal.css";

export default function SaleCompletedModal({ sale, onClose }) {
  const dialogRef = useRef(null);

  useEffect(() => {
    if (sale) dialogRef.current?.showModal();
    else dialogRef.current?.close();
  }, [sale]);

  return (
    <dialog ref={dialogRef} className="payment-modal sale-completed-modal" aria-labelledby="sale-completed-title" aria-describedby="sale-completed-message" onCancel={onClose}>
      <div className="payment-modal-accent" />
      <h2 id="sale-completed-title" className="payment-modal-title">Sale completed</h2>
      <p id="sale-completed-message" className="sale-completed-message">
        Sale {sale?.saleNo} completed. Change due: ₱{Number(sale?.changeDue ?? 0).toFixed(2)}
      </p>
      <div className="payment-modal-actions">
        <button type="button" className="payment-modal-btn confirm" onClick={onClose} autoFocus>Okay</button>
      </div>
    </dialog>
  );
}
