import PageLayout, { PageHeader } from "./PageLayout";
import React, { useEffect, useMemo, useState } from "react";
import {
  Search,
  ChevronDown,
  ShoppingCart,
  Wallet,
  Minus,
  Plus,
  X,
  PauseCircle,
  UserPlus,
  Truck,
} from "lucide-react";
import PaymentModal from "./PaymentModal";
import SaleCompletedModal from "./SaleCompletedModal";
import { validatePickupSchedule } from "./utils/pickupSchedule";
import { apiRequest } from "./api";
import { printReceipt } from "./utils/receipt";
import { filterVisibleWarehouses } from "./utils/warehouseFilters";
import { resolveProductImage, productImagePlaceholder } from "./utils/productImages";
import { calculateDeliveryFee, round2 } from "./utils/deliveryFee";
import "./PosTerminal.css";

const discountOptions = [
  { label: "No Discount", value: 0 },
  { label: "Senior/PWD (5%)", value: 0.05 },
  { label: "Member (10%)", value: 0.1 },
];

const paymentMethods = ["Cash", "GCash", "Cash on Delivery", "Card", "Bank Transfer"];
const customerTypes = ["Walk-in", "Pickup", "Delivery"];
const HELD_CARTS_KEY = "gastrack_held_carts";
const DEFAULT_WAREHOUSE_OPTION = "All Warehouses";

function formatPeso(amount) {
  return `\u20B1${(amount || 0).toFixed(2)}`;
}

function loadHeldCarts() {
  try {
    const raw = localStorage.getItem(HELD_CARTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveHeldCarts(carts) {
  try {
    localStorage.setItem(HELD_CARTS_KEY, JSON.stringify(carts));
  } catch {
    /* storage unavailable */
  }
}

function ProductCard({ product, onAdd }) {
  const outOfStock = product.stock <= 0;

  return (
    <button
      type="button"
      className="product-card"
      onClick={() => onAdd(product)}
      disabled={outOfStock}
      style={outOfStock ? { opacity: 0.5, cursor: "not-allowed" } : undefined}
    >
      <span className="product-category">{product.category}</span>
      <div className="product-image">
        <img
          src={resolveProductImage(product)}
          alt={product.ProductName || product.name}
          className="product-image-img"
          onError={(e) => {
            if (e.currentTarget.src !== productImagePlaceholder) {
              e.currentTarget.src = productImagePlaceholder;
            }
          }}
        />
      </div>
      <p className="product-name">{product.name}</p>
      <p className="product-stock">{outOfStock ? "Out of stock" : `Stock: ${product.stock}`}</p>
      <p className="product-price">{formatPeso(product.price)}</p>
    </button>
  );
}

function CartItem({ item, onIncrement, onDecrement, onUpdateQuantity, onRemove }) {
  return (
    <div className="cart-item">
      <div className="cart-item-info">
        <p className="cart-item-name">{item.name}</p>
        <p className="cart-item-price">{formatPeso(item.price)} each</p>
      </div>
      <div className="cart-item-controls">
        <button type="button" className="qty-btn" onClick={() => onDecrement(item.id)} aria-label="Decrease quantity">
          <Minus size={14} />
        </button>
        <input
          type="number"
          min="1"
          max={item.stock}
          value={item.qty}
          onChange={(e) => onUpdateQuantity(item.id, parseInt(e.target.value) || 1)}
          className="qty-input"
          style={{ width: "40px", textAlign: "center", border: "1px solid #d1d5db", borderRadius: "4px", padding: "2px 0", fontSize: "0.85rem" }}
          aria-label="Edit quantity"
        />
        <button type="button" className="qty-btn" onClick={() => onIncrement(item.id)} aria-label="Increase quantity">
          <Plus size={14} />
        </button>
      </div>
      <span className="cart-item-total">{formatPeso(item.price * item.qty)}</span>
      <button type="button" className="cart-item-remove" onClick={() => onRemove(item.id)} aria-label="Remove item">
        <X size={14} />
      </button>
    </div>
  );
}

function HeldCartsModal({ isOpen, onClose, heldCarts, onRestore, onDiscard }) {
  if (!isOpen) return null;
  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(17,24,39,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999, padding: 16 }}
      onClick={onClose}
    >
      <div
        style={{ background: "#fff", borderRadius: 12, padding: "24px 28px", width: "100%", maxWidth: 460, maxHeight: "80vh", overflowY: "auto", boxShadow: "0 20px 50px rgba(0,0,0,0.2)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h2 style={{ fontSize: "1.15rem", fontWeight: 800, margin: 0 }}>Held Transactions</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer" }}>
            <X size={20} />
          </button>
        </div>

        {heldCarts.length === 0 && (
          <p style={{ color: "#9ca3af", fontSize: "0.85rem", padding: "20px 0", textAlign: "center" }}>
            No held transactions. Tap "Hold" on a cart to save it for later.
          </p>
        )}

        {heldCarts.map((held) => {
          const total = held.items.reduce((sum, it) => sum + it.price * it.qty, 0);
          return (
            <div key={held.id} style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: "12px 14px", marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <span style={{ fontWeight: 700, fontSize: "0.85rem" }}>{new Date(held.heldAt).toLocaleString()}</span>
                <span style={{ fontWeight: 700, color: "#2563eb" }}>{formatPeso(total)}</span>
              </div>
              <p style={{ margin: "0 0 8px 0", fontSize: "0.8rem", color: "#6b7280" }}>
                {held.items.length} item(s) · {held.customerType}
              </p>
              <ul style={{ margin: "0 0 10px 0", paddingLeft: 18, fontSize: "0.78rem", color: "#374151" }}>
                {held.items.slice(0, 4).map((it) => (
                  <li key={it.id}>{it.name} × {it.qty}</li>
                ))}
                {held.items.length > 4 && <li>+ {held.items.length - 4} more…</li>}
              </ul>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  onClick={() => onRestore(held)}
                  style={{ flex: 1, padding: "8px 0", borderRadius: 6, border: "none", background: "#1d6bf3", color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: "0.8rem" }}
                >
                  Restore
                </button>
                <button
                  type="button"
                  onClick={() => onDiscard(held.id)}
                  style={{ flex: 1, padding: "8px 0", borderRadius: 6, border: "1px solid #fca5a5", background: "#fff", color: "#dc2626", fontWeight: 700, cursor: "pointer", fontSize: "0.8rem" }}
                >
                  Discard
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Customer Creation Modal
// ---------------------------------------------------------------------------
function AddCustomerModal({ isOpen, onClose, onCustomerCreated }) {
  const emptyForm = { customerType: "Residential", companyName: "", firstName: "", lastName: "", phone: "", address: "" };
  const [form, setForm] = useState(emptyForm);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (isOpen) { setForm(emptyForm); setError(""); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  if (!isOpen) return null;

  const update = (key) => (e) => setForm((prev) => ({ ...prev, [key]: e.target.value }));
  const commercial = form.customerType === "Commercial";

  const handleSave = async () => {
    const required = [form.firstName, form.lastName, form.phone, form.address];
    if (required.some((v) => !v.trim()) || (commercial && !form.companyName.trim())) {
      setError(
        commercial
          ? "Company Name, First Name, Last Name, Contact Number and Address are required."
          : "First Name, Last Name, Contact Number and Address are required."
      );
      return;
    }

    setIsSubmitting(true);
    setError("");
    try {
      const payload = {
        companyName: commercial ? form.companyName.trim() : null,
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        phone: form.phone.trim(),
        address: form.address.trim(),
        customerType: form.customerType,
      };
      const response = await apiRequest("/customers", { method: "POST", body: JSON.stringify(payload) });

      onCustomerCreated({
        id: response.id,
        customerName: commercial ? payload.companyName : `${payload.firstName} ${payload.lastName}`,
        contactNumber: payload.phone,
        address: payload.address,
        customerCategory: payload.customerType,
      });
      onClose();
    } catch (err) {
      setError(err.message || "Failed to save customer.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const labelStyle = { fontSize: "0.8rem", fontWeight: 600, color: "#374151", display: "block", marginBottom: 4 };
  const fieldStyle = { width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: "0.85rem", boxSizing: "border-box", fontFamily: "inherit" };

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(17,24,39,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10000, padding: 16 }}
      onClick={onClose}
    >
      <div
        style={{ background: "#fff", borderRadius: 12, padding: "24px 28px", width: "100%", maxWidth: 480, maxHeight: "92vh", overflowY: "auto", boxShadow: "0 20px 50px rgba(0,0,0,0.3)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h3 style={{ fontSize: "1.1rem", fontWeight: 800, margin: 0, color: "#111827" }}>Add Customer</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer" }}>
            <X size={18} />
          </button>
        </div>

        {error && (
          <div role="alert" style={{ background: "#fef2f2", color: "#dc2626", padding: "8px 12px", borderRadius: 6, fontSize: "0.8rem", marginBottom: 12, fontWeight: 600 }}>
            {error}
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <label style={labelStyle}>Customer ID</label>
            <input disabled value="Auto-generated (CUST-001)" style={{ ...fieldStyle, background: "#f1f5f9", color: "#64748b" }} />
          </div>

          <div>
            <label style={labelStyle}>Customer Type</label>
            <select value={form.customerType} onChange={update("customerType")} style={fieldStyle}>
              <option value="Residential">Residential</option>
              <option value="Commercial">Commercial</option>
            </select>
          </div>

          {commercial && (
            <>
              <div>
                <label style={labelStyle}>Company Name</label>
                <input required maxLength={150} value={form.companyName} onChange={update("companyName")} style={fieldStyle} />
              </div>
              <h4 style={{ margin: "4px 0 0", fontSize: "0.9rem", color: "#111827" }}>Contact Person</h4>
            </>
          )}

          <div>
            <label style={labelStyle}>First Name</label>
            <input required maxLength={75} value={form.firstName} onChange={update("firstName")} style={fieldStyle} />
          </div>

          <div>
            <label style={labelStyle}>Last Name</label>
            <input required maxLength={75} value={form.lastName} onChange={update("lastName")} style={fieldStyle} />
          </div>

          <div>
            <label style={labelStyle}>Contact Number</label>
            <input required maxLength={30} value={form.phone} onChange={update("phone")} placeholder="Phone Number" style={fieldStyle} />
          </div>

          <div>
            <label style={labelStyle} htmlFor="pos-customer-address">Address</label>
            <input
              id="pos-customer-address"
              required
              maxLength={255}
              value={form.address}
              onChange={update("address")}
              placeholder="Complete Address"
              aria-describedby="pos-customer-address-format"
              style={fieldStyle}
            />
            <div
              id="pos-customer-address-format"
              style={{ marginTop: 6, padding: "10px 12px", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 12, lineHeight: 1.6, color: "#64748b", overflowWrap: "anywhere" }}
            >
              <span style={{ display: "block", marginBottom: 3, fontWeight: 600, color: "#475569" }}>Address format</span>
              <p style={{ margin: 0 }}>
                House / Unit / Building / Lot &amp; Block No., Street Name, Subdivision / Village / Sitio / Purok, Brgy. Barangay, City / Municipality, ZIP Code Province
              </p>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 18 }}>
          <button
            type="button"
            onClick={onClose}
            style={{ padding: "8px 16px", borderRadius: 6, border: "1px solid #d1d5db", background: "#fff", color: "#374151", fontWeight: 600, cursor: "pointer", fontSize: "0.85rem" }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isSubmitting}
            style={{ padding: "8px 18px", borderRadius: 6, border: "none", background: "#1d6bf3", color: "#fff", fontWeight: 600, cursor: "pointer", fontSize: "0.85rem", opacity: isSubmitting ? 0.6 : 1 }}
          >
            {isSubmitting ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pickup Details Modal
// ---------------------------------------------------------------------------
function PickupModal({ isOpen, onClose, onSave, initialData }) {
  const [searchQuery, setSearchQuery] = useState("");
  const [customerResults, setCustomerResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState("");

  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [pickupDate, setPickupDate] = useState("");
  const [pickupTime, setPickupTime] = useState("");
  const [showAddCustomerModal, setShowAddCustomerModal] = useState(false);

  useEffect(() => {
    if (initialData) {
      setSelectedCustomer({
        id: initialData.customerId || "",
        customerName: initialData.customerName || "",
        contactNumber: initialData.contactNumber || "",
        address: initialData.address || "",
        customerCategory: initialData.customerCategory || "Residential",
      });
      setPickupDate(initialData.pickupDate || "");
      setPickupTime(initialData.pickupTime || "");
    } else {
      resetForm();
    }
    setError("");
  }, [isOpen, initialData]);

  const resetForm = () => {
    setSelectedCustomer(null);
    setPickupDate("");
    setPickupTime("");
    setSearchQuery("");
    setCustomerResults([]);
  };

  useEffect(() => {
    if (!searchQuery.trim()) {
      setCustomerResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const data = await apiRequest(`/customers?search=${encodeURIComponent(searchQuery)}`);
        setCustomerResults(Array.isArray(data) ? data : []);
      } catch {
        setCustomerResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  if (!isOpen) return null;

  const handleSelectCustomer = (cust) => {
    setSelectedCustomer({
      id: cust.id || cust._id || cust.CustomerID,
      customerName: cust.name || cust.CustomerName || "",
      contactNumber: cust.contactNumber || cust.phone || cust.ContactNo || "",
      address: cust.address || cust.Address || "",
      customerCategory: cust.customerType || cust.CustomerType || "Residential",
    });
    setCustomerResults([]);
    setSearchQuery("");
  };

  const handleSaveModal = (e) => {
    e.preventDefault();

    if (!selectedCustomer?.id) {
      setError("Please search and select a customer.");
      return;
    }

    const scheduleError = validatePickupSchedule({ pickupDate, pickupTime });
    if (scheduleError) {
      setError(scheduleError);
      return;
    }

    setError("");
    onSave({
      customerId: selectedCustomer.id,
      customerCategory: selectedCustomer.customerCategory,
      customerName: selectedCustomer.customerName,
      contactNumber: selectedCustomer.contactNumber,
      address: selectedCustomer.address,
      pickupDate,
      pickupTime,
    });
  };

  return (
    <>
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(17,24,39,0.55)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 9999,
          padding: 16,
        }}
        onClick={onClose}
      >
        <div
          style={{
            background: "#fff",
            borderRadius: 12,
            padding: "24px 28px",
            width: "100%",
            maxWidth: 500,
            boxShadow: "0 20px 50px rgba(0,0,0,0.3)",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <h2 style={{ fontSize: "1.2rem", fontWeight: 800, margin: 0, color: "#111827" }}>
                Pickup Details
              </h2>
              <button
                type="button"
                onClick={() => setShowAddCustomerModal(true)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "5px 10px",
                  borderRadius: 6,
                  border: "none",
                  background: "#1d6bf3",
                  color: "#fff",
                  fontSize: "0.78rem",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                <UserPlus size={14} /> Add New Customer
              </button>
            </div>
            <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer" }}>
              <X size={20} />
            </button>
          </div>

          {error && (
            <div style={{ background: "#fef2f2", color: "#dc2626", padding: "10px 14px", borderRadius: 6, fontSize: "0.82rem", marginBottom: 14, fontWeight: 600 }}>
              {error}
            </div>
          )}

          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: "0.88rem", fontWeight: 700, color: "#374151", marginBottom: 10 }}>
              Search Customer
            </div>

            <div style={{ position: "relative", marginBottom: 12 }}>
              <Search size={16} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "#9ca3af" }} />
              <input
                type="text"
                placeholder="Search Customer..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ width: "100%", padding: "8px 12px 8px 34px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: "0.85rem" }}
              />
            </div>

            {searchQuery.trim() !== "" && (
              <div style={{ maxHeight: 130, overflowY: "auto", border: "1px solid #e5e7eb", borderRadius: 6, marginBottom: 12, background: "#f9fafb" }}>
                {isSearching && <p style={{ fontSize: "0.8rem", padding: 8, color: "#6b7280", margin: 0 }}>Searching database...</p>}
                {!isSearching && customerResults.length === 0 && (
                  <p style={{ fontSize: "0.8rem", padding: 8, color: "#6b7280", margin: 0 }}>No matching customer found.</p>
                )}
                {customerResults.map((cust) => (
                  <div
                    key={cust.id || cust._id || cust.CustomerID}
                    onClick={() => handleSelectCustomer(cust)}
                    style={{ padding: "8px 12px", borderBottom: "1px solid #f3f4f6", cursor: "pointer", fontSize: "0.82rem" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "#eff6ff")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    <div style={{ fontWeight: 700, color: "#1f2937" }}>{cust.name || cust.CustomerName}</div>
                    <div style={{ color: "#6b7280", fontSize: "0.75rem" }}>{cust.contactNumber || cust.phone || cust.ContactNo}</div>
                  </div>
                ))}
              </div>
            )}

            <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "12px", marginBottom: 14 }}>
              <span style={{ fontSize: "0.72rem", fontWeight: 700, color: "#64748b", textTransform: "uppercase", display: "block", marginBottom: 4 }}>
                Selected Customer
              </span>
              <div style={{ fontSize: "0.85rem", fontWeight: 700, color: "#1e293b", marginBottom: 2 }}>
                {selectedCustomer?.customerName || <span style={{ color: "#94a3b8", fontWeight: 400 }}>No customer selected</span>}
              </div>
              <div style={{ fontSize: "0.82rem", color: "#475569" }}>
                {selectedCustomer?.contactNumber || "—"}
              </div>
            </div>

            <div>
              <span style={{ fontSize: "0.8rem", fontWeight: 700, color: "#374151", display: "block", marginBottom: 6 }}>
                Pickup Schedule
              </span>
              <div style={{ display: "flex", gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: "0.75rem", color: "#6b7280", display: "block", marginBottom: 2 }}>Date</label>
                  <input
                    type="date"
                    min={new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date())}
                    value={pickupDate}
                    onChange={(e) => setPickupDate(e.target.value)}
                    style={{ width: "100%", padding: "7px 8px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: "0.82rem" }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: "0.75rem", color: "#6b7280", display: "block", marginBottom: 2 }}>Time (8 AM – 6 PM)</label>
                  <input
                    type="time"
                    min="08:00"
                    max="18:00"
                    value={pickupTime}
                    onChange={(e) => setPickupTime(e.target.value)}
                    style={{ width: "100%", padding: "7px 8px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: "0.82rem" }}
                  />
                </div>
              </div>
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, borderTop: "1px solid #e5e7eb", paddingTop: 14 }}>
            <button
              type="button"
              onClick={onClose}
              style={{ padding: "9px 18px", borderRadius: 6, border: "1px solid #d1d5db", background: "#fff", color: "#374151", fontWeight: 700, cursor: "pointer", fontSize: "0.85rem" }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSaveModal}
              style={{ padding: "9px 22px", borderRadius: 6, border: "none", background: "#1d6bf3", color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: "0.85rem" }}
            >
              Save Pickup Details
            </button>
          </div>
        </div>
      </div>

      <AddCustomerModal
        isOpen={showAddCustomerModal}
        onClose={() => setShowAddCustomerModal(false)}
        onCustomerCreated={(newCust) => setSelectedCustomer(newCust)}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Delivery Details Modal
// ---------------------------------------------------------------------------
function DeliveryModal({ isOpen, onClose, onSave, initialData, orderTotal = 0 }) {
  const [searchQuery, setSearchQuery] = useState("");
  const [customerResults, setCustomerResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [riders, setRiders] = useState([]);
  const [isLoadingRiders, setIsLoadingRiders] = useState(false);
  const [error, setError] = useState("");

  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [address, setAddress] = useState("");
  const [instructions, setInstructions] = useState("");
  const [vehicleType, setVehicleType] = useState("");
  const [vehicleTypes, setVehicleTypes] = useState([]);
  const [estimate, setEstimate] = useState(null); // { distanceKm, estimateToken, rate, storeAddress }
  const [isEstimating, setIsEstimating] = useState(false);
  const [assignedRiderId, setAssignedRiderId] = useState("");
  const [showAddCustomerModal, setShowAddCustomerModal] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    apiRequest('/settings').then(settings => {
      if (active) setVehicleTypes((settings.vehicleRates || []).map(rate => rate.name));
    }).catch(() => { if (active) { setVehicleTypes([]); setError('Unable to load vehicle rates. Reopen delivery details to retry.'); } });
    return () => { active = false; };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const fetchRiders = async () => {
      setIsLoadingRiders(true);
      try {
        const data = await apiRequest("/deliveries/drivers");
        setRiders(Array.isArray(data) ? data : []);
      } catch (err) {
        setRiders([]);
      } finally {
        setIsLoadingRiders(false);
      }
    };
    fetchRiders();
  }, [isOpen]);

  useEffect(() => {
    if (initialData) {
      setSelectedCustomer({
        id: initialData.customerId || "",
        customerName: initialData.customerName || "",
        contactNumber: initialData.contactNumber || "",
      });
      setAddress(initialData.address || "");
      setInstructions(initialData.instructions || "");
      setVehicleType(initialData.vehicleType || "");
      setAssignedRiderId(initialData.riderId || "");
      setEstimate(
        initialData.estimateToken
          ? { distanceKm: initialData.distanceKm, estimateToken: initialData.estimateToken, rate: initialData.rate }
          : null
      );
    } else {
      resetForm();
    }
    setError("");
  }, [isOpen, initialData]);

  const resetForm = () => {
    setSelectedCustomer(null);
    setAddress("");
    setInstructions("");
    setVehicleType("");
    setAssignedRiderId("");
    setEstimate(null);
    setSearchQuery("");
    setCustomerResults([]);
  };

  useEffect(() => {
    if (!searchQuery.trim()) {
      setCustomerResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const data = await apiRequest(`/customers?search=${encodeURIComponent(searchQuery)}`);
        setCustomerResults(Array.isArray(data) ? data : []);
      } catch {
        setCustomerResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  if (!isOpen) return null;

  const handleSelectCustomer = (cust) => {
    setSelectedCustomer({
      id: cust.id || cust._id || cust.CustomerID,
      customerName: cust.name || cust.CustomerName || "",
      contactNumber: cust.contactNumber || cust.phone || cust.ContactNo || "",
    });
    setAddress(cust.address || cust.Address || "");
    setEstimate(null);
    setCustomerResults([]);
    setSearchQuery("");
  };

  const handleEstimate = async () => {
    if (!address.trim()) return setError("Enter the complete delivery address first.");
    if (!vehicleType) return setError("Select a vehicle type first.");
    setIsEstimating(true);
    setError("");
    try {
      const data = await apiRequest("/delivery-fee/estimate", {
        method: "POST",
        body: JSON.stringify({ address: address.trim(), vehicleType }),
      });
      setEstimate(data);
    } catch (err) {
      setEstimate(null);
      setError(
        err.message && err.message !== "Request failed"
          ? err.message
          : "The distance service did not respond. Check your connection and try again."
      );
    } finally {
      setIsEstimating(false);
    }
  };

  const handleSaveModal = (e) => {
    e.preventDefault();

    if (!selectedCustomer) {
      setError("Please search and select a customer.");
      return;
    }
    if (!address.trim()) {
      setError("Complete Address is required.");
      return;
    }
    if (!vehicleType) {
      setError("Select a vehicle type.");
      return;
    }
    if (!estimate?.estimateToken) {
      setError("Calculate the delivery distance and fee before saving.");
      return;
    }

    setError("");
    const assignedRider = riders.find((r) => String(r.id || r.UserID) === String(assignedRiderId));

    onSave({
      customerId: selectedCustomer.id,
      customerName: selectedCustomer.customerName,
      contactNumber: selectedCustomer.contactNumber,
      address: address.trim(),
      instructions: instructions.trim(),
      vehicleType,
      distanceKm: estimate.distanceKm,
      estimateToken: estimate.estimateToken,
      rate: estimate.rate,
      riderId: assignedRiderId,
      riderName: assignedRider ? assignedRider.name || assignedRider.FullName : "Unassigned",
    });
  };

  const previewFee = estimate ? calculateDeliveryFee(estimate.rate, estimate.distanceKm, orderTotal) : 0;
  const fieldStyle = { width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: "0.85rem" };
  const labelStyle = { fontSize: "0.8rem", fontWeight: 700, color: "#374151", display: "block", marginBottom: 4 };

  return (
    <>
      <div
        style={{ position: "fixed", inset: 0, background: "rgba(17,24,39,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999, padding: 16 }}
        onClick={onClose}
      >
        <div
          style={{ background: "#fff", borderRadius: 12, padding: "24px 28px", width: "100%", maxWidth: 520, maxHeight: "92vh", overflowY: "auto", boxShadow: "0 20px 50px rgba(0,0,0,0.3)" }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Truck size={20} style={{ color: "#1d6bf3" }} />
              <h2 style={{ fontSize: "1.2rem", fontWeight: 800, margin: 0, color: "#111827" }}>Delivery Details</h2>
              <button
                type="button"
                onClick={() => setShowAddCustomerModal(true)}
                style={{ display: "flex", alignItems: "center", gap: 4, padding: "5px 10px", borderRadius: 6, border: "none", background: "#1d6bf3", color: "#fff", fontSize: "0.78rem", fontWeight: 600, cursor: "pointer" }}
              >
                <UserPlus size={14} /> Add New Customer
              </button>
            </div>
            <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer" }}>
              <X size={20} />
            </button>
          </div>

          {error && (
            <div style={{ background: "#fef2f2", color: "#dc2626", padding: "10px 14px", borderRadius: 6, fontSize: "0.82rem", marginBottom: 14, fontWeight: 600 }}>
              {error}
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 18 }}>
            <div>
              <label style={labelStyle}>Search Customer</label>
              <div style={{ position: "relative" }}>
                <Search size={16} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "#9ca3af" }} />
                <input
                  type="text"
                  placeholder="Type name or phone number..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{ ...fieldStyle, padding: "8px 12px 8px 34px" }}
                />
              </div>

              {searchQuery.trim() !== "" && (
                <div style={{ maxHeight: 130, overflowY: "auto", border: "1px solid #e5e7eb", borderRadius: 6, marginTop: 4, background: "#f9fafb" }}>
                  {isSearching && <p style={{ fontSize: "0.8rem", padding: 8, color: "#6b7280", margin: 0 }}>Searching database...</p>}
                  {!isSearching && customerResults.length === 0 && (
                    <p style={{ fontSize: "0.8rem", padding: 8, color: "#6b7280", margin: 0 }}>No matching customer found.</p>
                  )}
                  {customerResults.map((cust) => (
                    <div
                      key={cust.id || cust._id || cust.CustomerID}
                      onClick={() => handleSelectCustomer(cust)}
                      style={{ padding: "8px 12px", borderBottom: "1px solid #f3f4f6", cursor: "pointer", fontSize: "0.82rem" }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "#eff6ff")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                    >
                      <div style={{ fontWeight: 700, color: "#1f2937" }}>{cust.name || cust.CustomerName}</div>
                      <div style={{ color: "#6b7280", fontSize: "0.75rem" }}>{cust.contactNumber || cust.phone || cust.ContactNo}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px" }}>
              <span style={{ fontSize: "0.7rem", fontWeight: 700, color: "#64748b", textTransform: "uppercase", display: "block", marginBottom: 2 }}>
                Selected Customer
              </span>
              <div style={{ fontSize: "0.85rem", fontWeight: 700, color: "#1e293b" }}>
                {selectedCustomer?.customerName || <span style={{ color: "#94a3b8", fontWeight: 400 }}>No customer selected</span>}
              </div>
              <div style={{ fontSize: "0.8rem", color: "#475569" }}>
                {selectedCustomer?.contactNumber ? `Contact: ${selectedCustomer.contactNumber}` : "—"}
              </div>
            </div>

            <div>
              <label style={labelStyle}>
                Complete Address <span style={{ color: "#dc2626" }}>*</span>
              </label>
              <textarea
                rows={2}
                placeholder="House No., Street, Barangay, City, Province"
                value={address}
                onChange={(e) => { setAddress(e.target.value); setEstimate(null); }}
                style={{ ...fieldStyle, resize: "none" }}
              />
            </div>

            <div>
              <label style={labelStyle}>Delivery Instructions (Optional)</label>
              <input
                type="text"
                placeholder="e.g. Leave at guard house, call upon arrival"
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                style={fieldStyle}
              />
            </div>

            <div style={{ display: "flex", gap: 10 }}>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>
                  Vehicle Type <span style={{ color: "#dc2626" }}>*</span>
                </label>
                <select
                  value={vehicleType}
                  onChange={(e) => { setVehicleType(e.target.value); setEstimate(null); }}
                  style={fieldStyle}
                >
                  <option value="">Select a configured vehicle</option>
                  {vehicleTypes.map((v) => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
              </div>

              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Assign Driver</label>
                <select value={assignedRiderId} onChange={(e) => setAssignedRiderId(e.target.value)} style={fieldStyle}>
                  <option value="">Unassigned</option>
                  {isLoadingRiders && <option disabled>Loading drivers...</option>}
                  {riders.map((r) => (
                    <option key={r.id || r.UserID} value={r.id || r.UserID}>
                      {r.name || r.FullName || r.username}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Distance & fee estimate */}
            <div style={{ border: "1px solid #bfdbfe", background: "#eff6ff", borderRadius: 8, padding: "12px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                <span style={{ fontSize: "0.8rem", fontWeight: 700, color: "#1e40af" }}>Delivery Distance &amp; Fee</span>
                <button
                  type="button"
                  onClick={handleEstimate}
                  disabled={isEstimating}
                  style={{ padding: "6px 12px", borderRadius: 6, border: "none", background: "#1d6bf3", color: "#fff", fontWeight: 700, fontSize: "0.78rem", cursor: "pointer", opacity: isEstimating ? 0.6 : 1 }}
                >
                  {isEstimating ? "Calculating…" : estimate ? "Recalculate" : "Calculate Distance & Fee"}
                </button>
              </div>
              {estimate ? (
                <div style={{ marginTop: 8, fontSize: "0.82rem", color: "#1e3a8a", lineHeight: 1.6 }}>
                  {estimate.storeAddress && <div>From: {estimate.storeAddress}</div>}
                  <div>Driving distance: <strong>{estimate.distanceKm} km</strong></div>
                  <div>
                    Delivery fee: <strong>{previewFee === 0 ? "FREE" : formatPeso(previewFee)}</strong>
                    {previewFee === 0 && " (order qualifies for free delivery)"}
                  </div>
                  <div style={{ color: "#64748b", fontSize: "0.75rem" }}>
                    {formatPeso(estimate.rate.baseRate)} base + {formatPeso(estimate.rate.perKmRate)}/km. Free at {formatPeso(estimate.rate.freeDeliverySubtotal)} order total.
                  </div>
                </div>
              ) : (
                <p style={{ margin: "8px 0 0", fontSize: "0.78rem", color: "#64748b" }}>
                  Enter the address and vehicle, then calculate the distance from the store.
                </p>
              )}
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, borderTop: "1px solid #e5e7eb", paddingTop: 14 }}>
            <button
              type="button"
              onClick={onClose}
              style={{ padding: "9px 18px", borderRadius: 6, border: "1px solid #d1d5db", background: "#fff", color: "#374151", fontWeight: 700, cursor: "pointer", fontSize: "0.85rem" }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSaveModal}
              style={{ padding: "9px 22px", borderRadius: 6, border: "none", background: "#1d6bf3", color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: "0.85rem" }}
            >
              Save Delivery Details
            </button>
          </div>
        </div>
      </div>

      <AddCustomerModal
        isOpen={showAddCustomerModal}
        onClose={() => setShowAddCustomerModal(false)}
        onCustomerCreated={(newCust) => {
          setSelectedCustomer({
            id: newCust.id || newCust.CustomerID,
            customerName: newCust.customerName,
            contactNumber: newCust.contactNumber,
          });
          setAddress(newCust.address || "");
          setEstimate(null);
        }}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// POS Terminal Main Component
// ---------------------------------------------------------------------------
export default function PosTerminal() {
  const [products, setProducts] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [selectedWarehouseId, setSelectedWarehouseId] = useState("");
  const [warehouseInitialized, setWarehouseInitialized] = useState(false);
  const [isLoadingProducts, setIsLoadingProducts] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [searchTerm, setSearchTerm] = useState("");
  const [category, setCategory] = useState("All Categories");
  const [cart, setCart] = useState([]);
  const [discountValue, setDiscountValue] = useState(0);
  const [customerType, setCustomerType] = useState("Walk-in");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [completedSale, setCompletedSale] = useState(null);
  const [referenceNo, setReferenceNo] = useState("");
  const availablePaymentMethods = paymentMethods.filter((method) =>
    customerType === "Walk-in" ? method !== "Cash on Delivery" :
      customerType === "Pickup" ? !["Cash", "Cash on Delivery"].includes(method) : method !== "Cash"
  );
  useEffect(() => {
    setPaymentMethod("");
    setReferenceNo("");
  }, [customerType]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [posError, setPosError] = useState("");

  const [heldCarts, setHeldCarts] = useState(() => loadHeldCarts());
  const [showHeldModal, setShowHeldModal] = useState(false);

  const [showPickupModal, setShowPickupModal] = useState(false);
  const [pickupDetails, setPickupDetails] = useState(null);

  const [showDeliveryModal, setShowDeliveryModal] = useState(false);
  const [deliveryDetails, setDeliveryDetails] = useState(null);

  useEffect(() => {
    saveHeldCarts(heldCarts);
  }, [heldCarts]);

  const mapProducts = (data) =>
    data.map((p) => ({
      id: p.productId,
      category: p.category,
      name: p.name,
      ProductName: p.ProductName ?? p.name,
      stock: Number(p.stock),
      price: Number(p.unitPrice),
      ImageURL: p.ImageURL ?? p.imageUrl ?? null,
      brand: p.brand,
      unit: p.unit,
      unitValue: p.unitValue,
    }));

  const buildProductsQuery = () => {
    const params = new URLSearchParams({ status: "Active" });
    if (selectedWarehouseId) params.set("warehouseId", selectedWarehouseId);
    return `/products?${params.toString()}`;
  };

  const refreshProducts = async (warehouseOverride = selectedWarehouseId) => {
    const params = new URLSearchParams({ status: "Active" });
    if (warehouseOverride) params.set("warehouseId", warehouseOverride);
    const data = await apiRequest(`/products?${params.toString()}`);
    setProducts(mapProducts(data));
  };

  useEffect(() => {
    let cancelled = false;

    const loadWarehousesAndProducts = async () => {
      setIsLoadingProducts(true);
      try {
        const warehouseRows = await apiRequest("/warehouses");
        if (cancelled) return;

        const activeWarehouses = filterVisibleWarehouses(
          Array.isArray(warehouseRows)
            ? warehouseRows.filter((w) => String(w.status || "Active") === "Active")
            : []
        );
        setWarehouses(activeWarehouses);

        // "" means All Warehouses. Default to the first warehouse only on the very first load,
        // and clear a stale warehouse that no longer exists for this company.
        if (!warehouseInitialized) {
          setWarehouseInitialized(true);
          if (activeWarehouses[0]?.id) {
            setSelectedWarehouseId(activeWarehouses[0].id);
            return;
          }
        } else if (selectedWarehouseId && !activeWarehouses.some((w) => w.id === selectedWarehouseId)) {
          setSelectedWarehouseId("");
          return;
        }

        const data = await apiRequest(buildProductsQuery());
        if (cancelled) return;
        setProducts(mapProducts(data));
        setLoadError("");
      } catch (err) {
        if (!cancelled) setLoadError(err.message || "Failed to load products.");
      } finally {
        if (!cancelled) setIsLoadingProducts(false);
      }
    };

    loadWarehousesAndProducts();

    return () => {
      cancelled = true;
    };
  }, [selectedWarehouseId]);

  const categories = useMemo(() => {
    const unique = [...new Set(products.map((p) => p.category).filter(Boolean))];
    const preferredOrder = ["Cylinder", "Accessories", "Gasul LPG"];
    const ordered = [
      ...preferredOrder.filter((cat) => unique.includes(cat)),
      ...unique.filter((cat) => !preferredOrder.includes(cat)).sort((a, b) => a.localeCompare(b)),
    ];
    return ["All Categories", ...ordered];
  }, [products]);

  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      const matchesCategory = category === "All Categories" || p.category === category;
      const matchesSearch = p.name.toLowerCase().includes(searchTerm.toLowerCase());
      return matchesCategory && matchesSearch;
    }).sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true, sensitivity: "base" }));
  }, [products, searchTerm, category]);

  const addToCart = (product) => {
    if (product.stock <= 0) return;
    setCart((prev) => {
      const existing = prev.find((item) => item.id === product.id);
      if (existing) {
        if (existing.qty >= product.stock) return prev;
        return prev.map((item) =>
          item.id === product.id ? { ...item, qty: item.qty + 1 } : item
        );
      }
      return [...prev, { ...product, qty: 1 }];
    });
  };

  const incrementItem = (id) => {
    setCart((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        if (item.qty >= item.stock) return item;
        return { ...item, qty: item.qty + 1 };
      })
    );
  };

  const decrementItem = (id) => {
    setCart((prev) =>
      prev
        .map((item) => (item.id === id ? { ...item, qty: item.qty - 1 } : item))
        .filter((item) => item.qty > 0)
    );
  };

  const updateQuantity = (id, newQty) => {
    setCart((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        const clampedQty = Math.max(1, Math.min(newQty, item.stock));
        return { ...item, qty: clampedQty };
      })
    );
  };

  const removeItem = (id) => {
    setCart((prev) => prev.filter((item) => item.id !== id));
  };

  const clearCart = () => {
    setCart([]);
    setPickupDetails(null);
    setDeliveryDetails(null);
  };

  const handleCustomerTypeChange = (e) => {
    const selected = e.target.value;
    setCustomerType(selected);
    if (selected === "Pickup") {
      setShowPickupModal(true);
      setDeliveryDetails(null);
    } else if (selected === "Delivery") {
      setShowDeliveryModal(true);
      setPickupDetails(null);
    } else {
      setPickupDetails(null);
      setDeliveryDetails(null);
    }
  };

  const holdCart = () => {
    if (cart.length === 0) {
      setPosError("Cart is empty — nothing to hold.");
      return;
    }
    setPosError("");
    const held = {
      id: `held-${Date.now()}`,
      heldAt: new Date().toISOString(),
      items: cart,
      customerType,
      pickupDetails,
      deliveryDetails,
      discountValue,
      paymentMethod,
      warehouseId: selectedWarehouseId,
    };
    setHeldCarts((prev) => [held, ...prev]);
    clearCart();
  };

  const restoreHeldCart = (held) => {
    if (cart.length > 0) {
      const confirmed = window.confirm(
        "You have items in the current cart. Restoring will replace them. Continue?"
      );
      if (!confirmed) return;
    }
    setCart(held.items);
    setCustomerType(held.customerType || "Walk-in");
    setPickupDetails(held.pickupDetails || null);
    setDeliveryDetails(held.deliveryDetails || null);
    setDiscountValue(held.discountValue || 0);
    setPaymentMethod(held.paymentMethod || "");
    setSelectedWarehouseId(held.warehouseId || selectedWarehouseId);
    setHeldCarts((prev) => prev.filter((h) => h.id !== held.id));
    setShowHeldModal(false);
  };

  const discardHeldCart = (heldId) => {
    const confirmed = window.confirm("Discard this held transaction? This cannot be undone.");
    if (!confirmed) return;
    setHeldCarts((prev) => prev.filter((h) => h.id !== heldId));
  };

  const subtotalInclusive = useMemo(() => cart.reduce((sum, item) => sum + item.price * item.qty, 0), [cart]);
  const discount = subtotalInclusive * discountValue;
  const totalSalesInclusive = subtotalInclusive - discount;
  const vatAmount = totalSalesInclusive * (0.12 / 1.12);
  const amountNetOfVat = totalSalesInclusive - vatAmount;
  const deliveryFee =
    customerType === "Delivery" && deliveryDetails?.rate
      ? calculateDeliveryFee(deliveryDetails.rate, deliveryDetails.distanceKm, totalSalesInclusive)
      : 0;
  const totalAmountDue = round2(totalSalesInclusive + deliveryFee);

  const handlePay = () => {
    if (cart.length === 0) return;
    if (customerType === "Pickup" && !pickupDetails) {
      setPosError("Please complete the pickup details before proceeding.");
      setShowPickupModal(true);
      return;
    }
    if (customerType === "Delivery" && !deliveryDetails) {
      setPosError("Please complete the delivery details before proceeding.");
      setShowDeliveryModal(true);
      return;
    }
    if (customerType === "Pickup") {
      const scheduleError = validatePickupSchedule(pickupDetails);
      if (scheduleError) {
        setPosError(scheduleError);
        setShowPickupModal(true);
        return;
      }
    }
    if (!availablePaymentMethods.includes(paymentMethod)) {
      setPosError("Please select a valid payment method.");
      return;
    }
    setPosError("");
    setReferenceNo("");
    setShowPaymentModal(true);
  };

  const handleConfirmPayment = async ({ amountCollected, changeDue, returnedCylinders, printReceipt: shouldPrint }) => {
    if (cart.length === 0) return;
    if (customerType === "Pickup") {
      const scheduleError = validatePickupSchedule(pickupDetails);
      if (scheduleError) {
        setPosError(scheduleError);
        setShowPaymentModal(false);
        setShowPickupModal(true);
        return;
      }
    }
    setIsProcessing(true);
    setPosError("");

    try {
      const response = await apiRequest("/sales", {
        method: "POST",
        body: JSON.stringify({
          customerType,
          customerId: customerType === "Pickup" ? pickupDetails?.customerId : undefined,
          pickupDetails: customerType === "Pickup" ? pickupDetails : undefined,
          deliveryDetails: customerType === "Delivery" ? deliveryDetails : undefined,
          items: cart.map((item) => ({
            productId: item.id,
            qty: item.qty,
            unitPrice: item.price,
          })),
          discount,
          paymentMethod: paymentMethod || "Cash",
          warehouseId: selectedWarehouseId || undefined,
          amountCollected,
          referenceNo: referenceNo.trim(),
          returnedCylinders,
        }),
      });

      if (shouldPrint) {
        printReceipt({
          saleNo: response.saleNo,
          paymentMethod,
          referenceNo: referenceNo.trim(),
          cashierName: response.cashierName,
          datetime: new Date(),
          orderType: customerType,
          customerName: customerType === "Pickup" ? pickupDetails?.customerName : customerType === "Delivery" ? deliveryDetails?.customerName : customerType,
          pickupDetails: customerType === "Pickup" ? pickupDetails : undefined,
          deliveryDetails: customerType === "Delivery" ? deliveryDetails : undefined,
          items: cart.map((it) => ({ name: it.name, qty: it.qty, unitPrice: it.price, subtotal: it.qty * it.price })),
          subtotal: response.subtotal,
          discount: response.discount,
          vat: response.vat,
          taxRate: response.taxRate,
          totalAmount: response.totalAmount,
          amountCollected,
          changeDue: response.changeDue,
        });
      }

      setShowPaymentModal(false);
      clearCart();
      setCompletedSale({ saleNo: response.saleNo, changeDue: response.changeDue });

      refreshProducts().catch(() => { });
    } catch (err) {
      setPosError(err.message || "Failed to process payment. Please try again.");
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <PageLayout className="pos" contentClassName="pos-inner">

      <PageHeader title="POS Terminal" />

      {posError && (
        <p style={{ color: "#dc2626", fontWeight: 600, margin: "0 0 8px 0" }}>{posError}</p>
      )}

      <div className="pos-tabs">
        <span className="pos-tab active">Cart</span>
      </div>

      <div className="pos-layout">
        <div className="pos-main">
          <div className="pos-toolbar">
            <div className="pos-search">
              <Search size={16} className="pos-search-icon" />
              <input
                type="text"
                placeholder="Search Product"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pos-search-input"
              />
            </div>
            <div className="pos-select-wrap">
              <select
                className="pos-select"
                value={selectedWarehouseId}
                onChange={(e) => setSelectedWarehouseId(e.target.value)}
              >
                <option value="">{DEFAULT_WAREHOUSE_OPTION}</option>
                {warehouses.map((warehouse) => (
                  <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>
                ))}
              </select>
              <ChevronDown size={16} className="pos-select-icon" />
            </div>
            <div className="pos-select-wrap">
              <select
                className="pos-select"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                {categories.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <ChevronDown size={16} className="pos-select-icon" />
            </div>
          </div>

          <div className="product-grid">
            {isLoadingProducts && <p className="no-results">Loading products…</p>}
            {!isLoadingProducts && loadError && (
              <p className="no-results" style={{ color: "#dc2626" }}>{loadError}</p>
            )}
            {!isLoadingProducts &&
              !loadError &&
              filteredProducts.map((product) => (
                <ProductCard key={product.id} product={product} onAdd={addToCart} />
              ))}
            {!isLoadingProducts && !loadError && filteredProducts.length === 0 && (
              <p className="no-results">No products match your search.</p>
            )}
          </div>
        </div>

        <div className="pos-sidebar">
          <div className="pos-panel">
            <div className="pos-panel-header">
              <ShoppingCart size={16} />
              <span>Cart Summary</span>
            </div>
            <div className="pos-panel-body">
              <div className="cart-actions">
                <button type="button" className="cart-action-btn" onClick={holdCart}>
                  Hold
                </button>
                <button
                  type="button"
                  className="cart-action-btn"
                  onClick={() => setShowHeldModal(true)}
                  style={{ position: "relative" }}
                >
                  <PauseCircle size={14} style={{ marginRight: 4, verticalAlign: "-2px" }} />
                  Restore
                  {heldCarts.length > 0 && (
                    <span
                      style={{
                        position: "absolute", top: -6, right: -6, background: "#ef4444", color: "#fff",
                        fontSize: "0.65rem", fontWeight: 700, borderRadius: 999, minWidth: 16, height: 16,
                        display: "flex", alignItems: "center", justifyContent: "center", padding: "0 3px",
                      }}
                    >
                      {heldCarts.length}
                    </span>
                  )}
                </button>
                <button type="button" className="cart-action-btn" onClick={clearCart}>
                  Clear
                </button>
              </div>

              <div className="cart-items">
                {cart.length === 0 ? (
                  <p className="cart-empty">Cart is empty. Tap a product to add it.</p>
                ) : (
                  cart.map((item) => (
                    <CartItem
                      key={item.id}
                      item={item}
                      onIncrement={incrementItem}
                      onDecrement={decrementItem}
                      onUpdateQuantity={updateQuantity}
                      onRemove={removeItem}
                    />
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="pos-panel">
            <div className="pos-panel-header">
              <Wallet size={16} />
              <span>Checkout</span>
            </div>
            <div className="pos-panel-body">
              <div className="pos-select-wrap full-width">
                <select
                  className="pos-select"
                  value={customerType}
                  onChange={handleCustomerTypeChange}
                >
                  {customerTypes.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
                <ChevronDown size={16} className="pos-select-icon" />
              </div>

              {customerType === "Pickup" && (
                <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 8, padding: "8px 12px", marginBottom: 10, fontSize: "0.8rem", color: "#1e40af" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontWeight: 700, marginBottom: 4 }}>
                    <span>Pickup Schedule</span>
                    <button
                      type="button"
                      onClick={() => setShowPickupModal(true)}
                      style={{ background: "none", border: "none", color: "#2563eb", cursor: "pointer", textDecoration: "underline", fontSize: "0.75rem" }}
                    >
                      {pickupDetails ? "Edit" : "Set Details"}
                    </button>
                  </div>
                  {pickupDetails ? (
                    <>
                      <div>Customer: {pickupDetails.customerName} ({pickupDetails.contactNumber})</div>
                      <div>Schedule: {pickupDetails.pickupDate} at {pickupDetails.pickupTime}</div>
                    </>
                  ) : (
                    <span style={{ color: "#dc2626", fontWeight: 600 }}>Details pending</span>
                  )}
                </div>
              )}

              {customerType === "Delivery" && (
                <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 8, padding: "8px 12px", marginBottom: 10, fontSize: "0.8rem", color: "#1e40af" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontWeight: 700, marginBottom: 4 }}>
                    <span>Delivery Details</span>
                    <button
                      type="button"
                      onClick={() => setShowDeliveryModal(true)}
                      style={{ background: "none", border: "none", color: "#2563eb", cursor: "pointer", textDecoration: "underline", fontSize: "0.75rem" }}
                    >
                      {deliveryDetails ? "Edit" : "Set Details"}
                    </button>
                  </div>
                  {deliveryDetails ? (
                    <>
                      <div>Customer: {deliveryDetails.customerName} ({deliveryDetails.contactNumber})</div>
                      <div>Address: {deliveryDetails.address}</div>
                      <div>Vehicle: {deliveryDetails.vehicleType} | Driver: {deliveryDetails.riderName}</div>
                      {deliveryDetails.distanceKm != null && <div>Distance: {deliveryDetails.distanceKm} km</div>}
                    </>
                  ) : (
                    <span style={{ color: "#dc2626", fontWeight: 600 }}>Details pending</span>
                  )}
                </div>
              )}

              <div className="checkout-row-selects">
                <div className="pos-select-wrap">
                  <select
                    className="pos-select"
                    value={discountValue}
                    onChange={(e) => setDiscountValue(Number(e.target.value))}
                  >
                    {discountOptions.map((d) => (
                      <option key={d.label} value={d.value}>{d.label}</option>
                    ))}
                  </select>
                  <ChevronDown size={16} className="pos-select-icon" />
                </div>

                <div className="pos-select-wrap">
                  <select
                    className="pos-select"
                    value={paymentMethod}
                    onChange={(e) => {
                      setPaymentMethod(e.target.value);
                      setReferenceNo("");
                    }}
                  >
                    <option value="">Select Payment Method</option>
                    {availablePaymentMethods.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                  <ChevronDown size={16} className="pos-select-icon" />
                </div>
              </div>

              <div className="checkout-summary">
                <div className="checkout-line">
                  <span>Subtotal (VAT Inclusive):</span>
                  <span>{formatPeso(subtotalInclusive)}</span>
                </div>
                <div className="checkout-line">
                  <span>Less: Discount:</span>
                  <span>{formatPeso(discount)}</span>
                </div>
                <div className="checkout-line">
                  <span>Total Sales (VAT Inclusive):</span>
                  <span>{formatPeso(totalSalesInclusive)}</span>
                </div>
                <div className="checkout-line">
                  <span>Less: VAT:</span>
                  <span>{formatPeso(vatAmount)}</span>
                </div>
                <div className="checkout-line">
                  <span>Amount Net of VAT:</span>
                  <span>{formatPeso(amountNetOfVat)}</span>
                </div>
                {customerType === "Delivery" && (
                  <div className="checkout-line">
                    <span>
                      Delivery Fee{deliveryDetails?.distanceKm != null ? ` (${deliveryDetails.distanceKm} km)` : ""}:
                    </span>
                    <span>
                      {!deliveryDetails?.estimateToken
                        ? "Pending"
                        : deliveryFee === 0
                          ? "FREE (₱0.00)"
                          : formatPeso(deliveryFee)}
                    </span>
                  </div>
                )}
                <div className="checkout-line checkout-total">
                  <span>TOTAL AMOUNT DUE:</span>
                  <span>{formatPeso(totalAmountDue)}</span>
                </div>
              </div>

              <button
                type="button"
                className="pay-btn"
                onClick={handlePay}
                disabled={cart.length === 0 || isProcessing}
              >
                {isProcessing ? "Processing…" : "Pay"}
              </button>
            </div>
          </div>
        </div>
      </div>


      <SaleCompletedModal sale={completedSale} onClose={() => setCompletedSale(null)} />

      <PaymentModal
        isOpen={showPaymentModal}
        totalAmount={totalAmountDue}
        orderType={customerType}
        paymentMethod={paymentMethod}
        referenceNo={referenceNo}
        onReferenceChange={setReferenceNo}
        isProcessing={isProcessing}
        allowCylinderReturn={customerType === "Walk-in" && cart.some((item) => ["Cylinder", "Gasul LPG"].includes(item.category))}
        cylinderProducts={products.filter((product) => product.category === "Cylinder")}
        warehouseName={warehouses.find((warehouse) => warehouse.id === selectedWarehouseId)?.name || selectedWarehouseId}
        error={posError}
        onCancel={() => setShowPaymentModal(false)}
        onConfirm={handleConfirmPayment}
      />

      <PickupModal
        isOpen={showPickupModal}
        onClose={() => setShowPickupModal(false)}
        initialData={pickupDetails}
        onSave={(data) => {
          setPickupDetails(data);
          setShowPickupModal(false);
        }}
      />

      <DeliveryModal
        orderTotal={totalSalesInclusive}
        isOpen={showDeliveryModal}
        onClose={() => setShowDeliveryModal(false)}
        initialData={deliveryDetails}
        onSave={(data) => {
          setDeliveryDetails(data);
          setShowDeliveryModal(false);
        }}
      />

      <HeldCartsModal
        isOpen={showHeldModal}
        onClose={() => setShowHeldModal(false)}
        heldCarts={heldCarts}
        onRestore={restoreHeldCart}
        onDiscard={discardHeldCart}
      />
    </PageLayout>
  );
}
