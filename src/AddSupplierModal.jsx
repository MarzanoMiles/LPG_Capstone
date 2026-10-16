import React, { useEffect, useState } from "react";
import "./AddSupplierModal.css";
import { Settings } from "lucide-react";
import SupplierTypeSettings from "./SupplierTypeSettings";
import { apiRequest } from "./api";

const emptyForm = {
  fullName: "",
  supplierType: "",
  defaultLeadTime: "",
  status: "Active",
  contactFirstName: "",
  contactLastName: "",
  email: "",
  phone: "",
  address: "",
};

export default function AddSupplierModal({ isOpen, onClose, selectedSupplier, onSaved }) {
  const [formData, setFormData] = useState(emptyForm);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  const [supplierTypes, setSupplierTypes] = useState([]);
  const [typesLoading, setTypesLoading] = useState(false);
  const [typesError, setTypesError] = useState("");
  const [showTypeSettings, setShowTypeSettings] = useState(false);

  async function loadTypes() {
    setTypesLoading(true);
    try { setSupplierTypes(await apiRequest('/suppliers/types')); setTypesError(''); }
    catch (err) { setTypesError(err.message || 'Could not load supplier types.'); throw err; }
    finally { setTypesLoading(false); }
  }
  useEffect(() => {
    if (isOpen) loadTypes().catch(() => {});
    setShowTypeSettings(false);
  }, [isOpen]);

  const isEditing = Boolean(selectedSupplier);
  const submitButtonLabel = isEditing ? "Save" : "Add";

  useEffect(() => {
    if (selectedSupplier) {
      const [contactFirstName = "", ...lastNameParts] = (selectedSupplier.contactPerson || "").trim().split(/\s+/);
      setFormData({
        fullName: selectedSupplier.name || "",
        supplierType: selectedSupplier.supplierTypeId ? String(selectedSupplier.supplierTypeId) : "",
        defaultLeadTime: selectedSupplier.leadTime ?? "",
        status: selectedSupplier.status || "Active",
        contactFirstName,
        contactLastName: lastNameParts.join(" "),
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
    const requiredFields = [
      ["fullName", "Supplier name"],
      ["supplierType", "Supplier type"],
      ["defaultLeadTime", "Lead time"],
      ["status", "Status"],
      ["contactFirstName", "Contact person's first name"],
      ["contactLastName", "Contact person's last name"],
      ["email", "Email address"],
      ["phone", "Phone number"],
      ["address", "Address"],
    ];
    const missing = requiredFields.find(([field]) => !String(formData[field]).trim());
    if (missing) {
      setError(`${missing[1]} is required.`);
      return;
    }
    const leadTime = Number(formData.defaultLeadTime);
    if (!Number.isInteger(leadTime) || leadTime < 0) {
      setError("Lead time must be a whole number of zero or more days.");
      return;
    }

    const payload = {
      fullName: formData.fullName.trim(),
      supplierTypeId: Number(formData.supplierType),
      defaultLeadTime: leadTime,
      status: formData.status,
      contactPerson: `${formData.contactFirstName.trim()} ${formData.contactLastName.trim()}`,
      email: formData.email.trim(),
      phone: formData.phone.trim(),
      address: formData.address.trim(),
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
      <div className="supplier-modal-card" role="dialog" aria-modal="true" aria-labelledby="supplier-information-title">
        <h2 id="supplier-information-title" className="supplier-modal-title">Supplier Information</h2>

        {error && <p style={{ color: "#dc2626", fontWeight: 600, marginTop: -8 }}>{error}</p>}

        <form className="supplier-form" onSubmit={handleSubmit}>
          {/* BASIC INFORMATION */}
          <div className="supplier-section-header">BASIC INFORMATION</div>

          <div className="supplier-row-name">
            <div className="supplier-form-field">
              <label>Supplier ID</label>
              <input
                type="text"
                value={isEditing ? selectedSupplier.id : "(auto-generated)"}
                disabled
              />
            </div>
            <div className="supplier-form-field">
              <label>Supplier Name <span className="supplier-required-mark" aria-hidden="true">*</span></label>
              <input
                required
                type="text"
                value={formData.fullName}
                onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                placeholder="Supplier Name"
              />
            </div>
          </div>

          <div className="supplier-row-basic">
            <div className="supplier-form-field">
              <div className="supplier-type-label">
                <label htmlFor="supplier-type-select">Supplier Type <span className="supplier-required-mark" aria-hidden="true">*</span></label>
                <button type="button" aria-label="Manage supplier types" title="Manage supplier types" disabled={isSubmitting || typesLoading || !!typesError} onClick={() => setShowTypeSettings(true)}><Settings size={17}/></button>
              </div>
              <select
                required
                id="supplier-type-select"
                disabled={typesLoading || !!typesError}
                value={formData.supplierType}
                onChange={(e) => setFormData({ ...formData, supplierType: e.target.value })}
              >
                <option value="" disabled>Select Type</option>
                {supplierTypes.map(type => <option key={type.id} value={String(type.id)}>{type.name}</option>)}
              </select>
              {typesLoading && <small>Loading supplier types...</small>}
              {typesError && <div className="supplier-type-error" role="alert">{typesError} <button type="button" onClick={() => loadTypes().catch(() => {})}>Retry</button></div>}
            </div>
            <div className="supplier-form-field">
              <label>Lead Time (Days) <span className="supplier-required-mark" aria-hidden="true">*</span></label>
              <input
                required
                type="number"
                min="0"
                value={formData.defaultLeadTime}
                onChange={(e) => setFormData({ ...formData, defaultLeadTime: e.target.value })}
                placeholder="Number of Days"
              />
            </div>
            <div className="supplier-form-field">
              <label>Status <span className="supplier-required-mark" aria-hidden="true">*</span></label>
              <select
                required
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

          <div className="supplier-row-contact">
            <div className="supplier-form-field">
              <label htmlFor="supplier-contact-first-name">Contact Person First Name <span className="supplier-required-mark" aria-hidden="true">*</span></label>
              <input
                id="supplier-contact-first-name"
                type="text"
                autoComplete="given-name"
                required
                value={formData.contactFirstName}
                onChange={(e) => setFormData({ ...formData, contactFirstName: e.target.value })}
                placeholder="First Name"
              />
            </div>
            <div className="supplier-form-field">
              <label htmlFor="supplier-contact-last-name">Contact Person Last Name <span className="supplier-required-mark" aria-hidden="true">*</span></label>
              <input
                id="supplier-contact-last-name"
                type="text"
                autoComplete="family-name"
                required
                value={formData.contactLastName}
                onChange={(e) => setFormData({ ...formData, contactLastName: e.target.value })}
                placeholder="Last Name"
              />
            </div>
          </div>

          <div className="supplier-row-contact">
            <div className="supplier-form-field">
              <label>Email Address <span className="supplier-required-mark" aria-hidden="true">*</span></label>
              <input
                required
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="Email Address"
              />
            </div>
            <div className="supplier-form-field">
              <label>Phone Number <span className="supplier-required-mark" aria-hidden="true">*</span></label>
              <input
                required
                type="text"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                placeholder="Phone Number"
              />
            </div>
            <div className="supplier-form-field supplier-address-field">
              <label htmlFor="supplier-address">Address <span className="supplier-required-mark" aria-hidden="true">*</span></label>
              <input
                required
                type="text"
                id="supplier-address"
                aria-describedby="supplier-address-format"
                value={formData.address}
                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                placeholder="Complete Address"
              />
              <div id="supplier-address-format" className="supplier-address-note">
                <span className="supplier-address-note-title">Address format</span>
                <p>House / Unit / Building / Lot &amp; Block No., Street Name, Subdivision / Village / Sitio / Purok, Brgy. Barangay, City / Municipality, ZIP Code Province</p>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="supplier-modal-actions">
            <button type="button" className="btn-modal-cancel" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-modal-submit" disabled={isSubmitting || typesLoading || !!typesError}>
              {isSubmitting ? "Saving…" : submitButtonLabel}
            </button>
          </div>
        </form>
      </div>
      {showTypeSettings && <SupplierTypeSettings types={supplierTypes} onClose={() => setShowTypeSettings(false)} onChanged={async change => {
        await loadTypes();
        if (change.action === 'add') setFormData(previous => ({ ...previous, supplierType: String(change.id) }));
        if (change.action === 'delete') setFormData(previous => String(change.id) === previous.supplierType ? { ...previous, supplierType: '' } : previous);
      }}/>}
    </div>
  );
}
