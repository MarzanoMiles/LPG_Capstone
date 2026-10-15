import React, { useEffect, useState } from "react";
import "./AddStockOutModal.css";
import { apiRequest } from "./api";
import { filterVisibleWarehouses } from "./utils/warehouseFilters";

const STOCK_OUT_REASONS = [
  "Damaged",
  "Defective",
  "Return to Supplier",
  "Expired/Unusable",
  "Inventory Adjustment",
  "Other",
];

export default function AddStockOutModal({ isOpen, onClose, onSuccess }) {
  const [warehouses, setWarehouses] = useState([]);
  const [products, setProducts] = useState([]);
  const [warehouseStockRows, setWarehouseStockRows] = useState([]);
  const [isLoadingStock, setIsLoadingStock] = useState(true);
  const [warehouseId, setWarehouseId] = useState("");
  const [referenceNo, setReferenceNo] = useState("");
  const [reason, setReason] = useState("Damaged");
  const [otherReason, setOtherReason] = useState("");
  const [remarks, setRemarks] = useState("");
  const [items, setItems] = useState([{ productId: "", quantity: "" }]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    setError("");
    Promise.all([apiRequest("/warehouses"), apiRequest("/products?status=Active")])
      .then(([warehouseData, productData]) => {
        const visibleWarehouses = filterVisibleWarehouses(warehouseData);
        const firstWarehouseId = visibleWarehouses[0]?.id || "";

        setWarehouses(visibleWarehouses);
        setProducts(productData);
        setWarehouseId(firstWarehouseId);

      })
      .catch((err) => setError(err.message || "Failed to load warehouses/products."));
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !warehouseId) return;
    let cancelled = false;
    setIsLoadingStock(true);
    setWarehouseStockRows([]);
    apiRequest(`/inventory?warehouseId=${encodeURIComponent(warehouseId)}`)
      .then((rows) => { if (!cancelled) { setWarehouseStockRows(rows); setIsLoadingStock(false); } })
      .catch((err) => { if (!cancelled) setError(err.message || "Failed to load stock levels."); });
    return () => { cancelled = true; };
  }, [isOpen, warehouseId]);

  if (!isOpen) return null;

  const productMap = Object.fromEntries(products.map((p) => [p.productId, p]));
  const stockByProduct = new Map(
    warehouseStockRows.map((row) => [String(row.productId), Number(row.currentStock || 0)])
  );

  const updateItem = (index, field, value) => {
    setItems((prev) => prev.map((it, i) => {
      if (i !== index) return it;
      if (field === "productId") return { ...it, productId: value, quantity: "" };
      if (field === "quantity") {
        if (value === "") return { ...it, quantity: "" };
        const quantity = Number(value);
        if (!Number.isSafeInteger(quantity) || quantity < 0) return it;
        const otherQty = prev.reduce((sum, row, rowIndex) => sum + (rowIndex !== index && row.productId === it.productId ? Number(row.quantity || 0) : 0), 0);
        const maximum = Math.max(0, getAvailableStock(it.productId) - otherQty);
        return { ...it, quantity: String(Math.min(quantity, maximum)) };
      }
      return { ...it, [field]: value };
    }));
  };

  const addItemRow = () => setItems((prev) => [...prev, { productId: "", quantity: "" }]);
  const removeItemRow = (index) => setItems((prev) => prev.filter((_, i) => i !== index));

  const validItems = items.filter((it) => it.productId && Number(it.quantity) > 0);
  const totalQty = validItems.reduce((sum, it) => sum + Number(it.quantity), 0);
  const getAvailableStock = (productId) => Number(stockByProduct.get(String(productId)) || 0);

  const resetAndClose = () => {
    setItems([{ productId: "", quantity: "" }]);
    setReferenceNo("");
    setReason("Damaged");
    setOtherReason("");
    setRemarks("");
    setError("");
    onClose();
  };

  const handleSubmit = async () => {
    const normalizedReferenceNo = referenceNo.trim();
    const normalizedOtherReason = otherReason.trim();
    const normalizedRemarks = remarks.trim();

    if (!warehouseId) return setError("Please select a warehouse.");
    if (!reason) return setError("Please select a reason.");
    if (reason === "Other" && !normalizedOtherReason) {
      return setError("Please provide details when Other reason is selected.");
    }
    if (isSubmitting || isLoadingStock) return;
    if (items.some((item) => !item.productId || !Number.isSafeInteger(Number(item.quantity)) || Number(item.quantity) <= 0)) return setError("Complete every item with a product and a positive whole-number quantity.");
    if (!validItems.length) return setError("Add at least one item with a product and quantity.");

    for (const it of validItems) {
      const p = productMap[it.productId];
      const availableStock = getAvailableStock(it.productId);
      if (validItems.filter((row) => row.productId === it.productId).reduce((sum, row) => sum + Number(row.quantity), 0) > availableStock) {
        return setError(`Cannot remove ${it.quantity} of "${p?.name || it.productId}" — only ${availableStock} in stock.`);
      }
    }

    const remarksParts = [];
    if (reason === "Other") {
      remarksParts.push(`Other reason: ${normalizedOtherReason}`);
    }
    if (normalizedRemarks) {
      remarksParts.push(normalizedRemarks);
    }

    setIsSubmitting(true);
    setError("");
    try {
      await apiRequest("/inventory/stock-out", {
        method: "POST",
        body: JSON.stringify({
          warehouseId,
          referenceNo: normalizedReferenceNo || null,
          reason,
          remarks: remarksParts.length ? remarksParts.join(" | ") : null,
          items: validItems.map((it) => ({
            productId: String(it.productId).trim(),
            quantity: Number(it.quantity),
          })),
        }),
      });
      onSuccess?.();
      resetAndClose();
    } catch (err) {
      setError(err.message || "Failed to record stock out.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-container inventory-movement-modal">
        <h2 className="modal-title">Add Stock Out</h2>

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

          <div className="form-row form-row-top">
            <span className="form-label">Reason</span>
            <span className="form-colon">:</span>
            <div className="reason-options">
              {STOCK_OUT_REASONS.map((option) => (
                <label key={option} className="reason-option">
                  <input
                    type="radio"
                    name="stock-out-reason"
                    checked={reason === option}
                    onChange={() => setReason(option)}
                  />
                  <span>{option}</span>
                </label>
              ))}
              {reason === "Other" && (
                <input
                  type="text"
                  className="form-input reason-other-input"
                  placeholder="Describe the reason or conditions..."
                  value={otherReason}
                  onChange={(e) => setOtherReason(e.target.value)}
                />
              )}
            </div>
          </div>

          <div className="form-row">
            <span className="form-label">Reference ID (optional)</span>
            <span className="form-colon">:</span>
            <input
              type="text"
              className="form-input"
              placeholder="Optional reference ID"
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
                <th className="text-center">Current Stock</th>
                <th className="text-center">Qty</th>
                <th className="text-center">New Stock Level</th>
                <th className="text-center"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, index) => {
                const product = productMap[item.productId];
                const availableStock = getAvailableStock(item.productId);
                const otherQty = items.reduce((sum, row, rowIndex) => sum + (rowIndex !== index && row.productId === item.productId ? Number(row.quantity || 0) : 0), 0);
                const maximumQty = Math.max(0, availableStock - otherQty);
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
                    <td className="text-center">{product && !isLoadingStock ? availableStock : "-"}</td>
                    <td className="text-center">
                      <input
                        type="number"
                        min="1"
                        max={maximumQty}
                        step="1"
                        disabled={!product || isLoadingStock || maximumQty === 0}
                        value={item.quantity}
                        onChange={(e) => updateItem(index, "quantity", e.target.value)}
                        style={{ width: 70, padding: "6px 8px", textAlign: "center" }}
                      />
                    </td>
                    <td className="text-center">{product && item.quantity !== "" && Number(item.quantity) > 0 && !isLoadingStock ? availableStock - validItems.filter((row) => row.productId === item.productId).reduce((sum, row) => sum + Number(row.quantity), 0) : ""}</td>
                    <td className="text-center">
                      <button
                        type="button"
                        onClick={() => removeItemRow(index)}
                        style={{ background: "none", border: "none", color: "#d90429", cursor: "pointer", fontWeight: 700 }}
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Totals & Notes Summary */}
        <div className="modal-summary">
          <div className="summary-row">Total Items: {totalQty}</div>
        </div>

        {/* Action Buttons */}
        <div className="modal-actions">
          <button type="button" className="btn-cancel" onClick={resetAndClose} disabled={isSubmitting}>Cancel</button>
          <button type="button" className="btn-approved" onClick={handleSubmit} disabled={isSubmitting || isLoadingStock}>
            {isSubmitting ? "Saving…" : "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}





