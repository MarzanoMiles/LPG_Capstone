import { numericUnitValue } from "./utils/unitValue.js";
import React, { useEffect, useState } from "react";
import "./AddProductModal.css";
import { Settings } from "lucide-react";
import ManageProductLookup from "./ManageProductLookup";
import { apiRequest } from "./api";
import { resolveProductImage } from "./utils/productImages";

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
  minOrderQuantity: "1",
  budgetCap: "",
  priorityTag: "Normal",
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
  const [isUploading, setIsUploading] = useState(false);

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
        unitValue: String(numericUnitValue(selectedProduct.unitValue, selectedProduct.unit) ?? ""),
        unitPrice: selectedProduct.unitPrice ?? "",
        costPrice: selectedProduct.costPrice ?? "",
        reorderLevel: selectedProduct.reorderLevel ?? "",
        minOrderQuantity: String(selectedProduct.minOrderQuantity ?? 1),
        budgetCap: selectedProduct.budgetCap ?? "",
        priorityTag: selectedProduct.priorityTag || "Normal",
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

  const handleImageChange = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setError("Choose a PNG, JPG or WebP image.");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setError("Image must be under 2 MB.");
      return;
    }
    setError("");
    setIsUploading(true);
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error("Could not read the image."));
        reader.readAsDataURL(file);
      });
      const result = await apiRequest("/products/image", {
        method: "POST",
        body: JSON.stringify({ dataUrl }),
      });
      updateField("imageUrl", result.imageUrl);
    } catch (err) {
      setError(err.message || "Failed to upload image.");
    } finally {
      setIsUploading(false);
    }
  };

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

    if (!Number.isInteger(Number(form.minOrderQuantity)) || Number(form.minOrderQuantity) < 1) {
      setError("Minimum order quantity must be a whole number of at least 1.");
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
      minOrderQuantity: Number(form.minOrderQuantity),
      budgetCap: form.budgetCap === "" ? null : Number(form.budgetCap),
      priorityTag: form.priorityTag,
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
                <label htmlFor={field}>{label} <button type="button" className="lookup-settings" aria-label={`Manage ${label}`} onClick={() => setManager({ label, endpoint })}><Settings size={16} /></button></label>
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

          <div className="form-row-3">
            <div className="form-field">
              <label>Min Order Qty</label>
              <input type="number" min="1" step="1" value={form.minOrderQuantity}
                onChange={(e) => updateField("minOrderQuantity", e.target.value)} />
            </div>
            <div className="form-field">
              <label>Budget Cap (₱)</label>
              <input type="number" min="0" step="0.01" placeholder="No cap" value={form.budgetCap}
                onChange={(e) => updateField("budgetCap", e.target.value)} />
            </div>
            <div className="form-field">
              <label>Restock Priority</label>
              <select value={form.priorityTag} onChange={(e) => updateField("priorityTag", e.target.value)}>
                <option value="High">High</option>
                <option value="Normal">Normal</option>
                <option value="Low">Low</option>
              </select>
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
              <label>Product Image</label>
              <div className="product-image-upload">
                {form.imageUrl && (
                  <img className="product-image-preview" src={resolveProductImage({ imageUrl: form.imageUrl })} alt="Product preview" />
                )}
                <div className="product-image-actions">
                  <label className="btn-file-upload">
                    {isUploading ? "Uploading…" : form.imageUrl ? "Change image" : "Upload image"}
                    <input type="file" accept="image/png,image/jpeg,image/webp" hidden disabled={isUploading} onChange={handleImageChange} />
                  </label>
                  {form.imageUrl && (
                    <button type="button" className="product-name-reset" onClick={() => updateField("imageUrl", "")}>Remove</button>
                  )}
                </div>
              </div>
              <small className="form-field-hint">PNG, JPG or WebP, up to 2 MB.</small>
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
            <button type="submit" className="btn-modal-add" disabled={isSubmitting || isUploading}>
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

