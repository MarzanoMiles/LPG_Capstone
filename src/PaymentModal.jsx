import React, { useEffect, useState } from "react";
import "./PaymentModal.css";
import ReturnedCylindersModal from "./ReturnedCylindersModal";

function formatPeso(amount) {
  return `₱${amount.toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// PaymentModal
//
// Props:
// - isOpen: boolean, whether to render the modal
// - totalAmount: number, the amount due
// - onCancel: () => void
// - onConfirm: ({ amountCollected, changeDue, printReceipt }) => void
// ---------------------------------------------------------------------------

export default function PaymentModal({ isOpen, totalAmount, onCancel, onConfirm, paymentMethod, orderType = "Walk-in", referenceNo = "", onReferenceChange, allowCylinderReturn = false, cylinderProducts = [], warehouseName, isProcessing = false, error }) {
  const requiresReference = ["GCash", "Card", "Bank Transfer"].includes(paymentMethod);
  const [returned, setReturned] = useState("");
  const [showReturns, setShowReturns] = useState(false);
  const [returnItems, setReturnItems] = useState([]);
  const openReturns = () => {
    setShowReturns(true);
  };
  const [amountCollected, setAmountCollected] = useState("");
  const [printReceipt, setPrintReceipt] = useState(false);

  // Reset fields each time the modal is opened for a new transaction
  useEffect(() => {
    if (isOpen) {
      setAmountCollected("");
      setPrintReceipt(false);
      setReturned("");
      setReturnItems([]);
      setShowReturns(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const collected = parseFloat(amountCollected) || 0;
  const changeDue = collected - totalAmount;

  const handleOkay = () => {
    onConfirm({
      amountCollected: collected,
      changeDue,
      printReceipt,
      returnedCylinders: allowCylinderReturn && returned === "yes" ? returnItems.map((item) => ({ productId: item.productId, qty: Number(item.qty) })) : [],
    });
  };

  const canConfirm = collected >= totalAmount && totalAmount > 0 && (!requiresReference || referenceNo.trim().length > 0) && !isProcessing && (!allowCylinderReturn || returned === "no" || (returned === "yes" && returnItems.length > 0));

  if (showReturns) return <ReturnedCylindersModal items={returnItems} cylinderProducts={cylinderProducts} warehouseName={warehouseName}
    onCancel={()=>{setShowReturns(false);if(!returnItems.length)setReturned("");}}
    onConfirm={items=>{setReturnItems(items);setReturned("yes");setShowReturns(false);}} />;

  return (
    <div className="payment-modal-overlay" onClick={() => { if (!isProcessing) onCancel(); }}>
      <div className="payment-modal" onClick={(e) => e.stopPropagation()}>
        <div className="payment-modal-accent" />
        <h2 className="payment-modal-title">Payment</h2>

        <div className="payment-modal-row">
          <span className="payment-modal-label">Total Amount:</span>
          <span className="payment-modal-value">{formatPeso(totalAmount)}</span>
        </div>

        <div className="payment-modal-row">
          <span className="payment-modal-label">{orderType === "Pickup" ? "Amount Collected:" : "Amount to Collect:"}</span>
          <input
            type="number"
            inputMode="decimal"
            placeholder="Enter amount"
            className="payment-modal-input"
            value={amountCollected}
            onChange={(e) => setAmountCollected(e.target.value)}
            autoFocus
          />
        </div>

        {requiresReference && (
          <div className="payment-modal-row">
            <label className="payment-modal-label" htmlFor="payment-reference">Reference No.:</label>
            <input id="payment-reference" type="text" className="payment-modal-input" maxLength={50}
              placeholder="Enter reference number" value={referenceNo}
              onChange={(e) => onReferenceChange(e.target.value)} disabled={isProcessing} required />
          </div>
        )}

        {!["Pickup", "Delivery"].includes(orderType) && <div className="payment-modal-row">
          <span className="payment-modal-label payment-modal-label-danger">Change Due:</span>
          <span className="payment-modal-value payment-modal-value-danger">
            {formatPeso(Math.max(changeDue, 0))}
          </span>
        </div>}

        {allowCylinderReturn && <div className="cylinder-return-section">
          <div className="cylinder-return-question" role="group" aria-label="Empty Cylinder Returned?">
          <span>Empty Cylinder Returned?</span>
          <label><input type="radio" name="empty-cylinder-returned" checked={returned === "yes"} onChange={() => { setReturned("yes"); openReturns(); }} disabled={isProcessing} /> Yes</label>
          <label><input type="radio" name="empty-cylinder-returned" checked={returned === "no"} onChange={() => { setReturned("no"); setReturnItems([]); }} disabled={isProcessing} /> No</label>
          </div>
          {returned === "yes" && returnItems.length > 0 && <button type="button" className="return-edit-btn" onClick={openReturns} disabled={isProcessing}>Edit returned cylinders</button>}
        </div>}
        {error && <p role="alert" style={{ color: "#dc2626" }}>{error}</p>}
        <label className="payment-modal-checkbox">
          <input
            type="checkbox"
            checked={printReceipt}
            onChange={(e) => setPrintReceipt(e.target.checked)}
          />
          <span>Print Receipt</span>
        </label>

        <div className="payment-modal-actions">
          <button type="button" className="payment-modal-btn cancel" onClick={() => { if (!isProcessing) onCancel(); }}>
            Cancel
          </button>
          <button
            type="button"
            className="payment-modal-btn confirm"
            onClick={handleOkay}
            disabled={!canConfirm}
          >
            {isProcessing ? "Processing?" : "Okay"}
          </button>
        </div>
      </div>
    </div>
  );
}
