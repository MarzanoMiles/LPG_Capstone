import React, { useEffect, useState } from "react";
import "./AddProductModal.css";
import { apiRequest } from "./api";

const emptyForm = {
  productName: "",
  categoryId: "",
  brandId: "",
  supplierId: "",
  unit: "",
  unitPrice: "",
  costPrice: "",
  reorderLevel: "",
  imageUrl: "",
  arModelUrl: "",
  status: "Active",
};

export default function AddProductModal({ isOpen, onClose, onSaved, selectedProduct }) {
  const [categories, setCategories] = useState([]);
  const [brands, setBrands] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  const isEditing = Boolean(selectedProduct);

  useEffect(() => {
    if (!isOpen) return;
    setError("");
    Promise.all([
      apiRequest("/categories"),
      apiRequest("/brands"),
      apiRequest("/suppliers"),
    ])
      .then(([categoryData, brandData, supplierData]) => {
        setCategories(categoryData);
        setBrands(brandData);
        setSuppliers(supplierData);
      })
      .catch((err) => setError(err.message || "Failed to load categories/brands/suppliers."));
  }, [isOpen]);

  useEffect(() => {
    if (selectedProduct) {
      setForm({
        productName: selectedProduct.name || "",
        categoryId: selectedProduct.categoryId || "",
        brandId: selectedProduct.brandId || "",
        supplierId: selectedProduct.supplierId || "",
        unit: selectedProduct.unit || "",
        unitPrice: selectedProduct.unitPrice ?? "",
        costPrice: selectedProduct.costPrice ?? "",
        reorderLevel: selectedProduct.reorderLevel ?? "",
        imageUrl: selectedProduct.imageUrl || "",
        arModelUrl: selectedProduct.arModelUrl || "",
        status: selectedProduct.status || "Active",
      });
    } else {
      setForm(emptyForm);
    }
  }, [selectedProduct, isOpen]);

  if (!isOpen) return null;

  const updateField = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));

  const resetAndClose = () => {
    setForm(emptyForm);
    setError("");
    onClose();
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!form.productName || !form.categoryId || !form.brandId || !form.supplierId || !form.unit) {
      setError("Product name, category, brand, supplier and unit are all required.");
      return;
    }

    const payload = {
      productName: form.productName,
      categoryId: Number(form.categoryId),
      brandId: Number(form.brandId),
      supplierId: Number(form.supplierId),
      unit: form.unit,
      unitPrice: Number(form.unitPrice) || 0,
      costPrice: Number(form.costPrice) || 0,
      reorderLevel: Number(form.reorderLevel) || 0,
      imageUrl: form.imageUrl || null,
      arModelUrl: form.arModelUrl || null,
      status: form.status,
    };

    setIsSubmitting(true);
    setError("");
    try {
      if (isEditing) {
        await apiRequest(`/products/${selectedProduct.productId}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
      } else {
        await apiRequest("/products", {
          method: "POST",
          body: JSON.stringify(payload),
        });
      }
      onSaved?.();
      resetAndClose();
    } catch (err) {
      setError(err.message || "Failed to save product.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="add-product-modal-overlay">
      <div className="add-product-modal-card">
        <h2 className="add-product-title">{isEditing ? "Edit Product" : "Product Information"}</h2>

        {error && (
          <p style={{ color: "#dc2626", fontWeight: 600, margin: "-8px 0 0 0" }}>{error}</p>
        )}

        <form className="add-product-form" onSubmit={handleSubmit}>
          {/* Row 1 */}
          <div className="form-row-2">
            <div className="form-field">
              <label>Product ID</label>
              <input
                type="text"
                value={isEditing ? selectedProduct.productId : "(auto-generated)"}
                disabled
              />
            </div>
            <div className="form-field">
              <label>Product Name</label>
              <input
                type="text"
                placeholder="Name"
                value={form.productName}
                onChange={(e) => updateField("productName", e.target.value)}
              />
            </div>
          </div>

          {/* Row 2 */}
          <div className="form-row-2">
            <div className="form-field">
              <label>Category</label>
              <select
                value={form.categoryId}
                onChange={(e) => updateField("categoryId", e.target.value)}
              >
                <option value="" disabled hidden>Category</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div className="form-field">
              <label>Supplier</label>
              <select
                value={form.supplierId}
                onChange={(e) => updateField("supplierId", e.target.value)}
              >
                <option value="" disabled hidden>Supplier</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Row 2b: Brand */}
          <div className="form-row-2">
            <div className="form-field">
              <label>Brand</label>
              <select
                value={form.brandId}
                onChange={(e) => updateField("brandId", e.target.value)}
              >
                <option value="" disabled hidden>Brand</option>
                {brands.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
            <div className="form-field">
              <label>Unit</label>
              <select value={form.unit} onChange={(e) => updateField("unit", e.target.value)}>
                <option value="" disabled hidden>Unit</option>
                <option value="kg">Kilogram</option>
                <option value="m">Meter</option>
                <option value="pcs">Item</option>
              </select>
            </div>
          </div>

          {/* Row 3 */}
          <div className="form-row-3">
            <div className="form-field">
              <label>Unit Price</label>
              <input
                type="number"
                step="0.01"
                placeholder="₱ 0.00"
                value={form.unitPrice}
                onChange={(e) => updateField("unitPrice", e.target.value)}
              />
            </div>
            <div className="form-field">
              <label>Cost Price</label>
              <input
                type="number"
                step="0.01"
                placeholder="₱ 0.00"
                value={form.costPrice}
                onChange={(e) => updateField("costPrice", e.target.value)}
              />
            </div>
            <div className="form-field">
              <label>Reorder Level</label>
              <input
                type="number"
                placeholder="Enter Number"
                value={form.reorderLevel}
                onChange={(e) => updateField("reorderLevel", e.target.value)}
              />
            </div>
          </div>

          {/* Row 4 */}
          <div className="form-row-2">
            <div className="form-field">
              <label>Status</label>
              <select value={form.status} onChange={(e) => updateField("status", e.target.value)}>
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
              </select>
            </div>
            <div className="form-field">
              <label>Image URL</label>
              <input
                type="text"
                placeholder="assets/products/example.png"
                value={form.imageUrl}
                onChange={(e) => updateField("imageUrl", e.target.value)}
              />
            </div>
          </div>

          {/* Row 5 */}
          <div className="form-field">
            <label>AR Model URL</label>
            <input
              type="text"
              placeholder="URL link"
              value={form.arModelUrl}
              onChange={(e) => updateField("arModelUrl", e.target.value)}
            />
          </div>

          {/* Actions */}
          <div className="add-product-modal-actions">
            <button type="button" className="btn-modal-cancel" onClick={resetAndClose}>
              Cancel
            </button>
            <button type="submit" className="btn-modal-add" disabled={isSubmitting}>
              {isSubmitting ? "Saving…" : isEditing ? "Save" : "Add"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}