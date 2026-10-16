import PageLayout, { PageHeader } from "./PageLayout";
import Pagination from "./Pagination";
import React, { useEffect, useMemo, useState } from "react";
import {
  Search,
  ChevronDown,
  Box,
  Sliders,
  Package,
  Trash2,
  RefreshCw,
} from "lucide-react";
import { POCreationModal, POTable } from "./PurchaseOrderWorkflow";
import CustomizeRestockModal from "./CustomizeRestockModal";
import CustomizeSingleItemModal from "./CustomizeSingleItemModal";
import { apiRequest } from "./api";
import "./Restocking.css";

const PAGE_SIZE = 5;

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
  const [isCustomizeOpen, setIsCustomizeOpen] = useState(false);
  const [isSingleCustomizeOpen, setIsSingleCustomizeOpen] = useState(false);
  const [selectedItemForCustomize, setSelectedItemForCustomize] = useState(null);

  // Draft Purchase Order (built from checked restocking rows, not yet saved to backend)
  const [poDraft, setPoDraft] = useState(null); // { supplierId, supplierName, restockIds, items: [...] }
  const [restockingPage, setRestockingPage] = useState(1);
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

  };

  const handleBuildFromSelection = () => {
    const items = recommendations.filter((r) => selectedRows.includes(r.restockId));
    if (!items.length) {
      setActionError("");
      setPoDraft({ supplierId: "", supplierName: "", restockIds: [], items: [] });
      return;
    }
    buildDraftFromItems(items);
  };

  return (
    <PageLayout className="restocking-page" contentClassName="restocking-inner">

        <PageHeader title="Restocking Assistant" />

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
            >
              Purchase Order <span className="po-tab-badge">{purchaseOrderHistory.filter(po => !["Received", "Cancelled"].includes(po.status)).length}</span>
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

        {activeTab === "purchaseOrder" && <POTable orders={purchaseOrderHistory} loading={isHistoryLoading} onRefresh={() => { loadPurchaseOrderHistory(); loadRecommendations(); }} />}
        {poDraft && <POCreationModal draft={poDraft} onClose={() => { setPoDraft(null); loadPurchaseOrderHistory(); loadRecommendations(); }} onSaved={() => { setPoDraft(null); setSelectedRows([]); loadRecommendations(); loadPurchaseOrderHistory(); }} />}

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

    </PageLayout>
  );
}

