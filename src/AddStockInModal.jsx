import React, { useEffect, useState } from "react";
import "./AddStockInModal.css";
import { apiRequest } from "./api";

export default function AddStockInModal({ isOpen, onClose, onSuccess }) {
  const [warehouses, setWarehouses] = useState([]);
  const [products, setProducts] = useState([]);
  const [warehouseId, setWarehouseId] = useState("");
  const [referenceNo, setReferenceNo] = useState("");
  const [remarks, setRemarks] = useState("");
  const [items, setItems] = useState([{ productId: "", quantity: "" }]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    setError("");
    Promise.all([apiRequest("/warehouses"), apiRequest("/products?status=Active")])
      .then(([warehouseData, productData]) => {
        setWarehouses(warehouseData);
        setProducts(productData);
        if (warehouseData[0]) setWarehouseId(warehouseData[0].id);
      })
      .catch((err) => setError(err.message || "Failed to load warehouses/products."));
  }, [isOpen]);

  if (!isOpen) return null;

  const productMap = Object.fromEntries(products.map((p) => [p.productId, p]));

  const updateItem = (index, field, value) => {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, [field]: value } : it)));
  };

  const addItemRow = () => setItems((prev) => [...prev, { productId: "", quantity: "" }]);
  const removeItemRow = (index) => setItems((prev) => prev.filter((_, i) => i !== index));

  const validItems = items.filter((it) => it.productId && Number(it.quantity) > 0);
  const totalItems = validItems.reduce((sum, it) => sum + Number(it.quantity), 0);
  const estimatedCost = validItems.reduce((sum, it) => {
    const p = productMap[it.productId];
    return sum + (p ? Number(p.costPrice) * Number(it.quantity) : 0);
  }, 0);

  const resetAndClose = () => {
    setItems([{ productId: "", quantity: "" }]);
    setReferenceNo("");
    setRemarks("");
    setError("");
    onClose();
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!warehouseId) return setError("Please select a warehouse.");
    if (!validItems.length) return setError("Add at least one item with a product and quantity.");

    setIsSubmitting(true);
    setError("");
    try {
      await apiRequest("/inventory/stock-in", {
        method: "POST",
        body: JSON.stringify({
          warehouseId,
          referenceNo: referenceNo || null,
          remarks: remarks || null,
          items: validItems.map((it) => ({
            productId: Number(it.productId),
            quantity: Number(it.quantity),
          })),
        }),
      });
      onSuccess?.();
      resetAndClose();
    } catch (err) {
      setError(err.message || "Failed to record stock in.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-container">
        <h2 className="modal-title">Add Stock In</h2>

        {error && <p style={{ color: "#dc2626", fontWeight: 600, marginTop: -8 }}>{error}</p>}

        <div className="form-grid">
          <div className="form-row">
            <span className="form-label">Warehouse</span>
            <span className="form-colon">:</span>
            <select className="form-select" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
              <option value="" disabled>Select warehouse</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          </div>

          <div className="form-row">
            <span className="form-label">Invoice/Ref No</span>
            <span className="form-colon">:</span>
            <input
              type="text"
              className="form-input"
              placeholder="INV-001"
              value={referenceNo}
              onChange={(e) => setReferenceNo(e.target.value)}
            />
          </div>

          <div className="form-row">
            <span className="form-label">Remarks</span>
            <span className="form-colon">:</span>
            <input
              type="text"
              className="form-input"
              placeholder="Optional notes"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
            />
          </div>
        </div>

        {/* Items Section Header */}
        <div className="items-section-header">
          <h3 className="items-title">Items</h3>
          <button type="button" className="btn-add-item" onClick={addItemRow}>Add Item</button>
        </div>

        {/* Items Table */}
        <div className="modal-table-wrap">
          <table className="modal-table">
            <thead>
              <tr>
                <th className="text-center">#</th>
                <th>Product</th>
                <th className="text-center">Qty</th>
                <th className="text-right">Cost Price</th>
                <th className="text-right">Subtotal</th>
                <th className="text-center"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, index) => {
                const product = productMap[item.productId];
                const subtotal = product && item.quantity ? product.costPrice * Number(item.quantity) : 0;
                return (
                  <tr key={index}>
                    <td className="text-center">{index + 1}</td>
                    <td>
                      <select
                        value={item.productId}
                        onChange={(e) => updateItem(index, "productId", e.target.value)}
                        style={{ width: "100%", padding: "6px 8px" }}
                      >
                        <option value="">Select product</option>
                        {products.map((p) => (
                          <option key={p.productId} value={p.productId}>{p.name}</option>
                        ))}
                      </select>
                    </td>
                    <td className="text-center">
                      <input
                        type="number"
                        min="1"
                        value={item.quantity}
                        onChange={(e) => updateItem(index, "quantity", e.target.value)}
                        style={{ width: 70, padding: "6px 8px", textAlign: "center" }}
                      />
                    </td>
                    <td className="text-right">{product ? `₱ ${Number(product.costPrice).toFixed(2)}` : "—"}</td>
                    <td className="text-right">{`₱ ${subtotal.toFixed(2)}`}</td>
                    <td className="text-center">
                      <button
                        type="button"
                        onClick={() => removeItemRow(index)}
                        style={{ background: "none", border: "none", color: "#d90429", cursor: "pointer", fontWeight: 700 }}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Totals Summary */}
        <div className="modal-summary">
          <div className="summary-row">Total Items: {totalItems}</div>
          <div className="summary-row">Estimated Cost: ₱ {estimatedCost.toFixed(2)}</div>
        </div>

        {/* Action Buttons */}
        <div className="modal-actions">
          <button type="button" className="btn-cancel" onClick={resetAndClose}>Cancel</button>
          <button type="button" className="btn-received" onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting ? "Saving…" : "Received"}
          </button>
        </div>
      </div>
    </div>
  );
}