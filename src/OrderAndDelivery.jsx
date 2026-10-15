import PageLayout, { PageHeader } from "./PageLayout";
import { customerPageData } from "./utils/customers";
import { useCallback, useEffect, useState } from "react";
import { FileSearch, Printer, Ban, X } from "lucide-react";
import { apiRequest } from "./api";
import { printReceipt } from "./utils/receipt";
import Pagination from "./Pagination";
import { createRequestId } from "./utils/requestId";
import ReturnedCylindersModal from "./ReturnedCylindersModal";
import "./OrderAndDelivery.css";

const DELIVERY_PAGE_SIZE = 5;
const FAILED_ATTEMPT_REASONS = [
  "Recipient Unavailable / No One to Receive",
  "Customer Unreachable",
  "Insufficient Cash on Hand (COD Unpaid)",
  "Premises Inaccessible",
  "Severe Weather / Flooding / Impassable Road",
  "Item Damaged in Transit",
  "Other (Specify in Notes)",
];

const peso = (n) =>
  "\u20b1 " + Number(n || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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
  Preparing: "od-badge-yellow",
  "Out for Delivery": "od-badge-blue",
  Delivered: "od-badge-green",
  "Failed Attempt": "od-badge-red",
  "Delivery Failed": "od-badge-red",
  Cancelled: "od-badge-red",
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
  const delivery=order.type === "Delivery";
  const isCod=delivery && order.paymentMethod === "Cash on Delivery";
  const amountToCollect=Number(order.amountToCollect ?? Math.max(0,Number(order.totalAmount)-Number(order.amountPaid || 0)));
  const [amountCollected,setAmountCollected]=useState("");
  const [requestId]=useState(()=>createRequestId());
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
    apiRequest(delivery?`/deliveries/${order.deliveryId}/return-options`:`/orders/${order.orderId}/pickup-claim-options`).then(data=>{if(active){setOptions(data);if(data.warehouses.length===1)setWarehouseId(data.warehouses[0].id);}}).catch(err=>{if(active)setError(err.message);}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[order.orderId,order.deliveryId,delivery]);
  const submit=async()=>{
    if(busy || !answer)return;
    if(isCod && (!/^\d+(?:\.\d{1,2})?$/.test(amountCollected) || Number(amountCollected)>9999999999.99)) {
      setError("Enter a valid amount collected with up to two decimal places. Enter 0 if none.");return;
    }
    if(isCod && Math.round(Number(amountCollected)*100)<Math.round(amountToCollect*100)) {
      setError("Amount collected must cover the amount to collect before confirming delivery.");return;
    }
    setBusy(true);setError("");
    try {
      await apiRequest(delivery?`/deliveries/${order.deliveryId}/complete`:`/orders/${order.orderId}/pickup-claim`,{method:"POST",body:JSON.stringify({requestId,amountCollected:isCod?Number(amountCollected):undefined,emptyCylinderReturned:answer==="yes",warehouseId:answer==="yes"?warehouseId:undefined,returnedCylinders:answer==="yes"?items:[]})});
      onCompleted();
    }catch(err){setError(err.message);}finally{setBusy(false);}
  };
  if(showReturns)return <ReturnedCylindersModal items={items} cylinderProducts={options.products} inventoryStocks={options.inventoryStocks || []} warehouseOptions={options.warehouses} warehouseId={warehouseId} onWarehouseChange={setWarehouseId} loading={loading} warehouseName={options.warehouses.find(w=>w.id===warehouseId)?.name}
    confirmationNote="Stock will be updated in the warehouse shown above when fulfillment is completed."
    onCancel={()=>{setShowReturns(false);if(!items.length)setAnswer("");}} onConfirm={value=>{setItems(value);setShowReturns(false);}} />;
  return <div className="payment-modal-overlay"><div className={`payment-modal od-claim-modal${delivery?" od-confirm-delivery-modal":""}`} role="dialog" aria-modal="true" aria-label={delivery?"Confirm Delivery":"Complete Claim"}>
    <div className="payment-modal-accent" />
    <h2 className="payment-modal-title">{delivery?"Confirm Delivery":"Complete Claim"}</h2>
    {delivery?<div className="payment-modal-row"><span className="payment-modal-label">Order ID:</span><span className="payment-modal-value">{order.id}</span></div>:<p className="return-description">{order.id}</p>}
    {isCod && <div className="payment-modal-row"><span className="payment-modal-label">Amount to Collect:</span><span className="payment-modal-value">{peso(amountToCollect)}</span></div>}
    {isCod && <div className="payment-modal-row"><label className="payment-modal-label" htmlFor="delivery-amount-collected">Amount Collected:</label><input className="payment-modal-input" id="delivery-amount-collected" type="number" inputMode="decimal" min="0" max="9999999999.99" step="0.01" required disabled={busy} value={amountCollected} onChange={event=>setAmountCollected(event.target.value)} placeholder="Enter amount" /></div>}
    <div className="cylinder-return-section"><div className="cylinder-return-question" role="group" aria-label="Empty Cylinder Returned?">
      <span>Empty Cylinder Returned?</span>
      <label><input type="radio" name="claim-returned" disabled={busy} checked={answer==="yes"} onChange={()=>{setAnswer("yes");setShowReturns(true);}} /> Yes</label>
      <label><input type="radio" name="claim-returned" disabled={busy} checked={answer==="no"} onChange={()=>{setAnswer("no");setItems([]);}} /> No</label>
    </div></div>
    {answer==="yes" && <>
      <button type="button" className="return-edit-btn" disabled={busy} onClick={()=>setShowReturns(true)}>{items.length ? "Edit returned cylinders" : "Select returned cylinders"}</button>
      {!delivery && <div className="return-summary"><span>Total Items</span><strong>{items.reduce((sum,item)=>sum+Number(item.qty),0)}</strong></div>}
    </>}
    {error && <p role="alert" style={{color:"#dc2626"}}>{error}</p>}
    <div className="payment-modal-actions return-actions od-claim-actions"><button type="button" className="payment-modal-btn cancel" disabled={busy} onClick={onClose}>Cancel</button><button type="button" className="payment-modal-btn confirm" disabled={busy||!answer||(answer==="yes"&&(loading||!warehouseId||!items.length))} onClick={submit}>{busy?"Completing...":delivery?"Confirm Delivery":"Confirm Claim"}</button></div>
  </div></div>;
}

function PickupSettlementModal({order,onClose,onSettled}) {
  const delivery=order.type === "Delivery";
  const endpoint=delivery?`/deliveries/${order.deliveryId}/settlement`:`/orders/${order.orderId}/pickup-settlement`;
  const [requestId]=useState(()=>createRequestId());
  const [quote,setQuote]=useState(null);
  const [form,setForm]=useState({refundMethod:"GCash",accountName:"",accountNumber:"",payoutReferenceNo:""});
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  const [loading,setLoading]=useState(true);
  const money=value => "\u20b1"+Number(value||0).toLocaleString("en-PH",{minimumFractionDigits:2,maximumFractionDigits:2});
  const loadQuote=useCallback(async()=>{
    setLoading(true);setError("");
    try {
      const data=await apiRequest(endpoint);
      setQuote(data);setForm(previous=>({...previous,accountName:previous.accountName || data.accountName || ""}));
    } catch(err) {setQuote(null);setError(err.message);}
    finally {setLoading(false);}
  },[endpoint]);
  useEffect(()=>{loadQuote();},[loadQuote]);
  const submit=async(event)=>{
    event.preventDefault();if(busy || !quote)return;
    setBusy(true);setError("");
    try {
      await apiRequest(delivery?`/deliveries/${order.deliveryId}/settle`:endpoint,{method:"POST",body:JSON.stringify({...form,requestId,quote:{eligibleAmount:quote.eligibleAmount,cancellationFee:quote.cancellationFee,refundAmount:quote.refundAmount}})});
      onSettled();
    } catch(err) {setError(err.message);}
    finally {setBusy(false);}
  };
  const update=key=>event=>setForm(previous=>({...previous,[key]:event.target.value}));
  return <div className="od-modal-overlay open"><form className="od-modal od-modal-sm" onSubmit={submit}>
    <h3>Restock &amp; Settle Order</h3><p>{order.id}</p>
    <p>{delivery ? "Previously returned stock will not be restocked again. Confirm the authorized financial resolution below." : "Upon confirmation, ordered items will be restored to inventory."}</p>
    {loading && <p>Loading settlement amounts?</p>}
    {error && <p role="alert" style={{color:"#dc2626"}}>{error}</p>}
    {quote && <>
      <div className="od-totals"><Row label="Original Paid Amount" value={money(quote.eligibleAmount)} /><Row label="Cancellation/Unclaimed Fee" value={money(quote.cancellationFee)} /><Row label="Net Refund Amount" value={money(quote.refundAmount)} bold /></div>
      {quote.refundEnabled === false ? <p>Refunds are disabled. Confirm manager settlement without refund; payment remains unchanged.</p> : <>
      <Field label="Refund Method"><select value={form.refundMethod} onChange={update("refundMethod")} disabled={busy}><option>GCash</option><option>Card</option><option>Bank Transfer</option></select></Field>
      <Field label="Account Name"><input value={form.accountName} onChange={update("accountName")} required maxLength={150} autoComplete="off" disabled={busy} /></Field>
      <Field label="Account/Mobile Number"><input type="text" inputMode={form.refundMethod === "GCash" ? "tel" : "numeric"} value={form.accountNumber} onChange={update("accountNumber")} required maxLength={34} autoComplete="off" pattern={form.refundMethod === "GCash" ? "(09[0-9]{9}|[+]639[0-9]{9})" : form.refundMethod === "Card" ? "[0-9]{12,19}" : "[0-9]{6,34}"} title={form.refundMethod === "GCash" ? "09 followed by 9 digits, or +639 followed by 9 digits" : form.refundMethod === "Card" ? "12 to 19 digits" : "6 to 34 digits"} disabled={busy} /></Field>
      <Field label="Payout Reference No. (optional)"><input value={form.payoutReferenceNo} onChange={update("payoutReferenceNo")} maxLength={50} autoComplete="off" disabled={busy} /></Field>
      </>}
    </>}
    <div className="od-modal-actions"><button type="button" className="od-btn od-btn-outline" onClick={onClose} disabled={busy}>Close</button>
      {error && <button type="button" className="od-btn od-btn-outline" onClick={loadQuote} disabled={busy||loading}>Reload Quote</button>}
      <button type="submit" className="od-btn od-btn-primary" disabled={busy||loading||!quote}>{busy ? "Settling?" : "Confirm Settlement"}</button>
    </div>
  </form></div>;
}

export default function OrderAndDelivery() {
  const sessionUser=JSON.parse(localStorage.getItem("user") || "{}");
  const isDriver=["driver","drivers"].includes(String(sessionUser.roleName || sessionUser.role || "").toLowerCase());
  const [deliveryAction,setDeliveryAction]=useState(null);
  const [deliveryBusy,setDeliveryBusy]=useState(false);
  const [pickups, setPickups] = useState([]);
  const [pickupModal, setPickupModal] = useState(null);
  const [pickupBusy, setPickupBusy] = useState(false);
  const [customerHistory,setCustomerHistory]=useState(null);
  const [customerViewTab,setCustomerViewTab]=useState("profile");
  const [historyPage,setHistoryPage]=useState(1);
  const [customers, setCustomers] = useState([]);
  const [orders, setOrders] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [tab, setTab] = useState(isDriver?"delivery":"pickup");
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [deliverySearch, setDeliverySearch] = useState("");
  const [deliveryStatusFilter, setDeliveryStatusFilter] = useState("");
  const [deliveryPage,setDeliveryPage]=useState(1);
  const [customersSearch, setCustomersSearch] = useState("");
  const [customerTypeFilter,setCustomerTypeFilter]=useState("");
  const [customerPage,setCustomerPage]=useState(1);

  const [orderModal, setOrderModal] = useState(null);
  const [customerModal, setCustomerModal] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [toastMsg, setToastMsg] = useState("");
  const [isSavingOrder, setIsSavingOrder] = useState(false);


  function showToast(msg) {
    setToastMsg(msg);
    window.clearTimeout(showToast._t);
    showToast._t = window.setTimeout(() => setToastMsg(""), 2500);
  }

  const loadAll = useCallback(() => {
    setIsLoading(true);
    Promise.all([
      isDriver?Promise.resolve([]):apiRequest("/customers"),
      apiRequest("/deliveries"),
      isDriver?Promise.resolve([]):apiRequest("/deliveries/drivers"),
      isDriver?Promise.resolve([]):apiRequest("/orders/pickup"),
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
  },[isDriver]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

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

  const saveOrder = async () => {
    setIsSavingOrder(true);
    try {
      await apiRequest(`/deliveries/${orderModal.deliveryId}`,{method:"PUT",body:JSON.stringify({deliveredByUserId:orderModal.deliveryRiderId || null,remarks:orderModal.deliveryNotes || ""})});
      setOrderModal(null);showToast("Delivery updated.");loadAll();
    } catch(err) {showToast(err.message);} finally {setIsSavingOrder(false);}
  };
  const runDeliveryAction=async()=>{
    if(deliveryBusy || !deliveryAction)return;
    if(deliveryAction.action==="fail" && !deliveryAction.reason) {
      setDeliveryAction(previous=>({...previous,error:"Select a reason for the failed attempt."}));return;
    }
    if(deliveryAction.action==="fail" && deliveryAction.reason==="Other (Specify in Notes)" && !deliveryAction.notes.trim()) {
      setDeliveryAction(previous=>({...previous,error:"Specify the reason in Attempt details / notes when selecting Other."}));return;
    }
    setDeliveryBusy(true);
    setDeliveryAction(previous=>({...previous,error:""}));
    try {
      await apiRequest(`/deliveries/${deliveryAction.order.deliveryId}/${deliveryAction.action}`,{method:"POST",body:JSON.stringify({requestId:deliveryAction.requestId,reason:deliveryAction.action==="fail"?deliveryAction.reason:undefined,notes:deliveryAction.notes})});
      setDeliveryAction(null);showToast("Delivery updated.");loadAll();
    }catch(err){setDeliveryAction(previous=>({...previous,error:err.message || "Delivery action failed. Please try again."}));}finally{setDeliveryBusy(false);}
  };
  const dispatchDelivery=async(order)=>{
    if(deliveryBusy)return;
    if(!order.deliveryRiderId){showToast("Assign a driver using the view icon before dispatching.");return;}
    setDeliveryBusy(true);
    try {
      await apiRequest(`/deliveries/${order.deliveryId}/dispatch`,{method:"POST",body:JSON.stringify({requestId:createRequestId()})});
      showToast("Delivery dispatched.");loadAll();
    }catch(err){showToast(err.message || "Dispatch failed. Please try again.");}finally{setDeliveryBusy(false);}
  };
  const askDeliveryAction=(order,action)=>setDeliveryAction({order,action,reason:"",notes:"",driverId:order.deliveryRiderId || "",error:"",requestId:createRequestId()});

  const deleteOrder = async (order) => {
    try {
      await apiRequest(`/deliveries/${order.deliveryId}/cancel`, { method: "POST",body:JSON.stringify({requestId:createRequestId()}) });
      showToast(`Order ${order.id} cancelled and stock restored.`);
      setConfirmDelete(null);
      loadAll();
    } catch (err) {
      showToast(err.message || "Failed to cancel order.");
    }
  };

  const deliveryRows = orders.filter(order=>order.deliveryStatus!=="Delivered");

  const filteredDelivery = deliveryRows.filter((d) => {
    const q = deliverySearch.trim().toLowerCase();
    const matchesSearch = !q || (d.drNo || "").toLowerCase().includes(q) || (d.id || "").toLowerCase().includes(q) || (d.customerName || "").toLowerCase().includes(q) || (d.deliveryRiderName || "").toLowerCase().includes(q);
    const matchesStatus = !deliveryStatusFilter || d.deliveryStatus === deliveryStatusFilter;
    return matchesSearch && matchesStatus;
  });

  const deliveryTotalPages=Math.max(1,Math.ceil(filteredDelivery.length/DELIVERY_PAGE_SIZE));
  const currentDeliveryPage=Math.min(deliveryPage,deliveryTotalPages);
  const deliveryStart=(currentDeliveryPage-1)*DELIVERY_PAGE_SIZE;
  const paginatedDeliveries=filteredDelivery.slice(deliveryStart,deliveryStart+DELIVERY_PAGE_SIZE);

  const {filtered:filteredCustomers,totalPages:customerTotalPages,currentPage:currentCustomerPage,rows:paginatedCustomers} = customerPageData(customers,{search:customersSearch,type:customerTypeFilter,page:customerPage});

  const historyTotalPages=Math.max(1,Math.ceil((customerHistory?.rows.length || 0)/5));
  const currentHistoryPage=Math.min(historyPage,historyTotalPages);
  const historyRows=(customerHistory?.rows || []).slice((currentHistoryPage-1)*5,currentHistoryPage*5);

  const viewCustomerHistory=async(customer)=>{
    try {
      const rows=await apiRequest(`/orders/customer/${encodeURIComponent(customer.id)}/history`);
      setCustomerViewTab("profile");
      setHistoryPage(1);
      setCustomerHistory({customer,rows});
    }catch(err){showToast(err.message || "Failed to load order history.");}
  };
  function openAddCustomer() {
    setCustomerModal({ companyName: "", firstName: "", lastName: "", phone: "", address: "", customerType: "Residential", isNew: true });
  }
  function openEditCustomer(c) {
    setCustomerModal({ ...c, companyName:c.companyName || "", firstName:c.firstName || "", lastName:c.lastName || "", customerType:c.type, isNew: false });
  }
  const saveCustomer = async () => {
    if ((customerModal.customerType === "Commercial" && !customerModal.companyName?.trim()) || ![customerModal.firstName,customerModal.lastName,customerModal.phone,customerModal.address].every(value=>value?.trim()) || !["Residential","Commercial"].includes(customerModal.customerType)) {
      showToast("First Name, Last Name, Contact Number, Address and Customer Type are required. Commercial customers also require Company Name.");
      return;
    }
    try {
      if (customerModal.isNew) {
        await apiRequest("/customers", {
          method: "POST",
          body: JSON.stringify({
            companyName: customerModal.customerType === "Commercial" ? customerModal.companyName.trim() : null,
            firstName: customerModal.firstName.trim(),
            lastName: customerModal.lastName.trim(),
            phone: customerModal.phone.trim(),
            address: customerModal.address.trim(),
            customerType: customerModal.customerType,
          }),
        });
        showToast("Customer added.");
      } else {
        await apiRequest(`/customers/${customerModal.id}`, {
          method: "PUT",
          body: JSON.stringify({
            companyName: customerModal.customerType === "Commercial" ? customerModal.companyName.trim() : null,
            firstName: customerModal.firstName.trim(),
            lastName: customerModal.lastName.trim(),
            phone: customerModal.phone.trim(),
            address: customerModal.address.trim(),
            customerType: customerModal.customerType,
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
      setCustomers(previous=>previous.filter(c=>c.id!==customer.id));
      showToast(`Customer ${customer.name} permanently deleted.`);
      setConfirmDelete(null);
      loadAll();
    } catch (err) {
      showToast(err.message || "Failed to delete customer.");
    }
  };

  return (
    <PageLayout className="od-page">
      <PageHeader title="Order and Delivery" />

      {loadError && <p style={{ color: "#dc2626", fontWeight: 600 }}>{loadError}</p>}

      <div className="od-panel">
        <div className="od-panel-header">
        </div>

        <div className="od-tabs">
          {[
            { id: "pickup", label: "Pickup" },
            { id: "delivery", label: "Delivery" },
            { id: "customers", label: "Customers" },
          ].filter(t=>!isDriver || t.id==="delivery").map((t) => (
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
          <section className="od-delivery-section">
            <div className="od-filters">
              <div className="od-search-box">
                <input value={deliverySearch} onChange={(e) => {setDeliverySearch(e.target.value);setDeliveryPage(1);}} placeholder="Search delivery, order, customer or driver" />
              </div>
              <select value={deliveryStatusFilter} onChange={(e) => {setDeliveryStatusFilter(e.target.value);setDeliveryPage(1);}}>
                <option value="">Delivery Status</option>
                {["Preparing","Out for Delivery","Failed Attempt","Cancelled","Delivery Failed"].map(status=><option key={status}>{status}</option>)}
              </select>
            </div>

            <div className="od-delivery-card">
            <div className="od-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Delivery No.</th><th>Order ID</th><th>Customer</th><th>Driver</th><th>Delivery Status</th><th>Attempts</th><th>Payment Status</th><th>Delivery Address</th><th>Change Status</th><th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedDeliveries.map((d) => (
                    <tr key={d.orderId}>
                      <td className="od-delivery-reference">{d.drNo || "-"}</td><td className="od-delivery-reference">{d.id}</td><td>{d.customerName || "-"}</td>
                      <td>{d.deliveryRiderName || "Unassigned"}</td>
                      <td><Badge text={d.deliveryStatus} map={deliveryStatusClass} /></td>
                      <td>Attempt {d.attempts}/{d.maxAttempts}{Number(d.attempts)>=Number(d.maxAttempts)?" - Final":""}{d.nextAttemptAt && <small className="od-retry-date">Next: {d.nextAttemptAt}</small>}</td>
                      <td><Badge text={d.paymentStatus} map={paymentStatusClass} /></td><td className="od-delivery-address">{d.deliveryAddress}</td>
                      <td><div className="od-workflow-actions">
                        {!isDriver && ["Preparing","Failed Attempt"].includes(d.deliveryStatus) && Number(d.attempts)<Number(d.maxAttempts) && <button className="od-btn od-btn-primary" disabled={deliveryBusy} title={d.deliveryRiderId?"Dispatch assigned delivery":"Assign a driver using the view icon before dispatching"} onClick={()=>dispatchDelivery(d)}>Dispatch</button>}{!isDriver && ["Preparing","Failed Attempt"].includes(d.deliveryStatus) && !d.deliveryRiderId && <small className="od-driver-hint">Driver required</small>}
                        {["Out for Delivery","Failed Attempt"].includes(d.deliveryStatus) && <button className="od-btn od-btn-primary" onClick={()=>setPickupModal({kind:"complete",order:d})}>Confirm Delivery</button>}
                        {d.deliveryStatus==="Out for Delivery" && <button className="od-btn od-btn-outline" onClick={()=>askDeliveryAction(d,"fail")}>Log Failed Attempt</button>}
                        {!isDriver && d.canSettle && <button className="od-btn od-btn-outline" onClick={()=>setPickupModal({kind:"settle",order:d})}>Restock &amp; Settle</button>}
                      </div></td>
                      <td>{!isDriver && <div className="od-actions od-delivery-actions">
                        <button className="od-action-btn od-act-view" onClick={()=>openOrder(d)} title="View/Edit"><IconView /></button>
                        <button className="od-action-btn od-act-print" onClick={async()=>{try{printOrderReceipt(await apiRequest(`/orders/${d.orderId}`));}catch(err){showToast(err.message);}}} title="Print"><IconPrint /></button>
                        <button className="od-action-btn od-act-delete" disabled={!["Preparing","Failed Attempt"].includes(d.deliveryStatus)||d.paymentStatus==="Paid"} onClick={()=>setConfirmDelete({kind:"order",order:d})} title="Delete / Cancel"><IconDelete /></button>
                      </div>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredDelivery.length === 0 && <p className="od-empty-state">{isLoading?"Loading deliveries...":"No delivery orders match your search."}</p>}
            </div>
            <Pagination currentPage={currentDeliveryPage} totalPages={deliveryTotalPages} onPageChange={setDeliveryPage} />
            </div>
          </section>
        )}

        {tab === "customers" && (
          <section className="od-customer-section">
            <div className="od-filters">
              <div className="od-search-box">
                <input value={customersSearch} onChange={(e) => {setCustomersSearch(e.target.value);setCustomerPage(1);}} placeholder="Search Customer" />
              </div>
              <select aria-label="Customer Type filter" value={customerTypeFilter} onChange={e=>{setCustomerTypeFilter(e.target.value);setCustomerPage(1);}}><option value="">All Customer Types</option><option>Residential</option><option>Commercial</option></select>
              <button className="od-btn od-btn-primary od-add-customer" onClick={openAddCustomer}>
                + Add Customer
              </button>
            </div>

            <div className="od-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Customer ID</th><th>Customer Type</th><th>Customer Name</th><th>Contact Number</th>
                    <th>Address</th><th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedCustomers.map((c) => (
                    <tr key={c.id}>
                      <td className="od-customer-id">{c.id}</td>
                      <td><Badge text={c.type} map={{Residential:"od-badge-blue",Commercial:"od-badge-green"}} /></td>
                      <td className="od-customer-name">{c.name}</td>
                      <td>{c.phone || "\u2014"}</td>
                      <td className="od-customer-address">{c.address || "\u2014"}</td>
                      <td>
                        <div className="od-actions">
                          <button type="button" className="od-action-btn od-act-view" title="View Profile & Order History" aria-label={`View profile and order history for ${c.name}`} onClick={()=>viewCustomerHistory(c)}><IconView /></button>
                          <button className="od-action-btn od-act-edit" onClick={() => openEditCustomer(c)} title="Edit">
                            <IconEdit />
                          </button>
                          <button
                            className="od-action-btn od-act-delete"
                            onClick={() => setConfirmDelete({ kind: "customer", customer: c })}
                            title="Delete"
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
            <div className="od-customer-footer"><span>{filteredCustomers.length ? `Showing ${(currentCustomerPage-1)*10+1}\u2013${Math.min(currentCustomerPage*10,filteredCustomers.length)} of ${filteredCustomers.length} customers` : "0 customers"}</span><Pagination currentPage={currentCustomerPage} totalPages={customerTotalPages} onPageChange={setCustomerPage} /></div>
          </section>
        )}
      </div>

      {customerHistory && (
        <div className="od-modal-overlay open" onClick={e=>e.target===e.currentTarget && setCustomerHistory(null)}>
          <div className="od-modal od-customer-view" role="dialog" aria-modal="true" aria-labelledby="customer-view-title">
            <div className="od-customer-view-header">
              <div><h3 id="customer-view-title">View Customer</h3><p>{customerHistory.customer.name}</p></div>
              <button type="button" className="od-customer-view-close" aria-label="Close View Customer" title="Close" onClick={()=>setCustomerHistory(null)}><X size={20} aria-hidden="true" /></button>
            </div>
            <div className="od-customer-view-tabs" role="tablist" aria-label="Customer details">
              {[{id:"profile",label:"Customer Profile"},{id:"history",label:"Order History"}].map(item=>(
                <button key={item.id} type="button" role="tab" id={`customer-${item.id}-tab`} aria-selected={customerViewTab===item.id} aria-controls={`customer-${item.id}-panel`} tabIndex={customerViewTab===item.id?0:-1} className={customerViewTab===item.id?"active":""} onClick={()=>setCustomerViewTab(item.id)} onKeyDown={e=>{if(["ArrowLeft","ArrowRight","Home","End"].includes(e.key)){e.preventDefault();const next=e.key==="Home"?"profile":e.key==="End"?"history":customerViewTab==="profile"?"history":"profile";setCustomerViewTab(next);document.getElementById(`customer-${next}-tab`)?.focus();}}}>{item.label}{item.id==="history" && <span>{customerHistory.rows.length}</span>}</button>
              ))}
            </div>
            {customerViewTab==="profile" ? (
              <div role="tabpanel" id="customer-profile-panel" aria-labelledby="customer-profile-tab" tabIndex={0}>
                <dl className="od-customer-profile">
                  {[['Customer ID',customerHistory.customer.id],['Customer Type',customerHistory.customer.type],...(customerHistory.customer.type === 'Commercial' ? [['Company Name',customerHistory.customer.companyName],['Contact Person',`${customerHistory.customer.firstName || ''} ${customerHistory.customer.lastName || ''}`]] : []),['First Name',customerHistory.customer.firstName],['Last Name',customerHistory.customer.lastName],['Contact Number',customerHistory.customer.phone],['Address',customerHistory.customer.address]].map(([label,value])=>(
                    <div key={label} className={label==="Address"?"od-profile-address":""}><dt>{label}</dt><dd>{value || "?"}</dd></div>
                  ))}
                </dl>
              </div>
            ) : (
              <div role="tabpanel" id="customer-history-panel" aria-labelledby="customer-history-tab" tabIndex={0}>
                <div className="od-table-wrap od-customer-history-table"><table>
                  <thead><tr><th>Order ID</th><th>Type</th><th>Status</th><th>Date</th><th>Total</th><th>Settlement</th><th>Net Refund</th><th>Actions</th></tr></thead>
                  <tbody>{historyRows.map(order=><tr key={order.orderId}>
                    <td>{order.id}</td><td>{order.type}</td><td>{order.status}</td><td>{new Date(order.date).toLocaleDateString("en-PH")}</td><td>{peso(order.totalAmount)}</td><td>{order.settledAt ? "Settled" : "N/A"}</td><td>{order.settledAt ? peso(order.netRefundAmount) : "N/A"}</td>
                    <td><div className="od-actions">
                      <button type="button" className="od-action-btn od-act-view" title="View Order" aria-label={`View ${order.id}`} onClick={async()=>{try{const full=await apiRequest(`/orders/${order.orderId}`);if(full.type==="Delivery")setOrderModal({...full,fromCustomerHistory:true});else setPickupModal({kind:"view",order:full});}catch(err){showToast(err.message);}}}><IconView /></button>
                      <button type="button" className="od-action-btn od-act-print" title="Print Receipt" aria-label={`Print receipt for ${order.id}`} onClick={async()=>{try{printOrderReceipt(await apiRequest(`/orders/${order.orderId}`));}catch(err){showToast(err.message || "Failed to print receipt.");}}}><IconPrint /></button>
                    </div></td>
                  </tr>)}</tbody>
                </table>{!customerHistory.rows.length && <p className="od-empty-state">No orders recorded for this customer.</p>}</div>
                <div className="od-customer-footer"><span>{customerHistory.rows.length ? `Showing ${(currentHistoryPage-1)*5+1}\u2013${Math.min(currentHistoryPage*5,customerHistory.rows.length)} of ${customerHistory.rows.length} orders` : "0 orders"}</span><Pagination currentPage={currentHistoryPage} totalPages={historyTotalPages} onPageChange={setHistoryPage} /></div>
              </div>
            )}
          </div>
        </div>
      )}

      {orderModal && (
        <div className="od-modal-overlay open" onClick={(e) => e.target === e.currentTarget && setOrderModal(null)}>
          <div className="od-modal">
            {orderModal.fromCustomerHistory ? (
              <div className="od-customer-view-header">
                <h3>Order Details &mdash; {orderModal.id}</h3>
                <button type="button" className="od-customer-view-close" aria-label="Close Order Details" title="Close" onClick={()=>setOrderModal(null)}><X size={20} aria-hidden="true" /></button>
              </div>
            ) : <h3>Order Details &mdash; {orderModal.id}</h3>}
            <Field label="Order Type"><input readOnly value={orderModal.type} /></Field>
            <Field label="Date"><input readOnly value={orderModal.date || ""} /></Field>
            <Field label="Order Status"><input readOnly value={orderModal.status} /></Field>
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
            <Field label="Payment Method"><input readOnly value={orderModal.paymentMethod || ""} /></Field>
            <Field label="Payment Status"><input readOnly value={orderModal.paymentStatus || "Unpaid"} /></Field>
            <Field label="Delivery No."><input readOnly value={orderModal.drNo || ""} /></Field>
            <Field label="Delivery Status"><input readOnly value={orderModal.deliveryStatus || ""} /></Field>
            <Field label="Delivery Address"><input readOnly value={orderModal.deliveryAddress || ""} /></Field>
            <Field label="Assigned Delivery Driver"><select disabled={orderModal.fromCustomerHistory || ["Delivered","Cancelled","Delivery Failed"].includes(orderModal.deliveryStatus)} value={orderModal.deliveryRiderId || ""} onChange={e=>setOrderModal({...orderModal,deliveryRiderId:e.target.value})}><option value="">Unassigned</option>{drivers.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
            <Field label="Notes"><textarea disabled={orderModal.fromCustomerHistory || ["Delivered","Cancelled","Delivery Failed"].includes(orderModal.deliveryStatus)} maxLength={255} value={orderModal.deliveryNotes || ""} onChange={e=>setOrderModal({...orderModal,deliveryNotes:e.target.value})} /></Field>
            {!orderModal.fromCustomerHistory && <div className="od-modal-actions">
              <button className="od-btn od-btn-outline" onClick={() => setOrderModal(null)}>Cancel</button>
              <button className="od-btn od-btn-primary" onClick={saveOrder} disabled={isSavingOrder||["Delivered","Cancelled","Delivery Failed"].includes(orderModal.deliveryStatus)}>
                {isSavingOrder ? "Saving..." : "Save"}
              </button>
            </div>}
          </div>
        </div>
      )}

      {pickupModal?.kind === "complete" && <PickupClaimModal key={pickupModal.order.orderId} order={pickupModal.order} onClose={()=>setPickupModal(null)} onCompleted={()=>{setPickupModal(null);showToast(pickupModal.order.type==="Delivery"?(pickupModal.order.paymentMethod==="Cash on Delivery"?"Delivery confirmed. Payment status: Paid.":"Delivery confirmed."):"Pickup claim completed.");loadAll();}} />}

      {pickupModal?.kind === "settle" && <PickupSettlementModal key={pickupModal.order.orderId} order={pickupModal.order} onClose={()=>setPickupModal(null)} onSettled={()=>{setPickupModal(null);showToast(pickupModal.order.type === "Delivery" ? "Delivery settled and moved to customer order history." : "Pickup settled and inventory restored.");loadAll();}} />}

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

      {deliveryAction && <div className="od-modal-overlay open"><div className="od-modal od-modal-sm" role="dialog" aria-modal="true" aria-labelledby="delivery-action-title">
        <h3 id="delivery-action-title">Log Failed Attempt</h3><p>{deliveryAction.order.id}</p>
        {deliveryAction.error && <p className="od-action-error" role="alert">{deliveryAction.error}</p>}
        {deliveryAction.action==="fail" && <>
          <Field label="Reason for Failed Attempt"><select required disabled={deliveryBusy} value={deliveryAction.reason} onChange={e=>setDeliveryAction({...deliveryAction,reason:e.target.value})}><option value="">Select a reason</option>{FAILED_ATTEMPT_REASONS.map(reason=><option key={reason} value={reason}>{reason}</option>)}</select></Field>
          <Field label={deliveryAction.reason==="Other (Specify in Notes)"?"Attempt details / notes (required)":"Attempt details / notes (optional)"}><textarea disabled={deliveryBusy} maxLength={2000} placeholder={deliveryAction.reason==="Other (Specify in Notes)"?"Specify the reason for the failed attempt":"Enter attempt details / notes"} value={deliveryAction.notes} onChange={e=>setDeliveryAction({...deliveryAction,notes:e.target.value})} /></Field>
        </>}
        <div className="od-modal-actions"><button className="od-btn od-btn-outline" disabled={deliveryBusy} onClick={()=>setDeliveryAction(null)}>Cancel</button><button className="od-btn od-btn-primary" disabled={deliveryBusy} onClick={runDeliveryAction}>{deliveryBusy?"Saving...":"Log Failed Attempt"}</button></div>
      </div></div>}


      {customerModal && (
        <div className="od-modal-overlay open" onClick={(e) => e.target === e.currentTarget && setCustomerModal(null)}>
          <div className="od-modal od-modal-sm">
            <h3>{customerModal.isNew ? "Add Customer" : "Edit Customer"}</h3>
            <Field label="Customer ID"><input disabled value={customerModal.id || "Auto-generated (CUST-001)"} /></Field>
              <Field label="Customer Type">
                <select
                  value={customerModal.customerType}
                  onChange={(e) => setCustomerModal({ ...customerModal, customerType: e.target.value })}
                >
                  <option>Residential</option>
                  <option>Commercial</option>
                </select>
              </Field>
            {customerModal.customerType === "Commercial" && <>
              <Field label="Company Name"><input required maxLength={150} value={customerModal.companyName || ""} onChange={e=>setCustomerModal({...customerModal,companyName:e.target.value})} /></Field>
              <h4>Contact Person</h4>
            </>}
            <Field label="First Name"><input required maxLength={75} value={customerModal.firstName} onChange={e=>setCustomerModal({...customerModal,firstName:e.target.value})} /></Field>
            <Field label="Last Name"><input required maxLength={75} value={customerModal.lastName} onChange={e=>setCustomerModal({...customerModal,lastName:e.target.value})} /></Field>
            <Field label="Contact Number">
              <input required maxLength={30} value={customerModal.phone} onChange={(e) => setCustomerModal({ ...customerModal, phone: e.target.value })} placeholder="Phone Number" />
            </Field>
            <Field label="Address">
              <textarea required maxLength={255} value={customerModal.address} onChange={(e) => setCustomerModal({ ...customerModal, address: e.target.value })} placeholder="Street, Brgy, City, Province, Zip Code" />
            </Field>

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
            <h3>{confirmDelete.kind === "order" ? "Cancel order?" : "Permanently delete customer?"}</h3>
            <p>
              {confirmDelete.kind === "order"
                ? `This will cancel order ${confirmDelete.order.id} and restore its stock. This cannot be undone.`
                : `This will permanently delete ${confirmDelete.customer.name}. Transaction history will be preserved. This cannot be undone.`}
            </p>
            <div className="od-modal-actions">
              <button className="od-btn od-btn-outline" onClick={() => setConfirmDelete(null)}>Back</button>
              <button
                className="od-btn od-btn-danger"
                onClick={() =>
                  confirmDelete.kind === "order" ? deleteOrder(confirmDelete.order) : deleteCustomer(confirmDelete.customer)
                }
              >
                {confirmDelete.kind === "order" ? "Cancel Order" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      {toastMsg && <div className="od-toast show">{toastMsg}</div>}
    </PageLayout>
  );
}



