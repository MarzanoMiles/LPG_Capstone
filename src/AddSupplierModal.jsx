import React, { useEffect, useState } from "react";
import "./AddSupplierModal.css";
import { apiRequest } from "./api";

const emptyForm = {
  fullName: "",
  supplierType: "Manufacturer",
  defaultLeadTime: "",
  status: "Active",
  contactPerson: "",
  email: "",
  phone: "",
  address: "",
};

export default function AddSupplierModal({ isOpen, onClose, selectedSupplier, onSaved }) {
  const [formData, setFormData] = useState(emptyForm);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  const isEditing = Boolean(selectedSupplier);
  const submitButtonLabel = isEditing ? "Save" : "Add";

  useEffect(() => {
    if (selectedSupplier) {
      setFormData({
        fullName: selectedSupplier.name || "",
        supplierType: selectedSupplier.supplierType || "Manufacturer",
        defaultLeadTime: selectedSupplier.leadTime ?? "",
        status: selectedSupplier.status || "Active",
        contactPerson: selectedSupplier.contactPerson || "",
        email: selectedSupplier.email || "",
        phone: selectedSupplier.phone || "",
        address: selectedSupplier.address || "",
      });
    } else {
      setFormData(emptyForm);
    }
    setError("");
  }, [selectedSupplier, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.fullName.trim()) {
      setError("Full name is required.");
      return;
    }

    const payload = {
      fullName: formData.fullName.trim(),
      defaultLeadTime: Number(formData.defaultLeadTime) || 0,
      status: formData.status,
      contactPerson: formData.contactPerson || null,
      email: formData.email || null,
      phone: formData.phone || null,
      address: formData.address || null,
    };

    setIsSubmitting(true);
    setError("");
    try {
      if (isEditing) {
        await apiRequest(`/suppliers/${selectedSupplier.id}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
      } else {
        await apiRequest("/suppliers", {
          method: "POST",
          body: JSON.stringify(payload),
        });
      }
      onSaved?.();
      onClose();
    } catch (err) {
      setError(err.message || "Failed to save supplier.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="supplier-modal-overlay">
      <div className="supplier-modal-card">
        <h2 className="supplier-modal-title">Supplier Information</h2>

        {error && <p style={{ color: "#dc2626", fontWeight: 600, marginTop: -8 }}>{error}</p>}

        <form className="supplier-form" onSubmit={handleSubmit}>
          {/* BASIC INFORMATION */}
          <div className="supplier-section-header">BASIC INFORMATION</div>

          <div className="form-row-2-1">
            <div className="form-field">
              <label>Supplier ID</label>
              <input
                type="text"
                value={isEditing ? selectedSupplier.id : "(auto-generated)"}
                disabled
              />
            </div>
            <div className="form-field">
              <label>Full Name</label>
              <input
                type="text"
                value={formData.fullName}
                onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                placeholder="ABC Company"
              />
            </div>
          </div>

          <div className="form-row-3">
            <div className="form-field">
              <label>Supplier Type</label>
              <select
                value={formData.supplierType}
                onChange={(e) => setFormData({ ...formData, supplierType: e.target.value })}
              >
                <option value="Manufacturer">Manufacturer</option>
                <option value="Distributor">Distributor</option>
                <option value="Wholesaler">Wholesaler</option>
              </select>
            </div>
            <div className="form-field">
              <label>Default Lead Time (days)</label>
              <input
                type="number"
                min="0"
                value={formData.defaultLeadTime}
                onChange={(e) => setFormData({ ...formData, defaultLeadTime: e.target.value })}
                placeholder="Enter Number"
              />
            </div>
            <div className="form-field">
              <label>Status</label>
              <select
                value={formData.status}
                onChange={(e) => setFormData({ ...formData, status: e.target.value })}
              >
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
              </select>
            </div>
          </div>

          {/* CONTACT INFORMATION */}
          <div className="supplier-section-header">CONTACT INFORMATION</div>

          <div className="form-row-equal">
            <div className="form-field">
              <label>Contact Person</label>
              <input
                type="text"
                value={formData.contactPerson}
                onChange={(e) => setFormData({ ...formData, contactPerson: e.target.value })}
                placeholder="Juan Dela Cruz"
              />
            </div>
            <div className="form-field">
              <label>Email Address</label>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="abccompany@supplier.com"
              />
            </div>
          </div>

          <div className="form-row-equal">
            <div className="form-field">
              <label>Phone Number</label>
              <input
                type="text"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                placeholder="09875412558"
              />
            </div>
            <div className="form-field">
              <label>Address</label>
              <input
                type="text"
                value={formData.address}
                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                placeholder="146 Makinang Manila City"
              />
            </div>
          </div>

          {/* Action Buttons */}
          <div className="supplier-modal-actions">
            <button type="button" className="btn-modal-cancel" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-modal-submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving…" : submitButtonLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}