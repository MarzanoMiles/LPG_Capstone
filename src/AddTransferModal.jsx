import React, { useEffect, useMemo, useState } from "react";
import { apiRequest } from "./api";
import { filterVisibleWarehouses } from "./utils/warehouseFilters";
import "./AddStockOutModal.css";
import "./AddTransferModal.css";


export default function AddTransferModal({ isOpen, onClose, onSuccess }) {
  const [warehouses, setWarehouses] = useState([]);
  const [inventory, setInventory] = useState([]);

  const [fromWarehouseId, setFromWarehouseId] = useState("");
  const [toWarehouseId, setToWarehouseId] = useState("");
  const [remarks, setRemarks] = useState("");
  const [items, setItems] = useState([{ productId: "", quantity: "" }]);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  const loadModalData = async () => {
    const [warehouseRows, inventoryRows] = await Promise.all([
      apiRequest("/warehouses"),
      apiRequest("/inventory"),
    ]);

    const activeWarehouses = filterVisibleWarehouses(
      Array.isArray(warehouseRows)
        ? warehouseRows.filter((w) => String(w.status || "Active") === "Active")
        : []
    );

    setWarehouses(activeWarehouses);
    setInventory(Array.isArray(inventoryRows) ? inventoryRows : []);

    const firstWarehouseId = activeWarehouses[0]?.id || "";
    const secondWarehouseId = activeWarehouses[1]?.id || activeWarehouses[0]?.id || "";
    setFromWarehouseId((prev) => prev || firstWarehouseId);
    setToWarehouseId((prev) => prev || secondWarehouseId);
  };

  useEffect(() => {
    if (!isOpen) return;
    setError("");
    loadModalData().catch((err) => setError(err.message || "Failed to load transfer data."));
  }, [isOpen]);

  const sourceInventory = useMemo(
    () =>
      inventory.filter(
        (row) => row.warehouseId === fromWarehouseId && Number(row.currentStock) > 0
      ),
    [inventory, fromWarehouseId]
  );

  const sourceProductMap = useMemo(() => {
    const map = new Map();
    for (const row of sourceInventory) {
      map.set(row.productId, {
        productId: row.productId,
        productName: row.productName,
        currentStock: Number(row.currentStock),
      });
    }
    return map;
  }, [sourceInventory]);

  const destinationStockMap = useMemo(() => new Map(
    inventory.filter((row) => row.warehouseId === toWarehouseId)
      .map((row) => [row.productId, Number(row.currentStock || 0)])
  ), [inventory, toWarehouseId]);

  const updateItem = (index, field, value) => {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, [field]: value } : item)));
  };

  const addItemRow = () => setItems((prev) => [...prev, { productId: "", quantity: "" }]);
  const removeItemRow = (index) => setItems((prev) => prev.filter((_, i) => i !== index));

  const validItems = items
    .filter((item) => item.productId && Number(item.quantity) > 0)
    .map((item) => ({
      productId: String(item.productId).trim(),
      quantity: Number(item.quantity),
    }));

  const totalItems = new Set(validItems.map((item) => item.productId)).size;
  const totalTransferQty = validItems.reduce((sum, item) => sum + item.quantity, 0);

  const resetAndClose = () => {
    setItems([{ productId: "", quantity: "" }]);
    setRemarks("");
    setError("");
    onClose();
  };

  const handleSubmit = async () => {
    if (!fromWarehouseId || !toWarehouseId) {
      return setError("Please select source and destination warehouse.");
    }
    if (fromWarehouseId === toWarehouseId) {
      return setError("Source and destination warehouses must be different.");
    }
    if (isSubmitting) return;
    if (items.some((item) => !item.productId || !Number.isSafeInteger(Number(item.quantity)) || Number(item.quantity) <= 0)) return setError("Complete every item with a product and a positive whole-number quantity.");
    if (!validItems.length) {
      return setError("Add at least one product with quantity.");
    }

    for (const item of validItems) {
      const source = sourceProductMap.get(item.productId);
      if (!source) {
        return setError(`Product ${item.productId} is not available in selected source warehouse.`);
      }
      if (validItems.filter((row) => row.productId === item.productId).reduce((sum, row) => sum + row.quantity, 0) > source.currentStock) {
        return setError(
          `Cannot transfer ${item.quantity} of ${source.productName}. Available stock: ${source.currentStock}.`
        );
      }
    }

    setIsSubmitting(true);
    setError("");

    try {
      await apiRequest("/inventory/transfer", {
        method: "POST",
        body: JSON.stringify({
          fromWarehouseId,
          toWarehouseId,
          remarks: remarks || null,
          items: validItems,
        }),
      });

      onSuccess?.();
      resetAndClose();
    } catch (err) {
      setError(err.message || "Failed to create transfer.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={() => { if (!isSubmitting) resetAndClose(); }}>
      <div className="modal-container inventory-movement-modal transfer-modal" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-title">Warehouse Transfer</h2>

        {error && <p style={{ color: "#dc2626", fontWeight: 600, marginTop: -8 }}>{error}</p>}

        <div className="form-grid">
          <div className="form-row">
            <span className="form-label">From Warehouse</span>
            <span className="form-colon">:</span>
            <select
              className="form-select"
              value={fromWarehouseId}
              onChange={(e) => setFromWarehouseId(e.target.value)}
            >
              <option value="" disabled>Select warehouse</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          </div>

          <div className="form-row">
            <span className="form-label">To Warehouse</span>
            <span className="form-colon">:</span>
            <select className="form-select" value={toWarehouseId} onChange={(e) => setToWarehouseId(e.target.value)}>
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
              placeholder="Optional notes"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
            />
          </div>
        </div>

        <div className="items-section-header">
          <h3 className="items-title">Transfer Items</h3>
          <button type="button" className="btn-add-item" onClick={addItemRow}>Add Item</button>
        </div>

        <div className="modal-table-wrap">
          <table className="modal-table transfer-items-table">
            <colgroup>
              <col className="transfer-index-col" />
              <col className="transfer-product-col" />
              <col className="transfer-qty-col" />
              <col className="transfer-stock-col" />
              <col className="transfer-stock-col" />
              <col className="transfer-action-col" />
            </colgroup>
            <thead>
              <tr>
                <th className="text-center">#</th>
                <th>Product</th>
                <th className="text-center">Qty</th>
                <th className="text-center">Available</th>
                <th className="text-center">Destination Stock</th>
                <th className="text-center"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, index) => {
                const sourceProduct = sourceProductMap.get(item.productId);
                return (
                  <tr key={index}>
                    <td className="text-center">{index + 1}</td>
                    <td>
                      <select
                        value={item.productId}
                        onChange={(e) => updateItem(index, "productId", e.target.value)}
                        className="transfer-product-select"
                      >
                        <option value="">Select product</option>
                        {Array.from(sourceProductMap.values()).map((product) => (
                          <option key={product.productId} value={product.productId}>
                            {product.productName}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="text-center">
                      <input
                        type="number"
                        min="1"
                        value={item.quantity}
                        onChange={(e) => updateItem(index, "quantity", e.target.value)}
                        className="transfer-quantity-input"
                      />
                    </td>
                    <td className="text-center">{sourceProduct ? sourceProduct.currentStock : "—"}</td>
                    <td className="text-center">{item.productId && toWarehouseId ? (destinationStockMap.get(item.productId) || 0) : "—"}</td>
                    <td className="text-center">
                      <button
                        type="button"
                        onClick={() => removeItemRow(index)}
                        className="transfer-remove-button"
                        aria-label={`Remove item ${index + 1}`}
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

        <div className="modal-summary" aria-label="Transfer summary">
          <div className="summary-row">Total Items: {totalItems}</div>
          <div className="summary-row">Total Transfer Qty: {totalTransferQty}</div>
        </div>

        <div className="modal-actions">
          <button type="button" className="btn-cancel" onClick={resetAndClose} disabled={isSubmitting}>Cancel</button>
          <button type="button" className="btn-approved" onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting ? "Saving…" : "Create Transfer"}
          </button>
        </div>
      </div>
    </div>
  );
}




