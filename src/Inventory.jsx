import React, { useEffect, useMemo, useState } from "react";
import {
  Search,
  ChevronDown,
  Plus,
  FileText,
  Pencil,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import AddStockInModal from "./AddStockInModal";
import AddStockOutModal from "./AddStockOutModal";
import StockAdjustmentModal from "./StockAdjustmentModal";
import { apiRequest } from "./api";
import "./Inventory.css";

function getStatusClass(status) {
  switch (status) {
    case "Normal":
      return "normal";
    case "Critical":
      return "critical";
    case "Low Stock":
      return "low-stock";
    default:
      return "";
  }
}

// ---------------------------------------------------------------------------
// Lightweight inline modals for View / Edit — no new CSS files needed
// ---------------------------------------------------------------------------

const overlayStyle = {
  position: "fixed",
  inset: 0,
  background: "rgba(17, 24, 39, 0.45)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1000,
  padding: 16,
};

const cardStyle = {
  background: "#ffffff",
  borderRadius: 12,
  padding: "24px 28px",
  width: "100%",
  maxWidth: 420,
  boxShadow: "0 20px 50px rgba(0,0,0,0.2)",
};

function ViewInventoryModal({ item, onClose }) {
  if (!item) return null;
  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={cardStyle} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ fontSize: "1.25rem", fontWeight: 800, margin: 0 }}>Inventory Details</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer" }}>
            <X size={20} />
          </button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 16, fontSize: "0.9rem" }}>
          <div><strong>Product ID:</strong> {item.productId}</div>
          <div><strong>Product Name:</strong> {item.productName}</div>
          <div><strong>Warehouse:</strong> {item.warehouse}</div>
          <div><strong>Current Stock:</strong> {item.currentStock}</div>
          <div><strong>Reorder Limit:</strong> {item.reorderLimit}</div>
          <div><strong>Status:</strong> {item.status}</div>
          {item.lastUpdated && <div><strong>Last Updated:</strong> {new Date(item.lastUpdated).toLocaleString()}</div>}
        </div>
        <button
          onClick={onClose}
          style={{
            marginTop: 20, width: "100%", padding: "10px 0", borderRadius: 8, border: "none",
            background: "#e5e7eb", color: "#111827", fontWeight: 700, cursor: "pointer",
          }}
        >
          Close
        </button>
      </div>
    </div>
  );
}

function EditInventoryModal({ item, onClose, onSave, isSaving }) {
  const [newQuantity, setNewQuantity] = useState(item ? item.currentStock : 0);
  const [remarks, setRemarks] = useState("");

  useEffect(() => {
    if (item) {
      setNewQuantity(item.currentStock);
      setRemarks("");
    }
  }, [item]);

  if (!item) return null;

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={cardStyle} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ fontSize: "1.25rem", fontWeight: 800, margin: 0 }}>Edit Stock</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer" }}>
            <X size={20} />
          </button>
        </div>
        <p style={{ color: "#6b7280", fontSize: "0.85rem", margin: "8px 0 16px 0" }}>
          {item.productName} — {item.warehouse}
        </p>

        <label style={{ fontSize: "0.85rem", fontWeight: 600, color: "#374151" }}>New Stock Quantity</label>
        <input
          type="number"
          min="0"
          value={newQuantity}
          onChange={(e) => setNewQuantity(e.target.value)}
          style={{
            width: "100%", border: "1px solid #d1d5db", borderRadius: 8, padding: "10px 12px",
            fontSize: "0.9rem", margin: "6px 0 14px 0", boxSizing: "border-box",
          }}
        />

        <label style={{ fontSize: "0.85rem", fontWeight: 600, color: "#374151" }}>Remarks (optional)</label>
        <input
          type="text"
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
          placeholder="e.g. Physical count correction"
          style={{
            width: "100%", border: "1px solid #d1d5db", borderRadius: 8, padding: "10px 12px",
            fontSize: "0.9rem", margin: "6px 0 20px 0", boxSizing: "border-box",
          }}
        />

        <div style={{ display: "flex", gap: 12 }}>
          <button
            onClick={onClose}
            style={{
              flex: 1, padding: "10px 0", borderRadius: 8, border: "1px solid #d1d5db",
              background: "#e5e7eb", color: "#111827", fontWeight: 700, cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            onClick={() => onSave(item.inventoryId, Number(newQuantity), remarks)}
            disabled={isSaving}
            style={{
              flex: 1, padding: "10px 0", borderRadius: 8, border: "none",
              background: "#1d6bf3", color: "#ffffff", fontWeight: 700, cursor: "pointer",
              opacity: isSaving ? 0.6 : 1,
            }}
          >
            {isSaving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function Inventory() {
  const [activeTab, setActiveTab] = useState("inventory");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedWarehouse, setSelectedWarehouse] = useState("All Warehouse");
  const [selectedStatus, setSelectedStatus] = useState("Inventory Status");

  const [inventory, setInventory] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [viewItem, setViewItem] = useState(null);
  const [editItem, setEditItem] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [actionError, setActionError] = useState("");

  // Modal States (bulk stock in/out/adjust — separate flows)
  const [isStockInOpen, setIsStockInOpen] = useState(false);
  const [isStockOutOpen, setIsStockOutOpen] = useState(false);
  const [isAdjustmentOpen, setIsAdjustmentOpen] = useState(false);

  const loadInventory = () => {
    setIsLoading(true);
    apiRequest("/inventory")
      .then((data) => {
        setInventory(data);
        setLoadError("");
      })
      .catch((err) => setLoadError(err.message || "Failed to load inventory."))
      .finally(() => setIsLoading(false));
  };

  const loadTransactions = () => {
    apiRequest("/inventory/transactions")
      .then((data) => setTransactions(data))
      .catch((err) => setLoadError(err.message || "Failed to load transactions."));
  };

  useEffect(() => {
    loadInventory();
    loadTransactions();
  }, []);

  const warehouseOptions = useMemo(
    () => ["All Warehouse", ...new Set(inventory.map((i) => i.warehouse))],
    [inventory]
  );

  const filteredInventory = useMemo(() => {
    return inventory.filter((item) => {
      const matchesSearch =
        !searchQuery ||
        item.productName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        String(item.productId).toLowerCase().includes(searchQuery.toLowerCase());
      const matchesWarehouse = selectedWarehouse === "All Warehouse" || item.warehouse === selectedWarehouse;
      const matchesStatus = selectedStatus === "Inventory Status" || item.status === selectedStatus;
      return matchesSearch && matchesWarehouse && matchesStatus;
    });
  }, [inventory, searchQuery, selectedWarehouse, selectedStatus]);

  const counts = useMemo(() => {
    return inventory.reduce(
      (acc, item) => {
        if (item.status === "Critical") acc.critical += 1;
        else if (item.status === "Low Stock") acc.low += 1;
        else acc.normal += 1;
        return acc;
      },
      { critical: 0, low: 0, normal: 0 }
    );
  }, [inventory]);

  const handleSaveEdit = async (inventoryId, newQuantity, remarks) => {
    setIsSaving(true);
    setActionError("");
    try {
      await apiRequest(`/inventory/${inventoryId}`, {
        method: "PUT",
        body: JSON.stringify({ newQuantity, remarks }),
      });
      setEditItem(null);
      loadInventory();
      loadTransactions();
    } catch (err) {
      setActionError(err.message || "Failed to update inventory.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (item) => {
    const confirmed = window.confirm(
      `Delete the inventory record for "${item.productName}" at ${item.warehouse}? This can't be undone.`
    );
    if (!confirmed) return;

    setActionError("");
    try {
      await apiRequest(`/inventory/${item.inventoryId}`, { method: "DELETE" });
      loadInventory();
    } catch (err) {
      setActionError(err.message || "Failed to delete inventory record.");
    }
  };

  return (
    <div className="inventory-page">
      <div className="inventory-inner">
        <h1 className="inventory-title">Inventory</h1>

        {actionError && (
          <p style={{ color: "#dc2626", fontWeight: 600, margin: 0 }}>{actionError}</p>
        )}
        {loadError && (
          <p style={{ color: "#dc2626", fontWeight: 600, margin: 0 }}>{loadError}</p>
        )}

        {/* Metric Cards */}
        <div className="inventory-cards-grid">
          <div className="inventory-card">
            <div className="inventory-card-label">Critical Items</div>
            <div className="inventory-card-value">{counts.critical}</div>
          </div>
          <div className="inventory-card">
            <div className="inventory-card-label">Low Stock Items</div>
            <div className="inventory-card-value">{counts.low}</div>
          </div>
          <div className="inventory-card">
            <div className="inventory-card-label">Normal Items</div>
            <div className="inventory-card-value">{counts.normal}</div>
          </div>
        </div>

        {/* Tabs & Action Buttons */}
        <div className="inventory-tabs-action-bar">
          <div className="inventory-tabs">
            <button
              className={`inventory-tab ${activeTab === "inventory" ? "active" : ""}`}
              onClick={() => setActiveTab("inventory")}
            >
              Inventory
            </button>
            <button
              className={`inventory-tab ${activeTab === "transactions" ? "active" : ""}`}
              onClick={() => setActiveTab("transactions")}
            >
              Inventory Transactions
            </button>
          </div>

          <div className="inventory-actions">
            <button className="action-btn">
              <Upload size={16} /> Import Inventory Data
            </button>
            <button className="action-btn" onClick={() => setIsStockInOpen(true)}>
              <Plus size={16} /> Add Stock In
            </button>
            <button className="action-btn" onClick={() => setIsStockOutOpen(true)}>
              <Plus size={16} /> Add Stock Out
            </button>
            <button className="action-btn" onClick={() => setIsAdjustmentOpen(true)}>
              <Plus size={16} /> Stock Adjustment
            </button>
          </div>
        </div>

        {/* Search & Filters Toolbar */}
        <div className="inventory-toolbar">
          <div className="inventory-search">
            <input
              type="text"
              placeholder="Search Inventory by Product"
              className="inventory-search-input"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <Search size={16} className="inventory-search-icon" />
          </div>

          <div className="inventory-select-wrap">
            <select
              className="inventory-select"
              value={selectedWarehouse}
              onChange={(e) => setSelectedWarehouse(e.target.value)}
            >
              {warehouseOptions.map((w) => (
                <option key={w} value={w}>{w}</option>
              ))}
            </select>
            <ChevronDown size={16} className="inventory-select-icon" />
          </div>

          <div className="inventory-select-wrap">
            <select
              className="inventory-select"
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
            >
              <option value="Inventory Status">Inventory Status</option>
              <option value="Normal">Normal</option>
              <option value="Critical">Critical</option>
              <option value="Low Stock">Low Stock</option>
            </select>
            <ChevronDown size={16} className="inventory-select-icon" />
          </div>
        </div>

        {/* Table View Conditional Rendering */}
        <div className="inventory-table-wrap">
          {activeTab === "inventory" ? (
            <table className="inventory-table">
              <thead>
                <tr>
                  <th>Inventory ID</th>
                  <th>Product ID</th>
                  <th>Warehouse</th>
                  <th>Current Stock</th>
                  <th>Reorder Limit</th>
                  <th>Status</th>
                  <th>Stock Actions</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr><td colSpan={7} style={{ textAlign: "center", padding: 24 }}>Loading…</td></tr>
                )}
                {!isLoading && filteredInventory.length === 0 && (
                  <tr><td colSpan={7} style={{ textAlign: "center", padding: 24 }}>No inventory records found.</td></tr>
                )}
                {!isLoading &&
                  filteredInventory.map((item) => (
                    <tr key={item.inventoryId}>
                      <td>{item.inventoryId}</td>
                      <td>{item.productId}</td>
                      <td>{item.warehouse}</td>
                      <td>{item.currentStock}</td>
                      <td>{item.reorderLimit}</td>
                      <td>
                        <span className={`inventory-status-pill ${getStatusClass(item.status)}`}>
                          {item.status}
                        </span>
                      </td>
                      <td>
                        <div className="inventory-action-icons">
                          <button
                            className="inventory-action-icon view"
                            title="View"
                            onClick={() => setViewItem(item)}
                          >
                            <FileText size={16} />
                          </button>
                          <button
                            className="inventory-action-icon edit"
                            title="Edit"
                            onClick={() => setEditItem(item)}
                          >
                            <Pencil size={16} />
                          </button>
                          <button
                            className="inventory-action-icon delete"
                            title="Delete"
                            onClick={() => handleDelete(item)}
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          ) : (
            <table className="inventory-table transactions-table">
              <thead>
                <tr>
                  <th>Transaction ID</th>
                  <th>Product ID</th>
                  <th>Product Name</th>
                  <th>Warehouse</th>
                  <th>Type</th>
                  <th>Quantity</th>
                  <th>Reference</th>
                  <th>Date</th>
                  <th>User</th>
                </tr>
              </thead>
              <tbody>
                {transactions.length === 0 && (
                  <tr><td colSpan={9} style={{ textAlign: "center", padding: 24 }}>No transactions yet.</td></tr>
                )}
                {transactions.map((tx) => (
                  <tr key={tx.transactionId}>
                    <td>{tx.transactionId}</td>
                    <td>{tx.productId}</td>
                    <td>{tx.productName}</td>
                    <td>{tx.warehouse}</td>
                    <td>{tx.type}</td>
                    <td>{tx.quantity}</td>
                    <td>{tx.reference || "—"}</td>
                    <td>{new Date(tx.date).toLocaleString()}</td>
                    <td>{tx.user}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* View / Edit Modals */}
      <ViewInventoryModal item={viewItem} onClose={() => setViewItem(null)} />
      <EditInventoryModal
        item={editItem}
        onClose={() => setEditItem(null)}
        onSave={handleSaveEdit}
        isSaving={isSaving}
      />

      {/* Bulk Stock In / Out / Adjustment Modals */}
      <AddStockInModal
        isOpen={isStockInOpen}
        onClose={() => setIsStockInOpen(false)}
        onSuccess={() => {
          loadInventory();
          loadTransactions();
        }}
      />
      <AddStockOutModal
        isOpen={isStockOutOpen}
        onClose={() => setIsStockOutOpen(false)}
        onSuccess={() => {
          loadInventory();
          loadTransactions();
        }}
      />
      <StockAdjustmentModal
        isOpen={isAdjustmentOpen}
        onClose={() => setIsAdjustmentOpen(false)}
        onSuccess={() => {
          loadInventory();
          loadTransactions();
        }}
      />
    </div>
  );
}