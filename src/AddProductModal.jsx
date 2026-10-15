import React, { useEffect, useState } from "react";
import "./AddProductModal.css";
import { Settings } from "lucide-react";
import ManageProductLookup from "./ManageProductLookup";
import { apiRequest } from "./api";

const emptyForm = {
  productName: "",
  categoryId: "",
  brandId: "",
  supplierId: "",
  unit: "",
  unitValue: "",
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

  const [manager, setManager] = useState(null);
  const [customName, setCustomName] = useState(false);
  const categoryName = categories.find(c => String(c.id) === String(form.categoryId))?.name || "";
  const canDeriveName = ["cylinder", "gasul lpg"].includes(categoryName.trim().toLowerCase());
  const suggestedName = [brands.find(b => String(b.id) === String(form.brandId))?.name, categories.find(c => String(c.id) === String(form.categoryId))?.name, form.unitValue, form.unit].filter(v => v !== "" && v != null).join(" ");
  const productName = canDeriveName && !customName ? suggestedName : form.productName;

  const isEditing = Boolean(selectedProduct);

  useEffect(() => {
    if (!isOpen) return;
    setError("");
    setManager(null);
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
    setCustomName(Boolean(selectedProduct));
    if (selectedProduct) {
      setForm({
        productName: selectedProduct.name || "",
        categoryId: selectedProduct.categoryId || "",
        brandId: selectedProduct.brandId || "",
        supplierId: selectedProduct.supplierId || "",
        unit: selectedProduct.unit === "pcs" ? "pc" : selectedProduct.unit || "",
        unitValue: String(selectedProduct.unitValue ?? "").replace(/[^0-9.]/g, ""),
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

    if (!productName.trim()) {
      setError("Product name is required.");
      return;
    }

    if (!form.categoryId || !form.brandId || !form.supplierId || !form.unit || form.unitValue === "" || !Number.isFinite(Number(form.unitValue)) || Number(form.unitValue) < 0) {
      setError("Brand, category, supplier, unit and a non-negative numeric unit value are required.");
      return;
    }

    const payload = {
      productName: productName.trim(),
      categoryId: String(form.categoryId),
      brandId: String(form.brandId),
      supplierId: String(form.supplierId),
      unit: form.unit,
      unitValue: Number(form.unitValue),
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
                placeholder="Enter product name"
                required
                maxLength={150}
                value={productName}
                onChange={(e) => { setCustomName(true); updateField("productName", e.target.value); }}
              />
              {canDeriveName && <small className="form-field-hint">
                {customName ? <button type="button" className="product-name-reset" onClick={() => setCustomName(false)}>Use generated name</button> : "Auto-filled from brand, category, unit value and unit. You can edit this name."}
              </small>}
            </div>
          </div>

          <div className="form-row-2">
            {[['Brand', 'brandId', brands, 'brands'], ['Category', 'categoryId', categories, 'categories']].map(([label, field, options, endpoint]) => (
              <div className="form-field" key={field}>
                <label htmlFor={field}>{label} <button type="button" className="lookup-settings" aria-label={`Manage ${label}`} onClick={() => setManager({label, endpoint})}><Settings size={16} /></button></label>
                <select id={field} required value={form[field]} onChange={e => updateField(field, e.target.value)}>
                  <option value="">Select {label}</option>
                  {options.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
                </select>
              </div>
            ))}
          </div>
          <div className="form-field">
            <label htmlFor="supplierId">Supplier</label>
            <select id="supplierId" required value={form.supplierId} onChange={e => updateField('supplierId', e.target.value)}>
              <option value="">Select Supplier</option>
              {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="form-row-2">
            <div className="form-field">
              <label htmlFor="productUnit">Unit</label>
              <select id="productUnit" required value={form.unit} onChange={e => updateField('unit', e.target.value)}>
                <option value="">Select Unit</option>
                <option value="kg">Kilogram (kg)</option>
                <option value="m">Meter (m)</option>
                <option value="pc">Piece (pc)</option>
              </select>
            </div>
            <div className="form-field">
              <label htmlFor="unitValue">Unit Value</label>
              <input id="unitValue" type="number" required min="0" step="any" placeholder="e.g. 11 or 2.5" value={form.unitValue} onChange={e => updateField('unitValue', e.target.value)} />
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
                placeholder="gasul-50kg.png or https://example.com/image.png"
                value={form.imageUrl}
                onChange={(e) => updateField("imageUrl", e.target.value)}
              />
              <small className="form-field-hint">Use filename (e.g., gasul-50kg.png) or full https URL.</small>
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
      {manager && <ManageProductLookup {...manager} onClose={() => setManager(null)} onChanged={items => {
        (manager.endpoint === "brands" ? setBrands : setCategories)(items);
        const field = manager.endpoint === "brands" ? "brandId" : "categoryId";
        if (!items.some(item => String(item.id) === String(form[field]))) updateField(field, "");
        onSaved?.();
      }} />}
    </div>
  );
}

