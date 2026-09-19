import React, { useEffect, useState } from "react";
import "./StockAdjustmentModal.css";
import { apiRequest } from "./api";

export default function StockAdjustmentModal({ isOpen, onClose, onSuccess }) {
  const [warehouses, setWarehouses] = useState([]);
  const [warehouseId, setWarehouseId] = useState("");
  const [rows, setRows] = useState([]); // [{inventoryId, productId, productName, currentStock, newQuantity}]
  const [remarks, setRemarks] = useState("");
  const [isLoadingRows, setIsLoadingRows] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    setError("");
    apiRequest("/warehouses")
      .then((data) => {
        setWarehouses(data);
        if (data[0]) setWarehouseId(data[0].id);
      })
      .catch((err) => setError(err.message || "Failed to load warehouses."));
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !warehouseId) return;
    setIsLoadingRows(true);
    apiRequest(`/inventory?warehouseId=${warehouseId}`)
      .then((data) => {
        setRows(
          data.map((r) => ({
            inventoryId: r.inventoryId,
            productId: r.productId,
            productName: r.productName,
            currentStock: r.currentStock,
            newQuantity: r.currentStock,
          }))
        );
        setError("");
      })
      .catch((err) => setError(err.message || "Failed to load inventory for this warehouse."))
      .finally(() => setIsLoadingRows(false));
  }, [isOpen, warehouseId]);

  if (!isOpen) return null;

  const updateQuantity = (inventoryId, value) => {
    setRows((prev) =>
      prev.map((r) => (r.inventoryId === inventoryId ? { ...r, newQuantity: value } : r))
    );
  };

  const changedRows = rows.filter((r) => Number(r.newQuantity) !== r.currentStock);
  const totalAfter = rows.reduce((sum, r) => sum + Number(r.newQuantity || 0), 0);

  const resetAndClose = () => {
    setRemarks("");
    setError("");
    onClose();
  };

  const handleSubmit = async () => {
    if (!warehouseId) return setError("Please select a warehouse.");
    if (!changedRows.length) return setError("No quantities were changed.");

    setIsSubmitting(true);
    setError("");
    try {
      await apiRequest("/inventory/adjust", {
        method: "POST",
        body: JSON.stringify({
          warehouseId,
          remarks: remarks || null,
          items: changedRows.map((r) => ({
            productId: r.productId,
            newQuantity: Number(r.newQuantity),
          })),
        }),
      });
      onSuccess?.();
      resetAndClose();
    } catch (err) {
      setError(err.message || "Failed to save adjustments.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-container">
        <h2 className="modal-title">Stock Adjustment</h2>

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
            <span className="form-label">Remarks</span>
            <span className="form-colon">:</span>
            <input
              type="text"
              className="form-input"
              placeholder="e.g. Physical count correction"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
            />
          </div>
        </div>

        {/* Adjust Items Header */}
        <div className="items-section-header">
          <h3 className="items-title">Adjust Items</h3>
        </div>

        {/* Items Table */}
        <div className="modal-table-wrap">
          <table className="modal-table">
            <thead>
              <tr>
                <th className="text-center">#</th>
                <th>Product ID</th>
                <th>Product Name</th>
                <th className="text-center">Current Stock</th>
                <th className="text-center">New Quantity</th>
              </tr>
            </thead>
            <tbody>
              {isLoadingRows && (
                <tr><td colSpan={5} className="text-center">Loading…</td></tr>
              )}
              {!isLoadingRows && rows.length === 0 && (
                <tr><td colSpan={5} className="text-center">No inventory in this warehouse yet.</td></tr>
              )}
              {!isLoadingRows &&
                rows.map((row, index) => (
                  <tr key={row.inventoryId}>
                    <td className="text-center">{index + 1}</td>
                    <td>{row.productId}</td>
                    <td>{row.productName}</td>
                    <td className="text-center">{row.currentStock}</td>
                    <td className="text-center">
                      <input
                        type="number"
                        min="0"
                        value={row.newQuantity}
                        onChange={(e) => updateQuantity(row.inventoryId, e.target.value)}
                        style={{ width: 80, padding: "6px 8px", textAlign: "center" }}
                      />
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        {/* Totals Summary */}
        <div className="modal-summary">
          <div className="summary-row">Items Changed: {changedRows.length}</div>
          <div className="summary-row total">Total Stock After Adjustment: {totalAfter}</div>
        </div>

        {/* Action Buttons */}
        <div className="modal-actions">
          <button type="button" className="btn-cancel" onClick={resetAndClose}>Cancel</button>
          <button type="button" className="btn-adjust" onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting ? "Saving…" : "Adjust"}
          </button>
        </div>
      </div>
    </div>
  );
}