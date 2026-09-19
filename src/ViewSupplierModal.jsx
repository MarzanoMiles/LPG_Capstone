import React, { useEffect, useState } from "react";
import "./ViewSupplierModal.css";
import { apiRequest } from "./api";

function formatPeso(amount) {
  return `₱ ${Number(amount).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
}

export default function ViewSupplierModal({ isOpen, onClose, supplier }) {
  const [activeTab, setActiveTab] = useState("Supplier Products");
  const [products, setProducts] = useState([]);
  const [purchaseOrders, setPurchaseOrders] = useState([]);
  const [deliveries, setDeliveries] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isOpen || !supplier) return;
    setIsLoading(true);
    setError("");
    Promise.all([
      apiRequest(`/suppliers/${supplier.id}/products`),
      apiRequest(`/suppliers/${supplier.id}/purchase-orders`),
      apiRequest(`/suppliers/${supplier.id}/deliveries`),
    ])
      .then(([productData, poData, deliveryData]) => {
        setProducts(productData);
        setPurchaseOrders(poData);
        setDeliveries(deliveryData);
      })
      .catch((err) => setError(err.message || "Failed to load supplier history."))
      .finally(() => setIsLoading(false));
  }, [isOpen, supplier]);

  if (!isOpen || !supplier) return null;

  return (
    <div className="view-supplier-modal-overlay">
      <div className="view-supplier-modal-card">
        <h2 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 800 }}>{supplier.name}</h2>
        <p style={{ margin: "4px 0 0 0", color: "#6b7280", fontSize: "0.9rem" }}>
          {supplier.contactPerson} · {supplier.phone} · {supplier.email}
        </p>

        {error && <p style={{ color: "#dc2626", fontWeight: 600 }}>{error}</p>}

        {/* Navigation Tabs */}
        <div className="supplier-modal-tabs">
          <button
            type="button"
            className={`tab-btn ${activeTab === "Supplier Products" ? "active" : ""}`}
            onClick={() => setActiveTab("Supplier Products")}
          >
            Supplier Products
          </button>
          <button
            type="button"
            className={`tab-btn ${activeTab === "Purchase Order" ? "active" : ""}`}
            onClick={() => setActiveTab("Purchase Order")}
          >
            Purchase Order
          </button>
          <button
            type="button"
            className={`tab-btn ${activeTab === "Delivery History" ? "active" : ""}`}
            onClick={() => setActiveTab("Delivery History")}
          >
            Delivery History
          </button>
        </div>

        {/* Tab Content Display */}
        <div className="tab-content">
          {isLoading && <p className="placeholder-text">Loading…</p>}

          {!isLoading && activeTab === "Supplier Products" && (
            <div className="view-supplier-table-wrap">
              <table className="view-supplier-table">
                <thead>
                  <tr>
                    <th>Product ID</th>
                    <th>Product Name</th>
                    <th>Cost Price</th>
                    <th>Unit</th>
                    <th>Reorder Level</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {products.length === 0 && (
                    <tr><td colSpan={6} className="placeholder-text">No products from this supplier yet.</td></tr>
                  )}
                  {products.map((prod) => (
                    <tr key={prod.id}>
                      <td>{prod.id}</td>
                      <td>{prod.name}</td>
                      <td>{formatPeso(prod.costPrice)}</td>
                      <td>{prod.unit}</td>
                      <td>{prod.reorderLevel}</td>
                      <td>{prod.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!isLoading && activeTab === "Purchase Order" && (
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
                    <tr><td colSpan={5} className="placeholder-text">No purchase orders for this supplier yet.</td></tr>
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

          {!isLoading && activeTab === "Delivery History" && (
            <div className="view-supplier-table-wrap">
              <table className="view-supplier-table">
                <thead>
                  <tr>
                    <th>Purchase Order ID</th>
                    <th>Date Received</th>
                    <th>Total Quantity</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {deliveries.length === 0 && (
                    <tr><td colSpan={4} className="placeholder-text">No completed deliveries from this supplier yet.</td></tr>
                  )}
                  {deliveries.map((d) => (
                    <tr key={d.poId}>
                      <td>{d.poNo}</td>
                      <td>{new Date(d.orderDate).toLocaleDateString()}</td>
                      <td>{d.totalQty}</td>
                      <td>{d.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="view-supplier-modal-actions">
          <button type="button" className="btn-modal-back" onClick={onClose}>
            Back
          </button>
        </div>
      </div>
    </div>
  );
}