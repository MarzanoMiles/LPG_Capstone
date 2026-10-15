import InventoryItemSelector from "./InventoryItemSelector";
import React, { useEffect, useState } from "react";
import "./AddStockInModal.css";
import { apiRequest } from "./api";
import { filterVisibleWarehouses } from "./utils/warehouseFilters";

const STOCK_IN_REASONS = ["Supplier Delivery", "Customer Return", "Inventory Adjustments", "Other"];

export default function AddStockInModal({ isOpen, onClose, onSuccess }) {
  const [warehouses, setWarehouses] = useState([]);
  const [products, setProducts] = useState([]);
  const [warehouseStockRows, setWarehouseStockRows] = useState([]);
  const [isLoadingStock, setIsLoadingStock] = useState(true);
  const [warehouseId, setWarehouseId] = useState("");
  const [referenceNo, setReferenceNo] = useState("");
  const [reason, setReason] = useState("Supplier Delivery");
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
        setWarehouses(visibleWarehouses);
        setProducts(productData);
        if (visibleWarehouses[0]) setWarehouseId(visibleWarehouses[0].id);
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

  const showCosts = reason === "Supplier Delivery";
  const stockByProduct = new Map(warehouseStockRows.map((row) => [String(row.productId), Number(row.currentStock || 0)]));
  const currentStock = (productId) => stockByProduct.get(String(productId)) || 0;
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
    setReason("Supplier Delivery");
    setOtherReason("");
    setRemarks("");
    setError("");
    onClose();
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const normalizedReferenceNo = referenceNo.trim();
    const normalizedOtherReason = otherReason.trim();
    const normalizedRemarks = remarks.trim();

    if (isSubmitting || isLoadingStock) return;
    if (!warehouseId) return setError("Please select a warehouse.");
    if (reason === "Supplier Delivery" && !normalizedReferenceNo) return setError("Reference ID is required for Supplier Delivery.");
    if (!reason) return setError("Please select a reason.");
    if (reason === "Other" && !normalizedOtherReason) {
      return setError("Please provide details when Other reason is selected.");
    }
    if (items.some((item) => !item.productId || !Number.isSafeInteger(Number(item.quantity)) || Number(item.quantity) <= 0)) return setError("Complete every item with a product and a positive whole-number quantity.");
    if (!validItems.length) return setError("Add at least one item with a product and quantity.");

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
      await apiRequest("/inventory/stock-in", {
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
      setError(err.message || "Failed to record stock in.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay">
      <form className="modal-container inventory-movement-modal" onSubmit={handleSubmit}>
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

          <div className="form-row form-row-top">
            <span className="form-label">Reason</span>
            <span className="form-colon">:</span>
            <div className="reason-options">
              {STOCK_IN_REASONS.map((option) => (
                <label key={option} className="reason-option">
                  <input
                    type="radio"
                    name="stock-in-reason"
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
            <span className="form-label">Reference ID {reason === "Supplier Delivery" ? "(required)" : "(optional)"}</span>
            <span className="form-colon">:</span>
            <input
              type="text"
              className="form-input"
              maxLength={50}
              placeholder={reason === "Supplier Delivery" ? "Reference ID" : "Optional reference ID"}
              required={reason === "Supplier Delivery"}
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
                <th>Category</th>
                <th>Brand</th>
                <th>Unit Value</th>
                <th>Product</th>
                <th className="text-center">Current Stock</th>
                <th className="text-center">Qty</th>
                <th className="text-center">New Stock Level</th>
                {showCosts && <th className="text-right">Cost Price</th>}
                {showCosts && <th className="text-right">Subtotal</th>}
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
                    <InventoryItemSelector
                        products={products}
                        item={item}
                        rowNumber={index + 1}
                        onChange={(next) => setItems((previous) => previous.map((row, rowIndex) => rowIndex === index ? next : row))}
                      />
                    <td className="text-center">{item.productId ? (isLoadingStock ? "Loading?" : currentStock(item.productId)) : "-"}</td>
                    <td className="text-center">
                      <input
                        type="number"
                        min="1"
                        value={item.quantity}
                        onChange={(e) => updateItem(index, "quantity", e.target.value)}
                        style={{ width: 70, padding: "6px 8px", textAlign: "center" }}
                      />
                    </td>
                    <td className="text-center">{item.productId && item.quantity !== "" && Number(item.quantity) > 0 && !isLoadingStock ? currentStock(item.productId) + validItems.filter((row) => row.productId === item.productId).reduce((sum, row) => sum + Number(row.quantity), 0) : ""}</td>
                    {showCosts && <td className="text-right">{product ? `₱ ${Number(product.costPrice).toFixed(2)}` : "—"}</td>}
                    {showCosts && <td className="text-right">{`₱ ${subtotal.toFixed(2)}`}</td>}
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

        {/* Totals Summary */}
        <div className="modal-summary">
          <div className="summary-row">Total Items: {totalItems}</div>
          {showCosts && <div className="summary-row">Estimated Cost: ₱ {estimatedCost.toFixed(2)}</div>}
        </div>

        {/* Action Buttons */}
        <div className="modal-actions">
          <button type="button" className="btn-cancel" onClick={resetAndClose} disabled={isSubmitting}>Cancel</button>
          <button type="submit" className="btn-received" disabled={isSubmitting || isLoadingStock}>
            {isSubmitting ? "Saving…" : "Confirm"}
          </button>
        </div>
      </form>
    </div>
  );
}






