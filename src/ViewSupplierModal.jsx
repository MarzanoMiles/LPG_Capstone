import React, { useEffect, useState } from "react";
import "./ViewSupplierModal.css";
import { X } from "lucide-react";
import { apiRequest } from "./api";

function formatPeso(amount) {
  return `₱ ${Number(amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function ViewSupplierModal({ isOpen, onClose, supplier }) {
  const [activeTab, setActiveTab] = useState("Supplier Profile");
  const [products, setProducts] = useState([]);
  const [purchaseOrders, setPurchaseOrders] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isOpen || !supplier) return;
    let cancelled = false;
    setActiveTab("Supplier Profile");
    setProducts([]);
    setPurchaseOrders([]);
    setIsLoading(true);
    setError("");
    Promise.all([
      apiRequest(`/suppliers/${supplier.id}/products`),
      apiRequest(`/suppliers/${supplier.id}/purchase-orders`),
    ])
      .then(([productData, poData]) => {
        if (cancelled) return;
        setProducts(productData);
        setPurchaseOrders(poData);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || "Failed to load supplier history.");
      })
      .finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, [isOpen, supplier]);

  if (!isOpen || !supplier) return null;

  return (
    <div className="view-supplier-modal-overlay" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }} onKeyDown={(event) => { if (event.key === "Escape") onClose(); }}>
      <div className="view-supplier-modal-card" role="dialog" aria-modal="true" aria-labelledby="supplier-detail-title">
        <div className="supplier-view-header">
          <div>
            <h2 id="supplier-detail-title">View Supplier</h2>
            <p>{supplier.name}</p>
          </div>
          <button type="button" className="supplier-view-close" aria-label="Close View Supplier" title="Close" onClick={onClose}><X size={20} aria-hidden="true" /></button>
        </div>


        <div className="supplier-modal-tabs" role="tablist" aria-label="Supplier details">
          {["Supplier Profile", "Products", "Purchase Order History"].map((tab, index, tabs) => (
            <button key={tab} type="button" role="tab" id={`supplier-tab-${index}`}
              aria-selected={activeTab === tab} aria-controls="supplier-tab-panel"
              tabIndex={activeTab === tab ? 0 : -1} className={activeTab === tab ? "active" : ""}
              onClick={() => setActiveTab(tab)}
              onKeyDown={(event) => {
                if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                event.preventDefault();
                const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
                setActiveTab(tabs[next]);
                document.getElementById(`supplier-tab-${next}`)?.focus();
              }}>
              {tab}{tab !== "Supplier Profile" && !isLoading && !error && <span>{tab === "Products" ? products.length : purchaseOrders.length}</span>}
            </button>
          ))}
        </div>

        {/* Tab Content Display */}
        <div className="tab-content" role="tabpanel" id="supplier-tab-panel" aria-labelledby={`supplier-tab-${["Supplier Profile", "Products", "Purchase Order History"].indexOf(activeTab)}`} tabIndex={0}>
          {activeTab === "Supplier Profile" && (
        <dl className="supplier-detail-grid">
          {[
            ["Supplier ID", supplier.id],
            ["Supplier Name", supplier.name],
            ["Contact Person", supplier.contactPerson],
            ["Email", supplier.email],
            ["Address", supplier.address],
            ["Contact Number", supplier.phone],
            ["Lead Time (Days)", supplier.leadTime],
            ["Status", supplier.status],
          ].map(([label, value]) => (
            <div key={label} className="supplier-detail-field">
              <dt>{label}</dt>
              <dd>{value ?? "\u2014"}</dd>
            </div>
          ))}
        </dl>
          )}
          {activeTab !== "Supplier Profile" && error && <p className="supplier-view-error" role="alert">{error}</p>}
          {activeTab !== "Supplier Profile" && isLoading && <p className="placeholder-text">Loading…</p>}

          {!isLoading && !error && activeTab === "Products" && (
            <div className="view-supplier-table-wrap">
              <table className="view-supplier-table">
                <thead>
                  <tr>
                    <th>Product ID</th>
                    <th>Product Name</th>
                    <th>Cost Price</th>
                    <th>Unit</th>
                    <th>Unit Value</th>
                    <th>Reorder Level</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {products.length === 0 && (
                    <tr><td colSpan={7} className="placeholder-text">No products associated with this supplier.</td></tr>
                  )}
                  {products.map((prod) => (
                    <tr key={prod.id}>
                      <td>{prod.id}</td>
                      <td>{prod.name}</td>
                      <td>{formatPeso(prod.costPrice)}</td>
                      <td>{prod.unit}</td>
                      <td>{prod.unitValue ?? "\u2014"}</td>
                      <td>{prod.reorderLevel}</td>
                      <td>{prod.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!isLoading && !error && activeTab === "Purchase Order History" && (
            <div className="view-supplier-table-wrap">
              <table className="view-supplier-table">
                <thead>
                  <tr>
                    <th>Purchase Order ID</th>
                    <th>Date</th>
                    <th>Total Amount</th>
                    <th>Expected Date</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {purchaseOrders.length === 0 && (
                    <tr><td colSpan={5} className="placeholder-text">No purchase order history available.</td></tr>
                  )}
                  {purchaseOrders.map((po) => (
                    <tr key={po.id}>
                      <td>{po.poNo}</td>
                      <td>{new Date(po.orderDate).toLocaleDateString()}</td>
                      <td>{formatPeso(po.totalAmount)}</td>
                      <td>{po.expectedDeliveryDate ? new Date(po.expectedDeliveryDate).toLocaleDateString() : "—"}</td>
                      <td>{po.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}


        </div>


      </div>
    </div>
  );
}

