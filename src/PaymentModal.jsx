import React, { useEffect, useState } from "react";
import "./PaymentModal.css";
import { Plus, Trash2, Warehouse } from "lucide-react";

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

export default function PaymentModal({ isOpen, totalAmount, onCancel, onConfirm, paymentMethod, referenceNo = "", onReferenceChange, allowCylinderReturn = false, cylinderProducts = [], warehouseName, isProcessing = false, error }) {
  const requiresReference = ["GCash", "Card", "Bank Transfer"].includes(paymentMethod);
  const [returned, setReturned] = useState("");
  const [showReturns, setShowReturns] = useState(false);
  const [returnItems, setReturnItems] = useState([]);
  const [draftItems, setDraftItems] = useState([]);
  const openReturns = () => {
    setDraftItems(returnItems.length ? returnItems.map((item) => ({ ...item })) : [{ productId: "", qty: "" }]);
    setShowReturns(true);
  };
  const validReturns = draftItems.length > 0 && draftItems.every((item) => cylinderProducts.some((p) => p.id === item.productId) && /^\d+$/.test(String(item.qty)) && Number.isSafeInteger(Number(item.qty)) && Number(item.qty) > 0);
  const editReturn = (index, changes) => setDraftItems((items) => items.map((item, i) => i === index ? { ...item, ...changes } : item));
  const [amountCollected, setAmountCollected] = useState("");
  const [printReceipt, setPrintReceipt] = useState(false);

  // Reset fields each time the modal is opened for a new transaction
  useEffect(() => {
    if (isOpen) {
      setAmountCollected("");
      setPrintReceipt(false);
      setReturned("");
      setReturnItems([]);
      setDraftItems([]);
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

  if (showReturns) return (
    <div className="payment-modal-overlay">
      <div className="payment-modal cylinder-return-modal" role="dialog" aria-modal="true" aria-label="Returned Empty Cylinders">
        <div className="return-header">
          <h2 className="payment-modal-title">Returned Empty Cylinders</h2>
          <p className="return-description">Select the cylinders returned by the customer and enter their quantities.</p>
          <div className="return-warehouse"><Warehouse size={16} /><span>Return to <strong>{warehouseName || "Selected warehouse"}</strong></span></div>
        </div>
        <div className="return-toolbar">
          <span>{draftItems.length} {draftItems.length === 1 ? "product row" : "product rows"}</span>
          <button type="button" className="payment-modal-btn confirm" disabled={!cylinderProducts.length} onClick={() => setDraftItems((items) => [...items, { productId: "", qty: "" }])}><Plus size={16} /> Add Item</button>
        </div>
        <div className="return-table-wrap"><table className="return-table"><thead><tr><th>Product</th><th>Brand</th><th>Weight</th><th>Qty</th><th><span className="return-sr-only">Actions</span></th></tr></thead>
          <tbody>{draftItems.map((item, index) => {
            const product = cylinderProducts.find((p) => p.id === item.productId);
            return <tr key={index}>
              <td data-label="Product"><select aria-label={`Product ${index + 1}`} value={item.productId} onChange={(e) => editReturn(index, { productId: e.target.value })}><option value="">Select cylinder</option>{cylinderProducts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></td>
              <td data-label="Brand"><select aria-label={`Brand ${index + 1}`} disabled={!product} value={product?.brand || ""}><option value={product?.brand || ""}>{product?.brand || "Select product first"}</option></select></td>
              <td data-label="Weight"><select aria-label={`Weight ${index + 1}`} disabled={!product} value={product?.unitValue || ""}><option value={product?.unitValue || ""}>{product ? (product.unitValue || "Unit Value not set") : "Select product first"}</option></select></td>
              <td data-label="Qty"><input placeholder="0" aria-label={`Quantity ${index + 1}`} type="text" inputMode="numeric" pattern="[0-9]*" value={item.qty} onChange={(e) => { if (/^\d*$/.test(e.target.value)) editReturn(index, { qty: e.target.value }); }} /></td>
              <td className="return-row-action"><button className="return-remove-btn" type="button" aria-label={`Remove item ${index + 1}`} onClick={() => setDraftItems((items) => items.filter((_, i) => i !== index))}><Trash2 size={17} /></button></td>
            </tr>;
          })}</tbody></table></div>
        {!cylinderProducts.length && <p className="return-empty" role="status">No cylinder products are available for this warehouse.</p>}
        {!draftItems.length && <p className="return-empty">Click Add Item to select a returned cylinder.</p>}
        <div className="return-summary"><span>Total Items</span><strong>{draftItems.reduce((sum, item) => sum + Number(item.qty || 0), 0)}</strong></div>
        <p className="return-note">Stock will be updated in the warehouse shown above when payment is completed.</p>
        <div className="payment-modal-actions return-actions">
          <button type="button" className="payment-modal-btn cancel" onClick={() => { setShowReturns(false); if (!returnItems.length) setReturned(""); }}>Cancel</button>
          <button type="button" className="payment-modal-btn confirm" disabled={!validReturns} onClick={() => { setReturnItems(draftItems.map((item) => ({ ...item }))); setReturned("yes"); setShowReturns(false); }}>Okay</button>
        </div>
      </div>
    </div>
  );

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
          <span className="payment-modal-label">Amount Collected:</span>
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

        <div className="payment-modal-row">
          <span className="payment-modal-label payment-modal-label-danger">Change Due:</span>
          <span className="payment-modal-value payment-modal-value-danger">
            {formatPeso(Math.max(changeDue, 0))}
          </span>
        </div>

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
