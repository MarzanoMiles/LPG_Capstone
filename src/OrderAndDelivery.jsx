import { useCallback, useEffect, useState } from "react";
import { FileSearch, Printer, Ban } from "lucide-react";
import { apiRequest } from "./api";
import { printReceipt } from "./utils/receipt";
import ReturnedCylindersModal from "./ReturnedCylindersModal";
import "./OrderAndDelivery.css";

const peso = (n) =>
  "₱ " + Number(n || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const orderStatusClass = {
  Preparing: "od-badge-yellow",
  Ready: "od-badge-blue",
  "Ready for Pickup": "od-badge-blue",
  "Expired (Unclaimed)": "od-badge-red",
  Completed: "od-badge-green",
  Cancelled: "od-badge-red",
};

const paymentStatusClass = {
  Paid: "od-badge-green",
  Unpaid: "od-badge-red",
};

const deliveryStatusClass = {
  Pending: "od-badge-yellow",
  "Out for Delivery": "od-badge-blue",
  Delivered: "od-badge-green",
  Failed: "od-badge-red",
};

const IconView = () => <FileSearch size={16} />;
const IconEdit = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
  </svg>
);
const IconPrint = () => <Printer size={16} />;
const IconDelete = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6"></polyline>
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
  </svg>
);

function Badge({ text, map }) {
  return <span className={`od-badge ${map[text] || "od-badge-gray"}`}>{text}</span>;
}

function Field({ label, children }) {
  return (
    <div className="od-form-row">
      <label>{label}</label>
      {children}
    </div>
  );
}

function Row({ label, value, bold }) {
  return (
    <div className={bold ? "od-grand" : ""}>
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
    saleNo: order.saleNo,
    orderNo: order.id,
    deliveryNo: order.drNo,
    driverName: order.deliveryRiderName,
    customerPhone: order.customerPhone,
    customerAddress: order.customerAddress,
    deliveryAddress: order.deliveryAddress,
    deliveryNotes: order.deliveryNotes || order.remarks,
    paymentMethod: order.paymentMethod || (order.type === "Delivery" ? "Cash on Delivery" : "Cash"),
    referenceNo: order.referenceNo,
    amountPaid: order.amountPaid,
    completed: order.status === "Completed",
    documentType: order.status !== "Completed" && (order.paymentStatus !== "Paid" || !order.saleNo) ? "slip" : undefined,
    datetime: order.date,
    customerName: order.customerName,
    orderType: order.type,
    items,
    subtotal,
    discount: 0,
    deliveryFee: Number(order.deliveryFee || 0),
    totalAmount: Number(order.totalAmount || subtotal + Number(order.deliveryFee || 0)),
  });
}

function PickupClaimModal({order,onClose,onCompleted}) {
  const [answer,setAnswer]=useState("");
  const [items,setItems]=useState([]);
  const [warehouseId,setWarehouseId]=useState("");
  const [options,setOptions]=useState({warehouses:[],products:[]});
  const [showReturns,setShowReturns]=useState(false);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  useEffect(()=>{
    let active=true;
    apiRequest(`/orders/${order.orderId}/pickup-claim-options`).then(data=>{if(active){setOptions(data);if(data.warehouses.length===1)setWarehouseId(data.warehouses[0].id);}}).catch(err=>{if(active)setError(err.message);}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[order.orderId]);
  const submit=async()=>{
    if(busy || !answer)return;
    setBusy(true);setError("");
    try {
      await apiRequest(`/orders/${order.orderId}/pickup-claim`,{method:"POST",body:JSON.stringify({emptyCylinderReturned:answer==="yes",warehouseId:answer==="yes"?warehouseId:undefined,returnedCylinders:answer==="yes"?items:[]})});
      onCompleted();
    }catch(err){setError(err.message);}finally{setBusy(false);}
  };
  if(showReturns)return <ReturnedCylindersModal items={items} cylinderProducts={options.products} warehouseOptions={options.warehouses} warehouseId={warehouseId} onWarehouseChange={setWarehouseId} loading={loading} warehouseName={options.warehouses.find(w=>w.id===warehouseId)?.name}
    confirmationNote="Stock will be updated in the warehouse shown above when the pickup claim is completed."
    onCancel={()=>{setShowReturns(false);if(!items.length)setAnswer("");}} onConfirm={value=>{setItems(value);setShowReturns(false);}} />;
  return <div className="payment-modal-overlay"><div className="payment-modal" role="dialog" aria-modal="true" aria-label="Complete Claim">
    <div className="payment-modal-accent" />
    <h2 className="payment-modal-title">Complete Claim</h2><p className="return-description">{order.id}</p>
    <div className="cylinder-return-section"><div className="cylinder-return-question" role="group" aria-label="Empty Cylinder Returned?">
      <span>Empty Cylinder Returned?</span>
      <label><input type="radio" name="claim-returned" disabled={busy} checked={answer==="yes"} onChange={()=>{setAnswer("yes");setShowReturns(true);}} /> Yes</label>
      <label><input type="radio" name="claim-returned" disabled={busy} checked={answer==="no"} onChange={()=>{setAnswer("no");setItems([]);}} /> No</label>
    </div></div>
    {answer==="yes" && <>
      <button type="button" className="return-edit-btn" disabled={busy} onClick={()=>setShowReturns(true)}>{items.length ? "Edit returned cylinders" : "Select returned cylinders"}</button>
      <div className="return-summary"><span>Total Items</span><strong>{items.reduce((sum,item)=>sum+Number(item.qty),0)}</strong></div>
    </>}
    {error && <p role="alert" style={{color:"#dc2626"}}>{error}</p>}
    <div className="payment-modal-actions return-actions"><button type="button" className="payment-modal-btn cancel" disabled={busy} onClick={onClose}>Cancel</button><button type="button" className="payment-modal-btn confirm" disabled={busy||!answer||(answer==="yes"&&(loading||!warehouseId||!items.length))} onClick={submit}>{busy?"Completing?":"Confirm Claim"}</button></div>
  </div></div>;
}

function PickupSettlementModal({order,onClose,onSettled}) {
  const [quote,setQuote]=useState(null);
  const [form,setForm]=useState({refundMethod:"GCash",accountName:"",accountNumber:"",payoutReferenceNo:""});
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  const [loading,setLoading]=useState(true);
  const money=value => "\u20b1"+Number(value||0).toLocaleString("en-PH",{minimumFractionDigits:2,maximumFractionDigits:2});
  const loadQuote=useCallback(async()=>{
    setLoading(true);setError("");
    try {
      const data=await apiRequest(`/orders/${order.orderId}/pickup-settlement`);
      setQuote(data);setForm(previous=>({...previous,accountName:previous.accountName || data.accountName || ""}));
    } catch(err) {setQuote(null);setError(err.message);}
    finally {setLoading(false);}
  },[order.orderId]);
  useEffect(()=>{loadQuote();},[loadQuote]);
  const submit=async(event)=>{
    event.preventDefault();if(busy || !quote)return;
    setBusy(true);setError("");
    try {
      await apiRequest(`/orders/${order.orderId}/pickup-settlement`,{method:"POST",body:JSON.stringify({...form,quote:{eligibleAmount:quote.eligibleAmount,cancellationFee:quote.cancellationFee,refundAmount:quote.refundAmount}})});
      onSettled();
    } catch(err) {setError(err.message);}
    finally {setBusy(false);}
  };
  const update=key=>event=>setForm(previous=>({...previous,[key]:event.target.value}));
  return <div className="od-modal-overlay open"><form className="od-modal od-modal-sm" onSubmit={submit}>
    <h3>Restock &amp; Settle Order</h3><p>{order.id}</p>
    <p>Inventory Update: Upon confirmation, the item(s) from this order will be automatically added back to your active inventory count.</p>
    {loading && <p>Loading settlement amounts?</p>}
    {error && <p role="alert" style={{color:"#dc2626"}}>{error}</p>}
    {quote && <>
      <div className="od-totals"><Row label="Original Paid Amount" value={money(quote.eligibleAmount)} /><Row label="Cancellation/Unclaimed Fee" value={money(quote.cancellationFee)} /><Row label="Net Refund Amount" value={money(quote.refundAmount)} bold /></div>
      <Field label="Refund Method"><select value={form.refundMethod} onChange={update("refundMethod")} disabled={busy}><option>GCash</option><option>Card</option><option>Bank Transfer</option></select></Field>
      <Field label="Account Name"><input value={form.accountName} onChange={update("accountName")} required maxLength={150} autoComplete="off" disabled={busy} /></Field>
      <Field label="Account/Mobile Number"><input type="text" inputMode={form.refundMethod === "GCash" ? "tel" : "numeric"} value={form.accountNumber} onChange={update("accountNumber")} required maxLength={34} autoComplete="off" pattern={form.refundMethod === "GCash" ? "(09[0-9]{9}|[+]639[0-9]{9})" : form.refundMethod === "Card" ? "[0-9]{12,19}" : "[0-9]{6,34}"} title={form.refundMethod === "GCash" ? "09 followed by 9 digits, or +639 followed by 9 digits" : form.refundMethod === "Card" ? "12 to 19 digits" : "6 to 34 digits"} disabled={busy} /></Field>
      <Field label="Payout Reference No. (optional)"><input value={form.payoutReferenceNo} onChange={update("payoutReferenceNo")} maxLength={50} autoComplete="off" disabled={busy} /></Field>
    </>}
    <div className="od-modal-actions"><button type="button" className="od-btn od-btn-outline" onClick={onClose} disabled={busy}>Close</button>
      {error && <button type="button" className="od-btn od-btn-outline" onClick={loadQuote} disabled={busy||loading}>Reload Quote</button>}
      <button type="submit" className="od-btn od-btn-primary" disabled={busy||loading||!quote}>{busy ? "Settling?" : "Confirm Settlement"}</button>
    </div>
  </form></div>;
}

export default function OrderAndDelivery() {
  const [pickups, setPickups] = useState([]);
  const [pickupModal, setPickupModal] = useState(null);
  const [pickupBusy, setPickupBusy] = useState(false);
  const [customerHistory,setCustomerHistory]=useState(null);
  const [customers, setCustomers] = useState([]);
  const [orders, setOrders] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [tab, setTab] = useState("pickup");
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [deliverySearch, setDeliverySearch] = useState("");
  const [deliveryStatusFilter, setDeliveryStatusFilter] = useState("");
  const [customersSearch, setCustomersSearch] = useState("");

  const [orderModal, setOrderModal] = useState(null);
  const [customerModal, setCustomerModal] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [toastMsg, setToastMsg] = useState("");
  const [isSavingOrder, setIsSavingOrder] = useState(false);

  const [showDeliveredConfirm, setShowDeliveredConfirm] = useState(false);

  function showToast(msg) {
    setToastMsg(msg);
    window.clearTimeout(showToast._t);
    showToast._t = window.setTimeout(() => setToastMsg(""), 2500);
  }

  const loadAll = () => {
    setIsLoading(true);
    Promise.all([
      apiRequest("/customers"),
      apiRequest("/orders?type=Delivery"),
      apiRequest("/users?role=Driver"),
      apiRequest("/orders/pickup"),
    ])
      .then(([customerData, orderData, driverData, pickupData]) => {
        setPickups(pickupData);
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

  const pickupAction = async (order, status) => {
    setPickupBusy(true);
    try {
      await apiRequest(`/orders/${order.orderId}/pickup-status`, {method:"PUT", body:JSON.stringify({status})});
      setPickupModal(null);
      showToast("Pickup updated.");
      loadAll();
    } catch (err) { showToast(err.message); loadAll(); }
    finally { setPickupBusy(false); }
  };

  const openOrder = async (order) => {
    try {
      const full = await apiRequest(`/orders/${order.orderId}`);
      if (full.type === "Pickup") setPickupModal({kind:"view",order:full});
      else setOrderModal(full);
    } catch (err) {
      showToast(err.message || "Failed to load order details.");
    }
  };

  const handleDeliveryStatusSelect = (value) => {
    if (value === "Delivered") {
      setShowDeliveredConfirm(true);
      return;
    }
    setOrderModal((prev) => ({ ...prev, deliveryStatus: value }));
  };

  const confirmDelivered = () => {
    setOrderModal((prev) => ({ ...prev, deliveryStatus: "Delivered" }));
    setShowDeliveredConfirm(false);
  };

  const saveOrder = async () => {
    setIsSavingOrder(true);
    try {
      await apiRequest(`/orders/${orderModal.orderId}`, {
        method: "PUT",
        body: JSON.stringify({
          orderType: orderModal.type,
          orderStatus: orderModal.status,
          deliveryAddress:
            orderModal.type === "Delivery" && !orderModal.deliveryId ? orderModal.deliveryAddress : undefined,
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
      if (orderModal.type === "Delivery") {
        await apiRequest(`/orders/${orderModal.orderId}/delivery`, {
          method: "PUT",
          body: JSON.stringify({
            deliveryStatus: orderModal.deliveryStatus,
            deliveryRiderId: orderModal.deliveryRiderId || null,
          }),
        }).catch(() => {});
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

  const deliveryRows = orders.filter((o) => o.type === "Delivery" && o.status !== "Cancelled" && o.deliveryStatus !== "Delivered");

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

  const viewCustomerHistory=async(customer)=>{
    try {
      const rows=await apiRequest(`/orders/customer/${encodeURIComponent(customer.id)}/history`);
      setCustomerHistory({customer,rows});
    }catch(err){showToast(err.message || "Failed to load order history.");}
  };
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
    <div className="od-page">
      <h1 className="od-page-title">Order and Delivery</h1>

      {loadError && <p style={{ color: "#dc2626", fontWeight: 600 }}>{loadError}</p>}

      <div className="od-panel">
        <div className="od-panel-header">
          {tab === "customers" && (
            <button className="od-btn od-btn-primary" onClick={openAddCustomer}>
              + Add Customer
            </button>
          )}
        </div>

        <div className="od-tabs">
          {[
            { id: "pickup", label: "Pickup" },
            { id: "delivery", label: "Delivery" },
            { id: "customers", label: "Customers" },
          ].map((t) => (
            <button key={t.id} className={`od-tab ${tab === t.id ? "active" : ""}`} onClick={() => setTab(t.id)}>
              {t.label}{t.id !== "customers" && <span className="od-badge od-badge-blue" style={{marginLeft:8}}>{t.id === "pickup" ? pickups.length : deliveryRows.length}</span>}
            </button>
          ))}
        </div>

        {tab === "pickup" && <section className="od-pickup-section">
          <div className="od-filters"><button type="button" className="od-btn od-btn-outline" onClick={loadAll} disabled={isLoading}>Refresh</button></div>
          <div className="od-table-wrap"><table>
            <thead><tr>{["Order ID","Customer Name","Pickup Status","Payment Status","Total Amount","Date","Change Status","Actions"].map(label => <th key={label}>{label}</th>)}</tr></thead>
            <tbody>{pickups.map(o => <tr key={o.orderId}>
              <td>{o.id}</td><td>{o.customerName || "Customer unavailable"}</td>
              <td><Badge text={o.pickupStatus === "Unclaimed" ? "Expired (Unclaimed)" : o.pickupStatus} map={orderStatusClass} /></td>
              <td><Badge text={o.paymentStatus} map={paymentStatusClass} /></td>
              <td>{peso(o.totalAmount).replace("? ","?")}</td>
              <td>{o.pickupScheduledAt ? new Date(o.pickupScheduledAt.replace(" ","T") + "+08:00").toLocaleString("en-PH", {timeZone:"Asia/Manila"}) : "Schedule unavailable (legacy)"}</td>
              <td>{o.pickupStatus === "Preparing" ? <button className="od-btn od-btn-primary" disabled={pickupBusy} onClick={() => pickupAction(o,"Ready for Pickup")}>Mark Ready</button> : o.pickupStatus === "Ready for Pickup" ? <button className="od-btn od-btn-primary" onClick={() => setPickupModal({order:o,kind:"complete"})}>Complete Claim</button> : o.canSettle ? <button className="od-btn od-btn-outline" onClick={() => setPickupModal({order:o,kind:"settle"})}>Restock &amp; Settle</button> : "?"}</td>
              <td><div className="od-actions">
                <button type="button" className="od-action-btn od-act-view" title="View" aria-label={`View ${o.id}`} onClick={async () => {try {setPickupModal({kind:"view",order:await apiRequest(`/orders/${o.orderId}`)});} catch(err) {showToast(err.message);}}}><IconView /></button>
                <button type="button" className="od-action-btn od-act-print" title="Print" aria-label={`Print ${o.id}`} onClick={async () => {try {printOrderReceipt(await apiRequest(`/orders/${o.orderId}`));} catch(err) {showToast(err.message);}}}><IconPrint /></button>
                <button type="button" className="od-action-btn od-act-cancel" title="Cancel" aria-label={`Cancel ${o.id}`} disabled={!["Preparing","Ready for Pickup"].includes(o.pickupStatus) || pickupBusy} onClick={() => setPickupModal({order:o,kind:"cancel"})}><Ban size={16} /></button>
              </div></td>
            </tr>)}</tbody>
          </table>{!pickups.length && <p className="od-empty-state">{isLoading ? "Loading?" : "No active paid pickup orders."}</p>}</div>
        </section>}

        {tab === "delivery" && (
          <section>
            <div className="od-filters">
              <div className="od-search-box">
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

            <div className="od-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Delivery No.</th><th>Order ID</th><th>Rider</th>
                    <th>Delivery Status</th><th>Delivered At</th><th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDelivery.map((d) => (
                    <tr key={d.orderId}>
                      <td>{d.drNo || "—"}</td>
                      <td>{d.id}</td>
                      <td>{d.deliveryRiderName || "Unassigned"}</td>
                      <td>{d.deliveryStatus ? <Badge text={d.deliveryStatus} map={deliveryStatusClass} /> : "—"}</td>
                      <td>{d.deliveredAt ? new Date(d.deliveredAt).toLocaleString() : "N/A"}</td>
                      <td>
                        <div className="od-actions">
                          <button className="od-action-btn od-act-view" onClick={() => openOrder(d)} title="View/Edit">
                            <IconView />
                          </button>
                          <button
                            className="od-action-btn od-act-delete"
                            onClick={() => setConfirmDelete({ kind: "order", order: d })}
                            title="Cancel"
                          >
                            <IconDelete />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredDelivery.length === 0 && <p className="od-empty-state">No delivery orders match your search.</p>}
            </div>
          </section>
        )}

        {tab === "customers" && (
          <section>
            <div className="od-filters">
              <div className="od-search-box">
                <input value={customersSearch} onChange={(e) => setCustomersSearch(e.target.value)} placeholder="Search Customer" />
              </div>
            </div>

            <div className="od-table-wrap">
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
                      <td><Badge text={c.status} map={{ Active: "od-badge-green", Inactive: "od-badge-red" }} /></td>
                      <td>{new Date(c.created).toLocaleDateString()}</td>
                      <td>
                        <div className="od-actions">
                          <button type="button" className="od-action-btn od-act-view" title="View Order History" aria-label={`View order history for ${c.name}`} onClick={()=>viewCustomerHistory(c)}><IconView /></button>
                          <button className="od-action-btn od-act-edit" onClick={() => openEditCustomer(c)} title="Edit">
                            <IconEdit />
                          </button>
                          <button
                            className="od-action-btn od-act-delete"
                            onClick={() => setConfirmDelete({ kind: "customer", customer: c })}
                            title="Deactivate"
                          >
                            <IconDelete />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredCustomers.length === 0 && <p className="od-empty-state">No customers match your search.</p>}
            </div>
          </section>
        )}
      </div>

      {customerHistory && <div className="od-modal-overlay open"><div className="od-modal" role="dialog" aria-modal="true" aria-label="Customer Order History">
        <h3>Order History</h3><p>Customer Name: {customerHistory.customer.name}</p>
        <div className="od-table-wrap"><table><thead><tr><th>Order ID</th><th>Type</th><th>Status</th><th>Date</th><th>Total</th><th>Settlement</th><th>Net Refund</th><th>Actions</th></tr></thead>
          <tbody>{customerHistory.rows.map(order=><tr key={order.orderId}><td>{order.id}</td><td>{order.type}</td><td>{order.status}</td><td>{new Date(order.date).toLocaleDateString("en-PH")}</td><td>{peso(order.totalAmount)}</td><td>{order.settledAt ? "Settled" : "N/A"}</td><td>{order.settledAt ? peso(order.netRefundAmount) : "N/A"}</td><td><button type="button" className="od-action-btn od-act-view" title="View Order" aria-label={`View ${order.id}`} onClick={async()=>{try{const full=await apiRequest(`/orders/${order.orderId}`);setCustomerHistory(null);setPickupModal({kind:"view",order:full});}catch(err){showToast(err.message);}}}><IconView /></button></td></tr>)}</tbody>
        </table>{!customerHistory.rows.length && <p className="od-empty-state">No orders recorded for this customer.</p>}</div>
        <div className="od-modal-actions"><button type="button" className="od-btn od-btn-outline" onClick={()=>setCustomerHistory(null)}>Close</button></div>
      </div></div>}

      {orderModal && (
        <div className="od-modal-overlay open" onClick={(e) => e.target === e.currentTarget && setOrderModal(null)}>
          <div className="od-modal">
            <h3>Order Details — {orderModal.id}</h3>
            <Field label="Order Type">
              <select
                value={orderModal.type}
                onChange={(e) => setOrderModal({ ...orderModal, type: e.target.value })}
              >
                <option>Delivery</option>
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

            <div className="od-items-header">
              <span>Product Name</span><span>Qty</span><span>Unit Price</span><span>Subtotal</span>
            </div>
            {(orderModal.items || []).map((it, i) => (
              <div key={i} className="od-item-row">
                <span>{it.name}</span><span>{it.qty}</span><span>{peso(it.unitPrice)}</span><span>{peso(it.subtotal)}</span>
              </div>
            ))}
            <div className="od-totals">
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

            {orderModal.type === "Delivery" && (
              <>
                <hr />
                {orderModal.deliveryId ? (
                  <>
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
                        onChange={(e) => handleDeliveryStatusSelect(e.target.value)}
                      >
                        <option>Pending</option><option>Out for Delivery</option><option>Delivered</option><option>Failed</option>
                      </select>
                    </Field>
                  </>
                ) : (
                  <Field label="Delivery Address (new)">
                    <input
                      value={orderModal.deliveryAddress || ""}
                      onChange={(e) => setOrderModal({ ...orderModal, deliveryAddress: e.target.value })}
                      placeholder="Enter the delivery address"
                    />
                  </Field>
                )}
              </>
            )}

            <div className="od-modal-actions">
              <button className="od-btn od-btn-outline" onClick={() => setOrderModal(null)}>Cancel</button>
              <button className="od-btn od-btn-primary" onClick={saveOrder} disabled={isSavingOrder}>
                {isSavingOrder ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {pickupModal?.kind === "complete" && <PickupClaimModal key={pickupModal.order.orderId} order={pickupModal.order} onClose={()=>setPickupModal(null)} onCompleted={()=>{setPickupModal(null);showToast("Pickup claim completed.");loadAll();}} />}

      {pickupModal?.kind === "settle" && <PickupSettlementModal key={pickupModal.order.orderId} order={pickupModal.order} onClose={()=>setPickupModal(null)} onSettled={()=>{setPickupModal(null);showToast("Pickup settled and inventory restored.");loadAll();}} />}

      {pickupModal && !["settle","complete"].includes(pickupModal.kind) && <div className="od-modal-overlay open"><div className="od-modal od-modal-sm">
        <h3>{pickupModal.kind === "complete" ? "Complete Claim" : pickupModal.kind === "cancel" ? "Cancel Pickup" : pickupModal.kind === "settle" ? "Restock & Settle" : "Pickup Details"}</h3>
        <p>{pickupModal.order.id}</p>
        <p><span>Customer Name:</span>{" "}<span>{pickupModal.order.customerName || "Customer unavailable"}</span></p>
        {pickupModal.kind === "view" && <><p>Status: {pickupModal.order.pickupStatus}</p><p>Scheduled pickup (locked): {pickupModal.order.pickupScheduledAt || "Unavailable (legacy)"}</p>{pickupModal.order.items?.map((item,i) => <div key={i}><p>Product: {item.name}</p><p>Qty: {item.qty}</p></div>)}<p>Total Items: {(pickupModal.order.items || []).reduce((sum,item) => sum + Number(item.qty || 0), 0)}</p><p>Total: {peso(pickupModal.order.totalAmount)}</p></>}
        {pickupModal.kind === "cancel" && <p>Cancel this pickup within its expiration threshold. Stock and payment will remain pending settlement.</p>}
        <div className="od-modal-actions"><button className="od-btn od-btn-outline" disabled={pickupBusy} onClick={() => setPickupModal(null)}>Close</button>
          {pickupModal.kind === "cancel" && <button className="od-btn od-btn-primary" disabled={pickupBusy} onClick={() => pickupAction(pickupModal.order,"Cancelled")}>{pickupBusy ? "Saving?" : "Confirm"}</button>}
        </div>
      </div></div>}

      {showDeliveredConfirm && (
        <div className="od-modal-overlay open" onClick={(e) => e.target === e.currentTarget && setShowDeliveredConfirm(false)}>
          <div className="od-modal od-modal-xs">
            <h3>Mark as Delivered?</h3>
            <p>Confirm that order {orderModal?.id} has been delivered to the customer.</p>
            <div className="od-modal-actions">
              <button className="od-btn od-btn-outline" onClick={() => setShowDeliveredConfirm(false)}>Cancel</button>
              <button className="od-btn od-btn-primary" onClick={confirmDelivered}>Confirm Delivered</button>
            </div>
          </div>
        </div>
      )}

      {customerModal && (
        <div className="od-modal-overlay open" onClick={(e) => e.target === e.currentTarget && setCustomerModal(null)}>
          <div className="od-modal od-modal-sm">
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
            <div className="od-modal-actions">
              <button className="od-btn od-btn-outline" onClick={() => setCustomerModal(null)}>Cancel</button>
              <button className="od-btn od-btn-primary" onClick={saveCustomer}>Save</button>
            </div>
          </div>
        </div>
      )}

      {confirmDelete && (
        <div className="od-modal-overlay open" onClick={(e) => e.target === e.currentTarget && setConfirmDelete(null)}>
          <div className="od-modal od-modal-xs">
            <h3>{confirmDelete.kind === "order" ? "Cancel order?" : "Deactivate customer?"}</h3>
            <p>
              {confirmDelete.kind === "order"
                ? `This will cancel order ${confirmDelete.order.id} and restore its stock. This cannot be undone.`
                : `This will deactivate ${confirmDelete.customer.name}. They can be reactivated later.`}
            </p>
            <div className="od-modal-actions">
              <button className="od-btn od-btn-outline" onClick={() => setConfirmDelete(null)}>Back</button>
              <button
                className="od-btn od-btn-danger"
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

      {toastMsg && <div className="od-toast show">{toastMsg}</div>}
    </div>
  );
}



