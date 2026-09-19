import React, { useEffect, useMemo, useState } from "react";
import {
  Search,
  ChevronDown,
  Box,
  Sliders,
  Package,
  Trash2,
  ShoppingCart,
  RefreshCw,
} from "lucide-react";
import ConfirmPOModal from "./ConfirmPOModal";
import CustomizeRestockModal from "./CustomizeRestockModal";
import CustomizeSingleItemModal from "./CustomizeSingleItemModal";
import { apiRequest } from "./api";
import "./Restocking.css";

export default function Restocking() {
  const [activeTab, setActiveTab] = useState("restocking");

  const [recommendations, setRecommendations] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSupplier, setSelectedSupplier] = useState("All Supplier");
  const [selectedPriority, setSelectedPriority] = useState("All Priority");
  const [selectedRows, setSelectedRows] = useState([]); // restockIds

  // Modal States
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
  const [isCustomizeOpen, setIsCustomizeOpen] = useState(false);
  const [isSingleCustomizeOpen, setIsSingleCustomizeOpen] = useState(false);
  const [selectedItemForCustomize, setSelectedItemForCustomize] = useState(null);

  // Draft Purchase Order (built from checked restocking rows, not yet saved to backend)
  const [poDraft, setPoDraft] = useState(null); // { supplierId, supplierName, restockIds, items: [...] }
  const [savedPoId, setSavedPoId] = useState(null); // once saved as a draft/created on the backend
  const [isSavingDraft, setIsSavingDraft] = useState(false);

  const loadRecommendations = () => {
    setIsLoading(true);
    apiRequest("/restocking")
      .then((data) => {
        setRecommendations(data);
        setLoadError("");
      })
      .catch((err) => setLoadError(err.message || "Failed to load restocking recommendations."))
      .finally(() => setIsLoading(false));
  };

  useEffect(() => {
    loadRecommendations();
  }, []);

  const suppliers = useMemo(
    () => ["All Supplier", ...new Set(recommendations.map((r) => r.supplierName))],
    [recommendations]
  );

  const filteredData = useMemo(() => {
    return recommendations.filter((item) => {
      const matchesSearch =
        !searchQuery || item.productName.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesSupplier = selectedSupplier === "All Supplier" || item.supplierName === selectedSupplier;
      const matchesPriority = selectedPriority === "All Priority" || item.priority === selectedPriority;
      return matchesSearch && matchesSupplier && matchesPriority;
    });
  }, [recommendations, searchQuery, selectedSupplier, selectedPriority]);

  const criticalCount = recommendations.filter((r) => r.priority === "Critical").length;
  const estimatedCost = recommendations.reduce((sum, r) => sum + r.suggestedQty * Number(r.costPrice || 0), 0);

  const toggleSelectAll = () => {
    if (selectedRows.length === filteredData.length) {
      setSelectedRows([]);
    } else {
      setSelectedRows(filteredData.map((item) => item.restockId));
    }
  };

  const toggleRowSelect = (id) => {
    setSelectedRows((prev) => (prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id]));
  };

  const handleGenerate = async () => {
    setIsGenerating(true);
    setActionError("");
    try {
      const result = await apiRequest("/restocking/generate", { method: "POST" });
      loadRecommendations();
      if (result.created === 0) {
        setActionError("No new recommendations — every low-stock product already has a pending one.");
      }
    } catch (err) {
      setActionError(err.message || "Failed to generate recommendations.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDeleteRecommendation = async (item) => {
    const confirmed = window.confirm(`Remove the restock recommendation for "${item.productName}"?`);
    if (!confirmed) return;
    setActionError("");
    try {
      await apiRequest(`/restocking/${item.restockId}`, { method: "DELETE" });
      setSelectedRows((prev) => prev.filter((id) => id !== item.restockId));
      loadRecommendations();
    } catch (err) {
      setActionError(err.message || "Failed to delete recommendation.");
    }
  };

  const handleOpenSingleCustomize = (item) => {
    setSelectedItemForCustomize(item);
    setIsSingleCustomizeOpen(true);
  };

  // Build a purchase order directly from ONE row's "package" icon
  const handlePackageSingle = (item) => {
    buildDraftFromItems([item]);
  };

  const buildDraftFromItems = (items) => {
    if (!items.length) return;
    const supplierIds = new Set(items.map((i) => i.supplierId));
    if (supplierIds.size > 1) {
      setActionError(
        "Selected items belong to different suppliers. A purchase order can only include items from one supplier — please select items from a single supplier at a time."
      );
      return;
    }
    setActionError("");
    setPoDraft({
      supplierId: items[0].supplierId,
      supplierName: items[0].supplierName,
      restockIds: items.map((i) => i.restockId),
      items: items.map((i) => ({
        productId: i.productId,
        productName: i.productName,
        qty: i.suggestedQty,
        unitCost: Number(i.costPrice),
      })),
    });
    setSavedPoId(null);
    setActiveTab("purchaseOrder");
  };

  const handleBuildFromSelection = () => {
    const items = recommendations.filter((r) => selectedRows.includes(r.restockId));
    if (!items.length) {
      setActionError("Check at least one item in the table before building a purchase order.");
      return;
    }
    buildDraftFromItems(items);
  };

  // ---- Purchase Order tab actions ----

  const poItemsForCustomize = useMemo(() => {
    if (!poDraft) return [];
    return recommendations.filter((r) => poDraft.restockIds.includes(r.restockId));
  }, [poDraft, recommendations]);

  const poTotals = useMemo(() => {
    if (!poDraft) return { subtotal: 0, totalQty: 0 };
    const subtotal = poDraft.items.reduce((sum, it) => sum + it.qty * it.unitCost, 0);
    const totalQty = poDraft.items.reduce((sum, it) => sum + it.qty, 0);
    return { subtotal, totalQty };
  }, [poDraft]);

  const saveDraft = async () => {
    if (!poDraft) return null;
    setIsSavingDraft(true);
    setActionError("");
    try {
      const result = await apiRequest("/purchase-orders", {
        method: "POST",
        body: JSON.stringify({
          supplierId: poDraft.supplierId,
          restockIds: poDraft.restockIds,
          items: poDraft.items.map((it) => ({
            productId: it.productId,
            qty: it.qty,
            unitCost: it.unitCost,
          })),
        }),
      });
      setSavedPoId(result.id);
      loadRecommendations();
      setSelectedRows([]);
      return result.id;
    } catch (err) {
      setActionError(err.message || "Failed to save purchase order.");
      throw err;
    } finally {
      setIsSavingDraft(false);
    }
  };

  const handleSaveDraftClick = async () => {
    try {
      const id = await saveDraft();
      if (id) alert("Purchase order saved as a draft (Pending).");
    } catch {
      /* error already shown */
    }
  };

  const handleConfirmPurchaseOrder = async () => {
    let id = savedPoId;
    if (!id) {
      id = await saveDraft();
    }
    await apiRequest(`/purchase-orders/${id}/confirm`, { method: "PUT" });
    setIsConfirmModalOpen(false);
    setPoDraft(null);
    setSavedPoId(null);
    setActiveTab("restocking");
    alert("Purchase order confirmed and sent to the supplier.");
  };

  const handleCancelPurchaseOrder = async () => {
    if (savedPoId) {
      const confirmed = window.confirm("This purchase order was already saved as a draft. Cancel it?");
      if (!confirmed) return;
      try {
        await apiRequest(`/purchase-orders/${savedPoId}/cancel`, { method: "PUT" });
      } catch (err) {
        setActionError(err.message || "Failed to cancel purchase order.");
        return;
      }
    }
    setPoDraft(null);
    setSavedPoId(null);
    setActiveTab("restocking");
  };

  return (
    <div className="restocking-page">
      <div className="restocking-inner">
        <h1 className="restocking-title">Restocking Assistant</h1>

        {loadError && <p style={{ color: "#dc2626", fontWeight: 600 }}>{loadError}</p>}
        {actionError && <p style={{ color: "#dc2626", fontWeight: 600 }}>{actionError}</p>}

        {/* Metric Cards */}
        <div className="restocking-cards-grid">
          <div className="restocking-card">
            <div className="restocking-card-label">Critical Urgencies</div>
            <div className="restocking-card-value">{criticalCount} Products</div>
          </div>
          <div className="restocking-card">
            <div className="restocking-card-label">Restocking Cost</div>
            <div className="restocking-card-value">
              ₱ {estimatedCost.toLocaleString("en-US", { minimumFractionDigits: 2 })}
            </div>
          </div>
          <div className="restocking-card">
            <div className="restocking-card-label">Open Recommendations</div>
            <div className="restocking-card-value">{recommendations.length}</div>
          </div>
        </div>

        {/* Navigation Tabs & Actions */}
        <div className="restocking-tabs-action-bar">
          <div className="restocking-tabs">
            <button
              className={`restocking-tab ${activeTab === "restocking" ? "active" : ""}`}
              onClick={() => setActiveTab("restocking")}
            >
              Restocking
            </button>
            <button
              className={`restocking-tab ${activeTab === "purchaseOrder" ? "active" : ""}`}
              onClick={() => setActiveTab("purchaseOrder")}
              disabled={!poDraft}
              title={!poDraft ? "Select items in Restocking first to build a purchase order" : ""}
            >
              Purchase Order
            </button>
          </div>

          {activeTab === "restocking" && (
            <div className="restocking-actions">
              <button className="btn-customize" onClick={handleGenerate} disabled={isGenerating}>
                <RefreshCw size={16} /> {isGenerating ? "Generating…" : "Generate Recommendations"}
              </button>
              <button className="btn-purchase-order" onClick={handleBuildFromSelection}>
                <Box size={16} /> Purchase Order ({selectedRows.length})
              </button>
              <button className="btn-customize" onClick={() => setIsCustomizeOpen(true)}>
                <Sliders size={16} /> Customize Selected
              </button>
            </div>
          )}
        </div>

        {/* TAB 1: RESTOCKING TABLE VIEW */}
        {activeTab === "restocking" && (
          <>
            {/* Search & Filters Toolbar */}
            <div className="restocking-toolbar">
              <div className="restocking-search">
                <input
                  type="text"
                  placeholder="Search by Product"
                  className="restocking-search-input"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                <Search size={16} className="restocking-search-icon" />
              </div>

              <div className="restocking-select-wrap">
                <select
                  className="restocking-select"
                  value={selectedSupplier}
                  onChange={(e) => setSelectedSupplier(e.target.value)}
                >
                  {suppliers.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
                <ChevronDown size={16} className="restocking-select-icon" />
              </div>

              <div className="restocking-select-wrap">
                <select
                  className="restocking-select"
                  value={selectedPriority}
                  onChange={(e) => setSelectedPriority(e.target.value)}
                >
                  <option value="All Priority">All Priority</option>
                  <option value="Low">Low</option>
                  <option value="Critical">Critical</option>
                </select>
                <ChevronDown size={16} className="restocking-select-icon" />
              </div>
            </div>

            {/* Table Structure */}
            <div className="restocking-table-wrap">
              <table className="restocking-table">
                <thead>
                  <tr>
                    <th>
                      <input
                        type="checkbox"
                        className="restocking-checkbox"
                        checked={selectedRows.length === filteredData.length && filteredData.length > 0}
                        onChange={toggleSelectAll}
                      />
                    </th>
                    <th>Restock ID</th>
                    <th>Product</th>
                    <th>Supplier</th>
                    <th>Current Stock</th>
                    <th>Reorder Level</th>
                    <th>Suggested Qty</th>
                    <th>Priority</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading && (
                    <tr><td colSpan={9} style={{ textAlign: "center", padding: 24 }}>Loading…</td></tr>
                  )}
                  {!isLoading && filteredData.length === 0 && (
                    <tr>
                      <td colSpan={9} style={{ textAlign: "center", padding: 24 }}>
                        No open recommendations. Click "Generate Recommendations" to scan for low stock.
                      </td>
                    </tr>
                  )}
                  {!isLoading &&
                    filteredData.map((item) => {
                      const isSelected = selectedRows.includes(item.restockId);
                      return (
                        <tr key={item.restockId} className={isSelected ? "selected-row" : ""}>
                          <td>
                            <input
                              type="checkbox"
                              className="restocking-checkbox"
                              checked={isSelected}
                              onChange={() => toggleRowSelect(item.restockId)}
                            />
                          </td>
                          <td>R-{String(item.restockId).padStart(3, "0")}</td>
                          <td>{item.productName}</td>
                          <td>{item.supplierName}</td>
                          <td>{item.currentStock}</td>
                          <td>{item.reorderLevel}</td>
                          <td>{item.suggestedQty}</td>
                          <td>
                            <span className={`restocking-priority-pill ${item.priority.toLowerCase()}`}>
                              {item.priority}
                            </span>
                          </td>
                          <td>
                            <div className="restocking-action-icons">
                              <button
                                className="restocking-action-icon adjust"
                                title="Customize"
                                onClick={() => handleOpenSingleCustomize(item)}
                              >
                                <Sliders size={16} />
                              </button>
                              <button
                                className="restocking-action-icon package"
                                title="Build Purchase Order"
                                onClick={() => handlePackageSingle(item)}
                              >
                                <Package size={16} />
                              </button>
                              <button
                                className="restocking-action-icon delete"
                                title="Delete"
                                onClick={() => handleDeleteRecommendation(item)}
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* TAB 2: PURCHASE ORDER VIEW */}
        {activeTab === "purchaseOrder" && poDraft && (
          <div className="po-container">
            {/* Left Card: Form Inputs & Item Details */}
            <div className="po-main-card">
              <div className="po-header-inputs">
                <div className="po-field">
                  <label>Purchase Order</label>
                  <input type="text" value={savedPoId ? `Saved (#${savedPoId})` : "Not yet saved"} disabled />
                </div>
                <div className="po-field">
                  <label>Supplier</label>
                  <input type="text" value={poDraft.supplierName} disabled />
                </div>
                <div className="po-field">
                  <label>Items Count</label>
                  <input type="text" value={poDraft.items.length} disabled />
                </div>
              </div>

              <div className="po-section">
                <div className="po-section-title">Items</div>
                <table className="po-items-table">
                  <thead>
                    <tr>
                      <th className="th-name">Product Name</th>
                      <th className="th-qty">Qty</th>
                      <th className="th-price">Cost Price</th>
                      <th className="th-subtotal">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {poDraft.items.map((item, idx) => (
                      <tr key={idx}>
                        <td>{item.productName}</td>
                        <td className="td-qty">
                          <input
                            type="number"
                            min="1"
                            value={item.qty}
                            onChange={(e) => {
                              const newQty = Number(e.target.value) || 0;
                              setPoDraft((prev) => ({
                                ...prev,
                                items: prev.items.map((it, i) => (i === idx ? { ...it, qty: newQty } : it)),
                              }));
                            }}
                            style={{ width: 70, textAlign: "center" }}
                          />
                        </td>
                        <td className="td-price">
                          ₱ {item.unitCost.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                        </td>
                        <td className="td-subtotal">
                          ₱ {(item.qty * item.unitCost).toLocaleString("en-US", { minimumFractionDigits: 2 })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="po-section">
                <div className="po-section-title">Total Summary</div>
                <div className="po-summary-rows">
                  <div className="po-summary-row">
                    <span className="label">Total Items:</span>
                    <span className="value">{poDraft.items.length}</span>
                  </div>
                  <div className="po-summary-row">
                    <span className="label">Total Quantity:</span>
                    <span className="value">{poTotals.totalQty}</span>
                  </div>
                  <div className="po-summary-row">
                    <span className="label">Total Amount:</span>
                    <span className="value">
                      ₱ {poTotals.subtotal.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Card: Order Summary Panel */}
            <div className="po-side-card">
              <div className="po-side-header">
                <ShoppingCart size={18} /> Summary
              </div>
              <div className="po-side-body">
                <div className="po-calc-list">
                  <div className="po-calc-item">
                    <span>Subtotal:</span>
                    <span className="val">
                      ₱ {poTotals.subtotal.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>

                <div className="po-total-row">
                  <span className="po-total-label">Total Cost</span>
                  <span className="po-total-value">
                    ₱ {poTotals.subtotal.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                  </span>
                </div>

                <button className="po-btn-confirm" onClick={() => setIsConfirmModalOpen(true)}>
                  Confirm Purchase Order
                </button>
                <button className="po-btn-draft" onClick={handleSaveDraftClick} disabled={isSavingDraft}>
                  {isSavingDraft ? "Saving…" : "Save as Draft"}
                </button>
                <button className="po-btn-cancel" onClick={handleCancelPurchaseOrder}>
                  Cancel Purchase Order
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Confirmation Modal */}
      <ConfirmPOModal
        isOpen={isConfirmModalOpen}
        onClose={() => setIsConfirmModalOpen(false)}
        onConfirm={handleConfirmPurchaseOrder}
      />

      {/* Bulk Customize Modal — edits the currently checked rows */}
      <CustomizeRestockModal
        isOpen={isCustomizeOpen}
        onClose={() => setIsCustomizeOpen(false)}
        items={recommendations.filter((r) => selectedRows.includes(r.restockId))}
        onApplied={loadRecommendations}
      />

      {/* Single Item Customize Modal */}
      <CustomizeSingleItemModal
        isOpen={isSingleCustomizeOpen}
        onClose={() => setIsSingleCustomizeOpen(false)}
        selectedItem={selectedItemForCustomize}
        onSaved={loadRecommendations}
      />
    </div>
  );
}