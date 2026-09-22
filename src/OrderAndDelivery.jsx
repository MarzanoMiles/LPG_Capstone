import { useEffect, useMemo, useState } from "react";
import { apiRequest } from "./api";
import { printReceipt } from "./utils/receipt";
import "./OrderAndDelivery.css";

const peso = (n) =>
  "₱ " + Number(n || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const orderStatusClass = {
  Preparing: "badge-yellow",
  Ready: "badge-blue",
  Completed: "badge-green",
  Cancelled: "badge-red",
};

const paymentStatusClass = {
  Paid: "badge-green",
  Unpaid: "badge-red",
};

const deliveryStatusClass = {
  Pending: "badge-yellow",
  "Out for Delivery": "badge-blue",
  Delivered: "badge-green",
  Failed: "badge-red",
};

const IconView = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
    <polyline points="14 2 14 8 20 8"></polyline>
    <circle cx="10" cy="13" r="2"></circle>
    <line x1="11.4" y1="14.4" x2="14" y2="17"></line>
  </svg>
);
const IconEdit = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
  </svg>
);
const IconPrint = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 6 2 18 2 18 9"></polyline>
    <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
    <rect x="6" y="14" width="12" height="8"></rect>
  </svg>
);
const IconDelete = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6"></polyline>
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
  </svg>
);

function Badge({ text, map }) {
  return <span className={`badge ${map[text] || "badge-gray"}`}>{text}</span>;
}

function Field({ label, children }) {
  return (
    <div className="form-row">
      <label>{label}</label>
      {children}
    </div>
  );
}

function Row({ label, value, bold }) {
  return (
    <div className={bold ? "grand" : ""}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function printOrderReceipt(order) {
  const items = (order.items || []).map((it) => ({
    name: it.name,
    qty: it.qty,
    unitPrice: Number(it.unitPrice),
    subtotal: Number(it.subtotal),
  }));
  const subtotal = items.reduce((s, it) => s + it.subtotal, 0);

  printReceipt({
    saleNo: order.id,
    datetime: order.date,
    customerName: order.customerName,
    orderType: order.type,
    items,
    subtotal,
    discount: 0,
    vat: 0,
    deliveryFee: Number(order.deliveryFee || 0),
    totalAmount: Number(order.totalAmount || subtotal + Number(order.deliveryFee || 0)),
  });
}

function NewOrderModal({ isOpen, onClose, onCreated, customers }) {
  const [products, setProducts] = useState([]);
  const [customerId, setCustomerId] = useState("");
  const [orderType, setOrderType] = useState("Walk-in");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [items, setItems] = useState([{ productId: "", qty: "" }]);
  const [markPaid, setMarkPaid] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState("Cash");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    apiRequest("/products?status=Active")
      .then(setProducts)
      .catch((err) => setError(err.message || "Failed to load products."));
  }, [isOpen]);

  if (!isOpen) return null;

  const productMap = Object.fromEntries(products.map((p) => [p.productId, p]));
  const updateItem = (i, field, value) =>
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, [field]: value } : it)));
  const addRow = () => setItems((prev) => [...prev, { productId: "", qty: "" }]);
  const removeRow = (i) => setItems((prev) => prev.filter((_, idx) => idx !== i));

  const validItems = items.filter((it) => it.productId && Number(it.qty) > 0);
  const subtotal = validItems.reduce((sum, it) => {
    const p = productMap[it.productId];
    return sum + (p ? p.unitPrice * Number(it.qty) : 0);
  }, 0);

  const reset = () => {
    setCustomerId("");
    setOrderType("Walk-in");
    setDeliveryAddress("");
    setItems([{ productId: "", qty: "" }]);
    setMarkPaid(false);
    setError("");
  };

  const handleSubmit = async () => {
    if (!customerId) return setError("Please select a customer.");
    if (!validItems.length) return setError("Add at least one item.");
    if (orderType === "Delivery" && !deliveryAddress) return setError("Delivery address is required.");

    setIsSubmitting(true);
    setError("");
    try {
      await apiRequest("/orders", {
        method: "POST",
        body: JSON.stringify({
          customerId: Number(customerId),
          orderType,
          items: validItems.map((it) => ({
            productId: Number(it.productId),
            qty: Number(it.qty),
            unitPrice: productMap[it.productId].unitPrice,
          })),
          deliveryAddress: orderType === "Delivery" ? deliveryAddress : undefined,
          markPaid,
          paymentMethod,
        }),
      });
      onCreated();
      reset();
      onClose();
    } catch (err) {
      setError(err.message || "Failed to create order.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay open" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h3>New Order</h3>
        {error && <p style={{ color: "#dc2626", fontWeight: 600 }}>{error}</p>}

        <Field label="Customer">
          <select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            <option value="">Select customer</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>{c.name} ({c.phone})</option>
            ))}
          </select>
        </Field>

        <Field label="Order Type">
          <select value={orderType} onChange={(e) => setOrderType(e.target.value)}>
            <option>Walk-in</option>
            <option>Pickup</option>
            <option>Delivery</option>
          </select>
        </Field>

        {orderType === "Delivery" && (
          <Field label="Delivery Address">
            <input value={deliveryAddress} onChange={(e) => setDeliveryAddress(e.target.value)} />
          </Field>
        )}

        <div className="items-header">
          <span>Product</span><span>Qty</span><span>Price</span><span></span>
        </div>
        {items.map((it, idx) => {
          const p = productMap[it.productId];
          return (
            <div key={idx} className="item-row">
              <select value={it.productId} onChange={(e) => updateItem(idx, "productId", e.target.value)}>
                <option value="">Select product</option>
                {products.map((prod) => (
                  <option key={prod.productId} value={prod.productId}>{prod.name}</option>
                ))}
              </select>
              <input
                type="number"
                min="1"
                value={it.qty}
                onChange={(e) => updateItem(idx, "qty", e.target.value)}
                style={{ width: 60 }}
              />
              <span>{p ? peso(p.unitPrice) : "—"}</span>
              <button type="button" className="btn btn-outline" onClick={() => removeRow(idx)}>✕</button>
            </div>
          );
        })}
        <button type="button" className="btn btn-outline" onClick={addRow} style={{ marginTop: 8 }}>
          + Add Item
        </button>

        <div className="totals">
          <Row label="Subtotal:" value={peso(subtotal)} bold />
        </div>

        <hr />
        <Field label="Mark as Paid">
          <input type="checkbox" checked={markPaid} onChange={(e) => setMarkPaid(e.target.checked)} />
        </Field>
        {markPaid && (
          <Field label="Payment Method">
            <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
              <option>Cash</option>
              <option>GCash</option>
              <option>Card</option>
              <option>Bank Transfer</option>
            </select>
          </Field>
        )}

        <div className="modal-actions">
          <button className="btn btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting ? "Creating…" : "Create Order"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function OrderAndDelivery() {
  const [customers, setCustomers] = useState([]);
  const [orders, setOrders] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [tab, setTab] = useState("orders");
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [ordersSearch, setOrdersSearch] = useState("");
  const [ordersStatusFilter, setOrdersStatusFilter] = useState("");
  const [ordersFulfillmentFilter, setOrdersFulfillmentFilter] = useState("");
  const [deliverySearch, setDeliverySearch] = useState("");
  const [deliveryStatusFilter, setDeliveryStatusFilter] = useState("");
  const [customersSearch, setCustomersSearch] = useState("");

  const [orderModal, setOrderModal] = useState(null);
  const [isNewOrderOpen, setIsNewOrderOpen] = useState(false);
  const [customerModal, setCustomerModal] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [toastMsg, setToastMsg] = useState("");
  const [isSavingOrder, setIsSavingOrder] = useState(false);

  function showToast(msg) {
    setToastMsg(msg);
    window.clearTimeout(showToast._t);
    showToast._t = window.setTimeout(() => setToastMsg(""), 2500);
  }

  const loadAll = () => {
    setIsLoading(true);
    Promise.all([
      apiRequest("/customers"),
      apiRequest("/orders"),
      apiRequest("/users?role=Driver"),
    ])
      .then(([customerData, orderData, driverData]) => {
        setCustomers(customerData);
        setOrders(orderData);
        setDrivers(driverData);
        setLoadError("");
      })
      .catch((err) => setLoadError(err.message || "Failed to load data."))
      .finally(() => setIsLoading(false));
  };

  useEffect(() => {
    loadAll();
  }, []);

  const filteredOrders = orders.filter((o) => {
    const q = ordersSearch.trim().toLowerCase();
    const matchesSearch = !q || o.id.toLowerCase().includes(q) || (o.customerName || "").toLowerCase().includes(q);
    const matchesStatus = !ordersStatusFilter || o.status === ordersStatusFilter;
    const matchesFulfillment = !ordersFulfillmentFilter || o.type === ordersFulfillmentFilter;
    return matchesSearch && matchesStatus && matchesFulfillment;
  });

  const openOrder = async (order) => {
    try {
      const full = await apiRequest(`/orders/${order.orderId}`);
      setOrderModal(full);
    } catch (err) {
      showToast(err.message || "Failed to load order details.");
    }
  };

  const saveOrder = async () => {
    setIsSavingOrder(true);
    try {
      await apiRequest(`/orders/${orderModal.orderId}`, {
        method: "PUT",
        body: JSON.stringify({
          orderType: orderModal.type,
          orderStatus: orderModal.status,
        }),
      });
      if (orderModal.saleId) {
        await apiRequest(`/orders/${orderModal.orderId}/payment`, {
          method: "PUT",
          body: JSON.stringify({
            paymentMethod: orderModal.paymentMethod,
            amountPaid: orderModal.paymentStatus === "Paid" ? orderModal.totalAmount : 0,
          }),
        });
      }
      if (orderModal.type === "Delivery" && orderModal.deliveryId) {
        await apiRequest(`/orders/${orderModal.orderId}/delivery`, {
          method: "PUT",
          body: JSON.stringify({
            deliveryStatus: orderModal.deliveryStatus,
            deliveryRiderId: orderModal.deliveryRiderId || null,
          }),
        });
      }
      showToast(`Order ${orderModal.id} saved.`);
      setOrderModal(null);
      loadAll();
    } catch (err) {
      showToast(err.message || "Failed to save order.");
    } finally {
      setIsSavingOrder(false);
    }
  };

  const deleteOrder = async (order) => {
    try {
      await apiRequest(`/orders/${order.orderId}`, { method: "DELETE" });
      showToast(`Order ${order.id} cancelled and stock restored.`);
      setConfirmDelete(null);
      loadAll();
    } catch (err) {
      showToast(err.message || "Failed to cancel order.");
    }
  };

  const deliveryRows = orders.filter((o) => o.type === "Delivery" && o.deliveryId);

  const filteredDelivery = deliveryRows.filter((d) => {
    const q = deliverySearch.trim().toLowerCase();
    const matchesSearch = !q || (d.drNo || "").toLowerCase().includes(q) || d.id.toLowerCase().includes(q);
    const matchesStatus = !deliveryStatusFilter || d.deliveryStatus === deliveryStatusFilter;
    return matchesSearch && matchesStatus;
  });

  const filteredCustomers = customers.filter((c) => {
    const q = customersSearch.trim().toLowerCase();
    return !q || String(c.id).includes(q) || c.name.toLowerCase().includes(q);
  });

  function openAddCustomer() {
    setCustomerModal({ name: "", phone: "", address: "", customerType: "Residential", isNew: true });
  }
  function openEditCustomer(c) {
    setCustomerModal({ ...c, isNew: false });
  }
  const saveCustomer = async () => {
    if (!customerModal.name.trim() || !customerModal.phone.trim()) {
      showToast("Customer name and phone are required.");
      return;
    }
    try {
      if (customerModal.isNew) {
        await apiRequest("/customers", {
          method: "POST",
          body: JSON.stringify({
            name: customerModal.name.trim(),
            phone: customerModal.phone.trim(),
            address: customerModal.address.trim() || "N/A",
            customerType: customerModal.customerType,
          }),
        });
        showToast("Customer added.");
      } else {
        await apiRequest(`/customers/${customerModal.id}`, {
          method: "PUT",
          body: JSON.stringify({
            name: customerModal.name.trim(),
            phone: customerModal.phone.trim(),
            address: customerModal.address.trim() || "N/A",
          }),
        });
        showToast("Customer updated.");
      }
      setCustomerModal(null);
      loadAll();
    } catch (err) {
      showToast(err.message || "Failed to save customer.");
    }
  };
  const deleteCustomer = async (customer) => {
    try {
      await apiRequest(`/customers/${customer.id}`, { method: "DELETE" });
      showToast(`Customer ${customer.name} deactivated.`);
      setConfirmDelete(null);
      loadAll();
    } catch (err) {
      showToast(err.message || "Failed to deactivate customer.");
    }
  };

  return (
    <div className="order-delivery-page">
      <h1 className="page-title">Order and Delivery</h1>

      {loadError && <p style={{ color: "#dc2626", fontWeight: 600 }}>{loadError}</p>}

      <div className="panel">
        <div className="panel-header">
          {tab === "orders" && (
            <button className="btn btn-primary" onClick={() => setIsNewOrderOpen(true)}>
              + New Order
            </button>
          )}
          {tab === "customers" && (
            <button className="btn btn-primary" onClick={openAddCustomer}>
              + Add Customer
            </button>
          )}
        </div>

        <div className="tabs">
          {[
            { id: "orders", label: "Orders" },
            { id: "delivery", label: "Delivery" },
            { id: "customers", label: "Customers" },
          ].map((t) => (
            <button key={t.id} className={`tab ${tab === t.id ? "active" : ""}`} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>

        {tab === "orders" && (
          <section className="tab-panel active">
            <div className="filters">
              <div className="search-box">
                <input value={ordersSearch} onChange={(e) => setOrdersSearch(e.target.value)} placeholder="Search Orders" />
              </div>
              <select value={ordersStatusFilter} onChange={(e) => setOrdersStatusFilter(e.target.value)}>
                <option value="">Order Status</option>
                <option>Preparing</option>
                <option>Ready</option>
                <option>Completed</option>
                <option>Cancelled</option>
              </select>
              <select value={ordersFulfillmentFilter} onChange={(e) => setOrdersFulfillmentFilter(e.target.value)}>
                <option value="">Fulfillment Type</option>
                <option>Delivery</option>
                <option>Walk-in</option>
                <option>Pickup</option>
              </select>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Order ID</th><th>Customer</th><th>Order Type</th>
                    <th>Order Status</th><th>Payment Status</th>
                    <th>Total Amount</th><th>Date</th><th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading && (
                    <tr><td colSpan={8} className="empty-state">Loading…</td></tr>
                  )}
                  {!isLoading && filteredOrders.map((o) => (
                    <tr key={o.orderId}>
                      <td>{o.id}</td>
                      <td>{o.customerName || "—"}</td>
                      <td>{o.type}</td>
                      <td><Badge text={o.status} map={orderStatusClass} /></td>
                      <td><Badge text={o.paymentStatus} map={paymentStatusClass} /></td>
                      <td>{peso(o.totalAmount)}</td>
                      <td>{new Date(o.date).toLocaleDateString()}</td>
                      <td className="actions">
                        <button className="action-btn act-view" onClick={() => openOrder(o)} title="View/Edit">
                          <IconView />
                        </button>
                        <button className="action-btn act-edit" onClick={() => openOrder(o)} title="Edit">
                          <IconEdit />
                        </button>
                        <button
                          className="action-btn act-print"
                          onClick={async () => {
                            try {
                              const full = await apiRequest(`/orders/${o.orderId}`);
                              printOrderReceipt(full);
                            } catch (err) {
                              showToast(err.message || "Failed to load order for printing.");
                            }
                          }}
                          title="Print"
                        >
                          <IconPrint />
                        </button>
                        <button
                          className="action-btn act-delete"
                          onClick={() => setConfirmDelete({ kind: "order", order: o })}
                          title="Cancel"
                        >
                          <IconDelete />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!isLoading && filteredOrders.length === 0 && <p className="empty-state">No orders match your search.</p>}
            </div>
          </section>
        )}

        {tab === "delivery" && (
          <section className="tab-panel active">
            <div className="filters">
              <div className="search-box">
                <input value={deliverySearch} onChange={(e) => setDeliverySearch(e.target.value)} placeholder="Search Delivery / Order" />
              </div>
              <select value={deliveryStatusFilter} onChange={(e) => setDeliveryStatusFilter(e.target.value)}>
                <option value="">Delivery Status</option>
                <option>Pending</option>
                <option>Out for Delivery</option>
                <option>Delivered</option>
                <option>Failed</option>
              </select>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Delivery No.</th><th>Order ID</th><th>Rider</th>
                    <th>Delivery Status</th><th>Delivered At</th><th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDelivery.map((d) => (
                    <tr key={d.deliveryId}>
                      <td>{d.drNo}</td>
                      <td>{d.id}</td>
                      <td>{d.deliveryRiderName || "Unassigned"}</td>
                      <td><Badge text={d.deliveryStatus} map={deliveryStatusClass} /></td>
                      <td>{d.deliveredAt ? new Date(d.deliveredAt).toLocaleString() : "N/A"}</td>
                      <td className="actions">
                        <button className="action-btn act-view" onClick={() => openOrder(d)} title="View/Edit">
                          <IconView />
                        </button>
                        <button
                          className="action-btn act-delete"
                          onClick={() => setConfirmDelete({ kind: "order", order: d })}
                          title="Cancel"
                        >
                          <IconDelete />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredDelivery.length === 0 && <p className="empty-state">No deliveries match your search.</p>}
            </div>
          </section>
        )}

        {tab === "customers" && (
          <section className="tab-panel active">
            <div className="filters">
              <div className="search-box">
                <input value={customersSearch} onChange={(e) => setCustomersSearch(e.target.value)} placeholder="Search Customer" />
              </div>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Customer ID</th><th>Customer Name</th><th>Phone Number</th>
                    <th>Address</th><th>Status</th><th>Created At</th><th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCustomers.map((c) => (
                    <tr key={c.id}>
                      <td>{c.id}</td>
                      <td>{c.name}</td>
                      <td>{c.phone || "—"}</td>
                      <td>{c.address || "—"}</td>
                      <td><Badge text={c.status} map={{ Active: "badge-green", Inactive: "badge-red" }} /></td>
                      <td>{new Date(c.created).toLocaleDateString()}</td>
                      <td className="actions">
                        <button className="action-btn act-edit" onClick={() => openEditCustomer(c)} title="Edit">
                          <IconEdit />
                        </button>
                        <button
                          className="action-btn act-delete"
                          onClick={() => setConfirmDelete({ kind: "customer", customer: c })}
                          title="Deactivate"
                        >
                          <IconDelete />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredCustomers.length === 0 && <p className="empty-state">No customers match your search.</p>}
            </div>
          </section>
        )}
      </div>

      <NewOrderModal
        isOpen={isNewOrderOpen}
        onClose={() => setIsNewOrderOpen(false)}
        onCreated={() => {
          showToast("Order created.");
          loadAll();
        }}
        customers={customers}
      />

      {orderModal && (
        <div className="modal-overlay open" onClick={(e) => e.target === e.currentTarget && setOrderModal(null)}>
          <div className="modal">
            <h3>Order Details — {orderModal.id}</h3>
            <Field label="Order Type">
              <select
                value={orderModal.type}
                onChange={(e) => setOrderModal({ ...orderModal, type: e.target.value })}
              >
                <option>Delivery</option><option>Walk-in</option><option>Pickup</option>
              </select>
            </Field>
            <Field label="Date"><input disabled value={new Date(orderModal.date).toLocaleString()} /></Field>
            <Field label="Order Status">
              <select
                value={orderModal.status}
                onChange={(e) => setOrderModal({ ...orderModal, status: e.target.value })}
              >
                <option>Preparing</option><option>Ready</option><option>Completed</option><option>Cancelled</option>
              </select>
            </Field>

            <div className="items-header">
              <span>Product Name</span><span>Qty</span><span>Unit Price</span><span>Subtotal</span>
            </div>
            {(orderModal.items || []).map((it, i) => (
              <div key={i} className="item-row">
                <span>{it.name}</span><span>{it.qty}</span><span>{peso(it.unitPrice)}</span><span>{peso(it.subtotal)}</span>
              </div>
            ))}
            <div className="totals">
              <Row label="Delivery Fee:" value={peso(orderModal.deliveryFee)} />
              <Row label="Total Amount:" value={peso(orderModal.totalAmount)} bold />
            </div>

            <hr />
            <Field label="Customer"><input disabled value={orderModal.customerName || ""} /></Field>
            <Field label="Phone"><input disabled value={orderModal.customerPhone || ""} /></Field>
            <Field label="Address"><input disabled value={orderModal.customerAddress || ""} /></Field>

            <hr />
            <Field label="Payment Method">
              <select
                value={orderModal.paymentMethod || "Cash"}
                onChange={(e) => setOrderModal({ ...orderModal, paymentMethod: e.target.value })}
              >
                <option>Cash</option><option>GCash</option><option>Card</option><option>Bank Transfer</option>
              </select>
            </Field>
            <Field label="Payment Status">
              <select
                value={orderModal.paymentStatus}
                onChange={(e) => setOrderModal({ ...orderModal, paymentStatus: e.target.value })}
              >
                <option>Unpaid</option><option>Paid</option>
              </select>
            </Field>

            {orderModal.type === "Delivery" && orderModal.deliveryId && (
              <>
                <hr />
                <Field label="Delivery No."><input disabled value={orderModal.drNo || ""} /></Field>
                <Field label="Delivery Rider">
                  <select
                    value={orderModal.deliveryRiderId || ""}
                    onChange={(e) => setOrderModal({ ...orderModal, deliveryRiderId: e.target.value })}
                  >
                    <option value="">Unassigned</option>
                    {drivers.map((d) => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Delivery Status">
                  <select
                    value={orderModal.deliveryStatus || "Pending"}
                    onChange={(e) => setOrderModal({ ...orderModal, deliveryStatus: e.target.value })}
                  >
                    <option>Pending</option><option>Out for Delivery</option><option>Delivered</option><option>Failed</option>
                  </select>
                </Field>
              </>
            )}

            <div className="modal-actions">
              <button className="btn btn-outline" onClick={() => setOrderModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveOrder} disabled={isSavingOrder}>
                {isSavingOrder ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {customerModal && (
        <div className="modal-overlay open" onClick={(e) => e.target === e.currentTarget && setCustomerModal(null)}>
          <div className="modal modal-sm">
            <h3>{customerModal.isNew ? "Add Customer" : "Edit Customer"}</h3>
            <Field label="Customer Name">
              <input value={customerModal.name} onChange={(e) => setCustomerModal({ ...customerModal, name: e.target.value })} placeholder="Name" />
            </Field>
            <Field label="Phone Number">
              <input value={customerModal.phone} onChange={(e) => setCustomerModal({ ...customerModal, phone: e.target.value })} placeholder="Phone Number" />
            </Field>
            <Field label="Address">
              <textarea value={customerModal.address} onChange={(e) => setCustomerModal({ ...customerModal, address: e.target.value })} placeholder="Street, Brgy, City, Province, Zip Code" />
            </Field>
            {customerModal.isNew && (
              <Field label="Customer Type">
                <select
                  value={customerModal.customerType}
                  onChange={(e) => setCustomerModal({ ...customerModal, customerType: e.target.value })}
                >
                  <option>Residential</option>
                  <option>Commercial</option>
                </select>
              </Field>
            )}
            <div className="modal-actions">
              <button className="btn btn-outline" onClick={() => setCustomerModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveCustomer}>Save</button>
            </div>
          </div>
        </div>
      )}

      {confirmDelete && (
        <div className="modal-overlay open" onClick={(e) => e.target === e.currentTarget && setConfirmDelete(null)}>
          <div className="modal modal-xs">
            <h3>{confirmDelete.kind === "order" ? "Cancel order?" : "Deactivate customer?"}</h3>
            <p>
              {confirmDelete.kind === "order"
                ? `This will cancel order ${confirmDelete.order.id} and restore its stock. This cannot be undone.`
                : `This will deactivate ${confirmDelete.customer.name}. They can be reactivated later.`}
            </p>
            <div className="modal-actions">
              <button className="btn btn-outline" onClick={() => setConfirmDelete(null)}>Back</button>
              <button
                className="btn btn-danger"
                onClick={() =>
                  confirmDelete.kind === "order" ? deleteOrder(confirmDelete.order) : deleteCustomer(confirmDelete.customer)
                }
              >
                {confirmDelete.kind === "order" ? "Cancel Order" : "Deactivate"}
              </button>
            </div>
          </div>
        </div>
      )}

      {toastMsg && <div className="toast show">{toastMsg}</div>}
    </div>
  );
}