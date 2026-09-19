import React, { useEffect, useMemo, useState } from "react";
import {
  Search,
  ChevronDown,
  Plus,
  FileText,
  Pencil,
  Trash2,
  X,
} from "lucide-react";
import AddProductModal from "./AddProductModal";
import { apiRequest } from "./api";
import "./Products.css";

const pesoFormatter = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
});

// ---------------------------------------------------------------------------
// Lightweight inline "View" modal
// ---------------------------------------------------------------------------

function ViewProductModal({ product, onClose }) {
  if (!product) return null;
  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(17,24,39,0.45)",
        display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16,
      }}
      onClick={onClose}
    >
      <div
        style={{ background: "#fff", borderRadius: 12, padding: "24px 28px", width: "100%", maxWidth: 420, boxShadow: "0 20px 50px rgba(0,0,0,0.2)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ fontSize: "1.25rem", fontWeight: 800, margin: 0 }}>Product Details</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer" }}>
            <X size={20} />
          </button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 16, fontSize: "0.9rem" }}>
          <div><strong>Product ID:</strong> {product.ProductID}</div>
          <div><strong>Name:</strong> {product.ProductName}</div>
          <div><strong>Category:</strong> {product.Category}</div>
          <div><strong>Brand:</strong> {product.Brand}</div>
          <div><strong>Supplier:</strong> {product.SupplierName}</div>
          <div><strong>Unit:</strong> {product.Unit}</div>
          <div><strong>Unit Price:</strong> {pesoFormatter.format(product.UnitPrice)}</div>
          <div><strong>Cost Price:</strong> {pesoFormatter.format(product.CostPrice)}</div>
          <div><strong>Reorder Level:</strong> {product.ReorderLevel}</div>
          <div><strong>Status:</strong> {product.Status}</div>
        </div>
        <button
          onClick={onClose}
          style={{ marginTop: 20, width: "100%", padding: "10px 0", borderRadius: 8, border: "none", background: "#e5e7eb", color: "#111827", fontWeight: 700, cursor: "pointer" }}
        >
          Close
        </button>
      </div>
    </div>
  );
}

export default function Products() {
  const [products, setProducts] = useState([]);
  const [loadError, setLoadError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All Categories");
  const [selectedStatus, setSelectedStatus] = useState("Active"); // hide deactivated products by default

  const [isAddProductOpen, setIsAddProductOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null); // raw row from /products used to prefill the modal
  const [viewingProduct, setViewingProduct] = useState(null); // full detail from /products/:id
  const [actionError, setActionError] = useState("");

  const loadProducts = () => {
    setIsLoading(true);
    const params = new URLSearchParams();
    if (searchQuery.trim()) params.set("search", searchQuery.trim());
    if (selectedCategory !== "All Categories") params.set("category", selectedCategory);
    if (selectedStatus !== "All Status") params.set("status", selectedStatus);
    const endpoint = params.toString() ? `/products?${params.toString()}` : "/products";

    apiRequest(endpoint)
      .then((data) => {
        setProducts(data);
        setLoadError("");
      })
      .catch((err) => {
        setProducts([]);
        setLoadError(err.message || "Failed to load products.");
      })
      .finally(() => setIsLoading(false));
  };

  useEffect(() => {
    loadProducts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, selectedCategory, selectedStatus]);

  const productRows = useMemo(
    () =>
      products.map((product) => ({
        productId: product.productId,
        productName: product.name,
        category: product.category,
        supplier: product.supplier,
        costPrice: pesoFormatter.format(Number(product.costPrice || 0)),
        status: product.status,
      })),
    [products]
  );

  const handleOpenAdd = () => {
    setEditingProduct(null);
    setIsAddProductOpen(true);
  };

  const handleOpenEdit = async (productId) => {
    setActionError("");
    try {
      const full = await apiRequest(`/products/${productId}`);
      // AddProductModal expects a flat shape with *Id fields — map the joined detail response
      setEditingProduct({
        productId: full.ProductID,
        name: full.ProductName,
        categoryId: full.CategoryID,
        brandId: full.BrandID,
        supplierId: full.SupplierID,
        unit: full.Unit,
        unitPrice: full.UnitPrice,
        costPrice: full.CostPrice,
        reorderLevel: full.ReorderLevel,
        imageUrl: full.ImageURL,
        arModelUrl: full.ARModelURL,
        status: full.Status,
      });
      setIsAddProductOpen(true);
    } catch (err) {
      setActionError(err.message || "Failed to load product for editing.");
    }
  };

  const handleView = async (productId) => {
    setActionError("");
    try {
      const full = await apiRequest(`/products/${productId}`);
      setViewingProduct(full);
    } catch (err) {
      setActionError(err.message || "Failed to load product details.");
    }
  };

  const handleDelete = async (productId, productName) => {
    const confirmed = window.confirm(
      `Deactivate "${productName}"? It will no longer appear in POS or the Active product list, but its sales and inventory history will be kept. You can reactivate it later by editing it and setting Status back to Active.`
    );
    if (!confirmed) return;

    setActionError("");
    try {
      await apiRequest(`/products/${productId}`, { method: "DELETE" });
      loadProducts();
    } catch (err) {
      setActionError(err.message || "Failed to deactivate product.");
    }
  };

  return (
    <div className="products-page">
      <div className="products-inner">
        <h1 className="products-title">Products</h1>
        {loadError && <p className="products-error" style={{ color: "#dc2626" }}>{loadError}</p>}
        {actionError && <p className="products-error" style={{ color: "#dc2626" }}>{actionError}</p>}

        <div className="products-toolbar">
          <div className="products-search">
            <input
              type="text"
              placeholder="Search Product"
              className="products-search-input"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <Search size={16} className="products-search-icon" />
          </div>

          <div className="products-select-wrap">
            <select
              className="products-select"
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
            >
              <option value="All Categories">All Categories</option>
              <option value="Gasul LPG">Gasul LPG</option>
              <option value="Cylinder">Cylinder</option>
              <option value="Accessories">Accessories</option>
            </select>
            <ChevronDown size={16} className="products-select-icon" />
          </div>

          <div className="products-select-wrap">
            <select
              className="products-select"
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
            >
              <option value="All Status">All Status</option>
              <option value="Active">Active</option>
              <option value="Inactive">Inactive</option>
            </select>
            <ChevronDown size={16} className="products-select-icon" />
          </div>

          <button className="add-product-btn" onClick={handleOpenAdd}>
            <Plus size={16} /> Add Product
          </button>
        </div>

        <div className="products-table-wrap">
          <table className="products-table">
            <thead>
              <tr>
                <th>Product ID</th>
                <th>Product Name</th>
                <th>Category</th>
                <th>Supplier</th>
                <th>Cost Price</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={7} style={{ textAlign: "center", padding: 24 }}>Loading…</td></tr>
              )}
              {!isLoading && productRows.length === 0 && (
                <tr><td colSpan={7} style={{ textAlign: "center", padding: 24 }}>No products found.</td></tr>
              )}
              {!isLoading &&
                productRows.map((product) => (
                  <tr key={product.productId}>
                    <td>{product.productId}</td>
                    <td>{product.productName}</td>
                    <td>{product.category}</td>
                    <td>{product.supplier}</td>
                    <td>{product.costPrice}</td>
                    <td>
                      <span className={`products-status-pill ${product.status.toLowerCase()}`}>
                        {product.status}
                      </span>
                    </td>
                    <td>
                      <div className="products-action-icons">
                        <button
                          className="products-action-icon view"
                          title="View"
                          onClick={() => handleView(product.productId)}
                        >
                          <FileText size={16} />
                        </button>
                        <button
                          className="products-action-icon edit"
                          title="Edit"
                          onClick={() => handleOpenEdit(product.productId)}
                        >
                          <Pencil size={16} />
                        </button>
                        <button
                          className="products-action-icon delete"
                          title="Deactivate"
                          onClick={() => handleDelete(product.productId, product.productName)}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      <AddProductModal
        isOpen={isAddProductOpen}
        selectedProduct={editingProduct}
        onClose={() => {
          setIsAddProductOpen(false);
          setEditingProduct(null);
        }}
        onSaved={loadProducts}
      />

      <ViewProductModal product={viewingProduct} onClose={() => setViewingProduct(null)} />
    </div>
  );
}