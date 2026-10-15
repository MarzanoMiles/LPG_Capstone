import Pagination from "./Pagination";
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
  Eye,
} from "lucide-react";
import ConfirmPOModal from "./ConfirmPOModal";
import CustomizeRestockModal from "./CustomizeRestockModal";
import CustomizeSingleItemModal from "./CustomizeSingleItemModal";
import { apiRequest } from "./api";
import "./Restocking.css";

const PAGE_SIZE = 5;
const HISTORY_PAGE_SIZE = PAGE_SIZE;

function formatPeso(amount) {
  return `₱ ${Number(amount || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}



function displayPurchaseOrderStatus(status) {
  if (status === "Received") return "Received";
  if (status === "Cancelled") return "Cancelled";
  return "Sent";
}

function canReceivePurchaseOrder(status) {
  return status === "Approved" || status === "Sent";
}

export default function Restocking() {
  const [activeTab, setActiveTab] = useState("restocking");

  const [recommendations, setRecommendations] = useState([]);
  const [purchaseOrderHistory, setPurchaseOrderHistory] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isHistoryLoading, setIsHistoryLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [historyLoadError, setHistoryLoadError] = useState("");
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

  const [historyPage, setHistoryPage] = useState(1);
  const [restockingPage, setRestockingPage] = useState(1);
  const [viewingPurchaseOrderId, setViewingPurchaseOrderId] = useState(null);
  const [viewPurchaseOrder, setViewPurchaseOrder] = useState(null);
  const [isViewLoading, setIsViewLoading] = useState(false);
  const [isReceiving, setIsReceiving] = useState(false);
  const [receiveWarehouseId, setReceiveWarehouseId] = useState("");
  const [warehouses, setWarehouses] = useState([]);

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

  const loadPurchaseOrderHistory = () => {
    setIsHistoryLoading(true);
    apiRequest("/purchase-orders")
      .then((data) => {
        setPurchaseOrderHistory(data);
        setHistoryLoadError("");
      })
      .catch((err) => setHistoryLoadError(err.message || "Failed to load purchase order history."))
      .finally(() => setIsHistoryLoading(false));
  };

  useEffect(() => {
    loadRecommendations();
    loadPurchaseOrderHistory();
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

  const restockingTotalPages = Math.max(1, Math.ceil(filteredData.length / PAGE_SIZE));
  const restockingCurrentPage = Math.min(restockingPage, restockingTotalPages);
  const paginatedRecommendations = filteredData.slice(
    (restockingCurrentPage - 1) * PAGE_SIZE,
    restockingCurrentPage * PAGE_SIZE
  );

  useEffect(() => {
    setRestockingPage(1);
  }, [searchQuery, selectedSupplier, selectedPriority]);

  useEffect(() => {
    if (restockingPage > restockingTotalPages) setRestockingPage(restockingTotalPages);
  }, [restockingPage, restockingTotalPages]);

  const historyTotalPages = Math.max(1, Math.ceil(purchaseOrderHistory.length / HISTORY_PAGE_SIZE));
  const historyCurrentPage = Math.min(historyPage, historyTotalPages);
  const paginatedPurchaseOrderHistory = useMemo(() => {
    return purchaseOrderHistory.slice(
      (historyCurrentPage - 1) * HISTORY_PAGE_SIZE,
      historyCurrentPage * HISTORY_PAGE_SIZE
    );
  }, [purchaseOrderHistory, historyCurrentPage]);

  const goToHistoryPage = (page) => {
    if (page < 1 || page > historyTotalPages) return;
    setHistoryPage(page);
  };

  useEffect(() => {
    if (historyPage > historyTotalPages) {
      setHistoryPage(historyTotalPages);
    }
  }, [historyPage, historyTotalPages]);

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
      loadPurchaseOrderHistory();
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
    loadPurchaseOrderHistory();
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
        loadPurchaseOrderHistory();
      } catch (err) {
        setActionError(err.message || "Failed to cancel purchase order.");
        return;
      }
    }
    setPoDraft(null);
    setSavedPoId(null);
    setActiveTab("restocking");
  };

  const handleViewPurchaseOrder = async (purchaseOrderId) => {
    setActionError("");
    setViewingPurchaseOrderId(purchaseOrderId);
    setIsViewLoading(true);
    try {
      const [poDetails, warehouseRows] = await Promise.all([
        apiRequest(`/purchase-orders/${purchaseOrderId}`),
        apiRequest("/warehouses"),
      ]);
      const activeWarehouses = warehouseRows.filter(
        (warehouse) => String(warehouse.status || "Active") === "Active"
      );
      setViewPurchaseOrder(poDetails);
      setWarehouses(activeWarehouses);
      setReceiveWarehouseId(activeWarehouses[0]?.id || "");
    } catch (err) {
      setActionError(err.message || "Failed to load purchase order details.");
    } finally {
      setIsViewLoading(false);
    }
  };

  const closeViewPurchaseOrder = () => {
    setViewingPurchaseOrderId(null);
    setViewPurchaseOrder(null);
    setReceiveWarehouseId("");
    setWarehouses([]);
  };

  const handleReceivePurchaseOrder = async () => {
    if (!viewPurchaseOrder) return;
    if (!receiveWarehouseId) {
      setActionError("Please select a warehouse before receiving this purchase order.");
      return;
    }

    const poId = viewPurchaseOrder.PurchaseOrderID;
    setIsReceiving(true);
    setActionError("");
    try {
      await apiRequest(`/purchase-orders/${poId}/receive`, {
        method: "PUT",
        body: JSON.stringify({ warehouseId: receiveWarehouseId }),
      });
      setViewPurchaseOrder((prev) => (prev ? { ...prev, Status: "Received" } : prev));
      loadPurchaseOrderHistory();
      loadRecommendations();
      alert("Purchase order marked as received and inventory was updated.");
    } catch (err) {
      setActionError(err.message || "Failed to receive purchase order.");
    } finally {
      setIsReceiving(false);
    }
  };

  return (
    <div className="restocking-page">
      <div className="restocking-inner">
        <h1 className="restocking-title">Restocking Assistant</h1>

        {loadError && <p style={{ color: "#dc2626", fontWeight: 600 }}>{loadError}</p>}
        {historyLoadError && <p style={{ color: "#dc2626", fontWeight: 600 }}>{historyLoadError}</p>}
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
            <button
              className={`restocking-tab ${activeTab === "purchaseOrderHistory" ? "active" : ""}`}
              onClick={() => setActiveTab("purchaseOrderHistory")}
            >
              Purchase Order History
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
              <div className="paginated-table-scroll">
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
                      <th>Product ID</th>
                      <th>Product Name</th>
                      <th>Current Stock</th>
                      <th>Reorder Level</th>
                      <th>Suggested Qty</th>
                      <th>Confidence</th>
                      <th>Priority</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {isLoading && (
                      <tr><td colSpan={10} style={{ textAlign: "center", padding: 24 }}>Loading…</td></tr>
                    )}
                    {!isLoading && filteredData.length === 0 && (
                      <tr>
                        <td colSpan={10} style={{ textAlign: "center", padding: 24 }}>
                          No open recommendations. Click "Generate Recommendations" to scan for low stock.
                        </td>
                      </tr>
                    )}
                    {!isLoading &&
                      paginatedRecommendations.map((item) => {
                        const isSelected = selectedRows.includes(item.restockId);
                        return (
                          <tr key={item.restockId} className={isSelected ? "selected-row" : ""} title={`${item.productName} Â· ${item.supplierName}`}>
                            <td>
                              <input
                                type="checkbox"
                                className="restocking-checkbox"
                                checked={isSelected}
                                onChange={() => toggleRowSelect(item.restockId)}
                              />
                            </td>
                            <td>{item.restockId}</td>
                            <td>{item.productId}</td>
                            <td>{item.productName || "—"}</td>
                            <td>{item.currentStock}</td>
                            <td>{item.reorderLevel}</td>
                            <td>{item.suggestedQty}</td>
                            <td>{item.confidence != null ? `${Number(item.confidence).toFixed(0)}%` : "—"}</td>
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
              {!isLoading && (
                <Pagination currentPage={restockingCurrentPage} totalPages={restockingTotalPages} onPageChange={setRestockingPage} />
              )}
            </div>
          </>
        )}

        {/* TAB 2: PURCHASE ORDER HISTORY */}
        {activeTab === "purchaseOrderHistory" && (
          <>
            <div className="restocking-table-wrap">
              <div className="paginated-table-scroll">
                <table className="restocking-table">
                  <thead>
                    <tr>
                      <th>Purchase Order ID</th>
                      <th>Supplier Name</th>
                      <th>Date</th>
                      <th>Product Name</th>
                      <th>Qty</th>
                      <th>Total</th>
                      <th>Status</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {isHistoryLoading && (
                      <tr><td colSpan={8} style={{ textAlign: "center", padding: 24 }}>Loading…</td></tr>
                    )}

                    {!isHistoryLoading && paginatedPurchaseOrderHistory.length === 0 && (
                      <tr>
                        <td colSpan={8} style={{ textAlign: "center", padding: 24 }}>
                          No purchase order history yet.
                        </td>
                      </tr>
                    )}

                    {!isHistoryLoading &&
                      paginatedPurchaseOrderHistory.map((po) => {
                        const displayStatus = displayPurchaseOrderStatus(po.status);
                        const statusClass = displayStatus.toLowerCase();
                        return (
                          <tr key={po.id}>
                            <td>{po.poNo || po.id}</td>
                            <td>{po.supplier || "—"}</td>
                            <td>{po.orderDate ? new Date(po.orderDate).toLocaleDateString() : "—"}</td>
                            <td>{po.productNames || "—"}</td>
                            <td>{Number(po.totalQty || 0)}</td>
                            <td>{formatPeso(po.totalAmount)}</td>
                            <td>
                              <span className={`po-history-status-pill ${statusClass}`}>{displayStatus}</span>
                            </td>
                            <td>
                              <button
                                type="button"
                                className="po-history-view-btn"
                                onClick={() => handleViewPurchaseOrder(po.id)}
                              >
                                <Eye size={14} /> View
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
              {!isHistoryLoading && (
                <Pagination currentPage={historyCurrentPage} totalPages={historyTotalPages} onPageChange={goToHistoryPage} />
              )}
            </div>
          </>
        )}

        {/* TAB 3: PURCHASE ORDER VIEW */}
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

      {viewingPurchaseOrderId && (
        <div className="po-history-modal-overlay" onClick={closeViewPurchaseOrder}>
          <div className="po-history-modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="po-history-modal-header">
              <h3>Purchase Order Details</h3>
              <button type="button" className="po-history-close-btn" onClick={closeViewPurchaseOrder}>
                Close
              </button>
            </div>

            {isViewLoading && <p className="po-history-placeholder">Loading purchase order…</p>}

            {!isViewLoading && viewPurchaseOrder && (
              <>
                <div className="po-history-details-grid">
                  <div><strong>Purchase Order ID:</strong> {viewPurchaseOrder.PONo || viewPurchaseOrder.PurchaseOrderID}</div>
                  <div><strong>Supplier Name:</strong> {viewPurchaseOrder.SupplierName || "—"}</div>
                  <div><strong>Date:</strong> {viewPurchaseOrder.OrderDate ? new Date(viewPurchaseOrder.OrderDate).toLocaleString() : "—"}</div>
                  <div>
                    <strong>Status:</strong>{" "}
                    <span
                      className={`po-history-status-pill ${displayPurchaseOrderStatus(viewPurchaseOrder.Status).toLowerCase()}`}
                    >
                      {displayPurchaseOrderStatus(viewPurchaseOrder.Status)}
                    </span>
                  </div>
                  <div><strong>Total:</strong> {formatPeso(viewPurchaseOrder.TotalAmount)}</div>
                </div>

                <div className="po-history-items-wrap">
                  <table className="po-history-items-table">
                    <thead>
                      <tr>
                        <th>Product Name</th>
                        <th>Qty</th>
                        <th>Unit Cost</th>
                        <th>Subtotal</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(viewPurchaseOrder.items || []).map((item, index) => (
                        <tr key={`${item.productId}-${index}`}>
                          <td>{item.productName}</td>
                          <td>{item.qty}</td>
                          <td>{formatPeso(item.costPrice)}</td>
                          <td>{formatPeso(item.subtotal)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {canReceivePurchaseOrder(viewPurchaseOrder.Status) && (
                  <div className="po-history-receive-row">
                    <label htmlFor="receive-warehouse-select">Receive to Warehouse</label>
                    <select
                      id="receive-warehouse-select"
                      value={receiveWarehouseId}
                      onChange={(event) => setReceiveWarehouseId(event.target.value)}
                      className="po-history-warehouse-select"
                    >
                      {warehouses.length === 0 && <option value="">No active warehouses</option>}
                      {warehouses.map((warehouse) => (
                        <option key={warehouse.id} value={warehouse.id}>
                          {warehouse.name} ({warehouse.id})
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="po-history-receive-btn"
                      onClick={handleReceivePurchaseOrder}
                      disabled={isReceiving || !receiveWarehouseId || warehouses.length === 0}
                    >
                      {isReceiving ? "Receiving…" : "Mark as Received"}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

