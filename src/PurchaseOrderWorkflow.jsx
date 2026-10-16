import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Eye, Send, Check, X, Truck, PackageCheck, CreditCard, ReceiptText, FileText } from 'lucide-react';
import Pagination from './Pagination';
import InventoryItemSelector from './InventoryItemSelector';
import { apiRequest } from './api';
const money = n => `₱ ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
function Modal({title,close,children,busy,className = ''}) { return <div className="po-history-modal-overlay"><div className={`po-history-modal-card ${className}`} role="dialog" aria-modal="true" aria-label={title}><div className="po-history-modal-header"><h3>{title}</h3><button type="button" disabled={busy} className="po-history-close-btn po-modal-x" aria-label="Close modal" title="Close" onClick={close}><X size={20} aria-hidden="true" /></button></div>{children}</div></div>; }
function POActionButton({label, icon: Icon, tone = 'view', disabled, onClick}) {
  return <button type="button" className={`po-icon-action po-icon-action-${tone}`} title={label} aria-label={label} disabled={disabled} onClick={onClick}><Icon size={18} strokeWidth={1.8} aria-hidden="true" /></button>;
}
function DocumentModal({onClose, children, title = 'Purchase Order Document', compact = false, busy = false}) {
  const dialogRef = useRef(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return createPortal(<dialog ref={dialogRef} className={`po-document-dialog${compact ? ' po-workflow-dialog' : ''}`} aria-labelledby="po-document-title" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <div className="po-history-modal-header"><h3 id="po-document-title">{title}</h3><button type="button" className="po-history-close-btn po-modal-x" disabled={busy} aria-label="Close modal" title="Close" onClick={onClose} autoFocus><X size={20} aria-hidden="true" /></button></div>
    {children}
  </dialog>, document.body);
}
function PurchaseOrderDocument({supplier, warehouse, items, paymentMethod, referenceNo, orderId, paymentReceipt = false, onReady}) {
  const [pdfUrl, setPdfUrl] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true, objectUrl;
    const request = orderId
      ? apiRequest(`/purchase-orders/${orderId}/${paymentReceipt ? 'payment-document' : 'document'}`, {responseType: 'blob'})
      : apiRequest('/purchase-orders/document-preview', {method: 'POST', responseType: 'blob', body: JSON.stringify({supplierId: supplier?.id, warehouseId: warehouse?.id, items, paymentMethod, referenceNo})});
    request.then(blob => {
      if (!active) return;
      objectUrl = URL.createObjectURL(blob);
      setPdfUrl(objectUrl);
      onReady?.(true);
    }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [supplier, warehouse, items, paymentMethod, referenceNo, orderId, paymentReceipt, onReady]);
  if (error) return <p role="alert" className="po-error">{error}</p>;
  if (!pdfUrl) return <p role="status">Preparing PDF document...</p>;
  return <div className="po-pdf-preview"><a className="po-history-view-btn" href={pdfUrl} download={paymentReceipt ? 'payment-acknowledgment.pdf' : 'purchase-order.pdf'}>Download PDF</a><object data={pdfUrl} type="application/pdf" aria-label="Purchase order PDF preview"><p>Use Download PDF to view the document on your device.</p></object></div>;
}
export function POCreationModal({draft,onClose,onSaved}) {
  const [options,setOptions]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [warehouseId,setWarehouse]=useState('');
  const [items,setItems]=useState(draft.items),[savedId,setSavedId]=useState(null);
  const [showDocument,setShowDocument]=useState(false);
  const [supplierId,setSupplierId]=useState(draft.supplierId || '');
  const requestKey=useRef(crypto.randomUUID()), submitting=useRef(false);
  useEffect(()=>{apiRequest('/purchase-orders/options').then(data => {
    setOptions(data);
    setItems(previous => previous.map(item => {
      const product = data.products.find(p => p.productId === item.productId);
      return product ? { ...item, category: product.category, brand: product.brand,
        weight: `${Number(product.unitValue)} ${product.unit}`, unitCost: Number(product.unitCost) } : item;
    }));
  }).catch(e=>setError(e.message));},[]);
  const business=options?.business, supplier=options?.suppliers.find(s=>s.id===supplierId);
  const incomplete=!business||['name','address','email','phone'].some(k=>!String(business[k]||'').trim());
  async function submit(e) {
    e.preventDefault();if(submitting.current)return;submitting.current=true;setBusy(true);setError('');
    try {
      if(savedId) {await apiRequest(`/purchase-orders/${savedId}/send`,{method:'PUT'});onSaved();return;}
      const result=await apiRequest('/purchase-orders',{method:'POST',body:JSON.stringify({supplierId,restockIds:draft.items.flatMap((item,index)=>supplierId===draft.supplierId && items.some(i=>i.productId===item.productId) && draft.restockIds[index] ? [draft.restockIds[index]] : []),warehouseId,items,requestKey:requestKey.current})});
      if(result.emailError){setSavedId(result.id);setError(result.emailError);return;}
      onSaved();
    } catch(e){setError(e.message);} finally {submitting.current=false;setBusy(false);}
  }
  return (
    <Modal title="Create Purchase Order" close={onClose} busy={busy}>
      <form className="po-create-form" onSubmit={submit}>
        <p className="po-form-intro">Choose your supplier, delivery destination and items to prepare a purchase order.</p>
        {error && <p role="alert" className="po-form-notice po-error">{error}</p>}
        {!options ? <p className="po-form-notice">Loading business and supplier details?</p> : <>
          <section className="po-form-section">
            <div className="po-section-heading"><h4>Purchasing Business</h4><span>From your business profile</span></div>
            <div className="po-form-grid">
              {[['name', 'Business Name'], ['address', 'Business Address'], ['email', 'Email Address'], ['phone', 'Phone Number']].map(([key, label]) => (
                <label className="po-field" key={key}>{label}<input readOnly value={business?.[key] || ''} placeholder="Not provided" /></label>
              ))}
            </div>
            {incomplete && <p role="alert" className="po-form-notice po-error">Update your business profile in Settings with name, address, email and phone before submitting.</p>}
          </section>

          <section className="po-form-section">
            <div className="po-section-heading"><h4>Supplier & Delivery</h4><span>Required</span></div>
            <div className="po-form-grid">
              <label className="po-field">Supplier <span className="po-required">*</span>
                <select required disabled={!!savedId || busy} value={supplierId} onChange={e => { setSupplierId(e.target.value); setItems([]); }}>
                  <option value="">Select supplier</option>
                  {options.suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </label>
              <label className="po-field">Destination Warehouse <span className="po-required">*</span>
                <select required disabled={!!savedId || busy} value={warehouseId} onChange={e => setWarehouse(e.target.value)}>
                  <option value="">Select active warehouse</option>
                  {options.warehouses.map(w => <option key={w.id} value={w.id}>{w.name} ? {w.address}</option>)}
                </select>
              </label>
            </div>
            {supplier && <dl className="po-supplier-contact">
              <div><dt>Email</dt><dd>{supplier.email || 'Email missing'}</dd></div>
              <div><dt>Phone</dt><dd>{supplier.phone || 'Not provided'}</dd></div>
              <div><dt>Address</dt><dd>{supplier.address || 'Not provided'}</dd></div>
            </dl>}
          </section>

          <section className="po-form-section">
            <div className="po-section-heading">
              <h4>Order Items</h4>
              <button type="button" className="po-add-item-btn" disabled={!supplierId || !!savedId || busy} onClick={() => setItems(previous => [...previous, { productId: '', productName: '', category: '', brand: '', weight: '', qty: 1, unitCost: 0 }])}>Add Item</button>
            </div>
            {!supplierId && <p className="po-form-intro">Select a supplier to add items.</p>}
            <fieldset className="po-item-fields" disabled={!!savedId || busy}>
              <div className="po-create-table-scroll">
                <table className="po-history-items-table po-create-items po-selection-table">
                  <thead><tr><th>#</th><th>Category</th><th>Brand</th><th>Unit Value</th><th>Product</th><th>Cost Price</th><th>Quantity</th><th>Action</th></tr></thead>
                  <tbody>
                    {!items.length && <tr><td colSpan={8} className="po-create-empty">No items added yet.<span>Click Add Item to select a category, brand and product.</span></td></tr>}
                    {items.map((item, index) => <tr key={index}>
                      <td>{index + 1}</td>
                      <InventoryItemSelector
                        allowAmbiguousProductSelection
                        products={options.products.filter(p => p.supplierId === supplierId && (p.productId === item.productId || !items.some((row, rowIndex) => rowIndex !== index && row.productId === p.productId)))}
                        item={item}
                        rowNumber={index + 1}
                        onChange={next => {
                          const product = options.products.find(p => p.productId === next.productId && p.supplierId === supplierId);
                          setItems(previous => previous.map((row, rowIndex) => rowIndex === index ? {
                            ...next, productName: product?.productName || '', unitCost: Number(product?.unitCost || 0), qty: 1,
                          } : row));
                        }}
                      />
                      <td>{item.productId ? money(item.unitCost) : '-'}</td>
                      <td><input aria-label={`Quantity for item ${index + 1}`} type="number" min="1" step="1" required disabled={!item.productId} value={item.qty} onChange={e => setItems(prev => prev.map((it, j) => j === index ? { ...it, qty: Number(e.target.value) } : it))} /></td>
                      <td><button type="button" className="po-remove-item-btn" onClick={() => setItems(prev => prev.filter((_, rowIndex) => rowIndex !== index))}>Remove</button></td>
                    </tr>)}
                  </tbody>
                </table>
              </div>
            </fieldset>
          </section>

            <section className="po-form-section po-order-summary">
              <div className="po-section-heading"><h4>Order Summary</h4></div>
              <dl><div><dt>Total Items</dt><dd>{new Set(items.filter(i => i.productId).map(i => i.productId)).size}</dd></div><div><dt>Total Quantity</dt><dd>{items.reduce((n, i) => n + (i.productId ? i.qty : 0), 0)}</dd></div></dl>
            </section>
          <div className="po-document-button-row"><button type="button" className="po-history-view-btn po-view-order-btn" aria-haspopup="dialog" onClick={() => setShowDocument(true)}><FileText size={18} aria-hidden="true" /><span>View Purchase Order</span></button></div>
          {showDocument && <DocumentModal onClose={() => setShowDocument(false)}><p className="po-form-notice">Preview of the supplier document. The purchase order number and issue date are assigned when the order is created.</p><PurchaseOrderDocument orderId={savedId} supplier={supplier} warehouse={options.warehouses.find(w => w.id === warehouseId)} items={items} /></DocumentModal>}
          {savedId && <p className="po-form-notice">Saved as Pending. You can also retry Send from the Purchase Order table.</p>}
          <footer className="po-form-footer">
            <button type="button" className="po-history-close-btn" disabled={busy} onClick={onClose}>Cancel</button>
            <button className="po-btn-confirm" disabled={busy || incomplete || !warehouseId || !supplier?.email || !items.length || items.some(item => !item.productId)}>{busy ? 'Sending?' : savedId ? 'Retry Send' : 'Create & Send Purchase Order'}</button>
          </footer>
        </>}
      </form>
    </Modal>
  );
}

function POPaymentWorkflow({po, onClose, onRefresh}) {
  const initialStep = po.status === 'Sent' ? 0 : po.paymentRecorded ? 2 : 1;
  const [step,setStep]=useState(initialStep),[unlocked,setUnlocked]=useState(initialStep);
  const [paymentMethod,setPaymentMethod]=useState('GCash'),[referenceNo,setReferenceNo]=useState(''),[amountPaid,setAmountPaid]=useState('');
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[pdfReady,setPdfReady]=useState(false);
  const [recipient,setRecipient]=useState('');
  const submitting=useRef(false);
  const closeRef=useRef(onClose);
  useEffect(()=>{
    let active=true;
    apiRequest(`/purchase-orders/${po.id}`).then(details=>{
      if (!active) return;
      if (details.PaymentEmailSentAt) { closeRef.current(); return; }
      setRecipient(details.SupplierEmail || '');
      if (details.PaymentMethod && details.PaymentReference) {
        setPaymentMethod(details.PaymentMethod); setReferenceNo(details.PaymentReference); setAmountPaid(details.AmountPaid ?? '');
      }
    }).catch(e=>{if(active)setError(e.message);});
    return ()=>{active=false;};
  },[po.id]);
  async function save(action) {
    if(submitting.current)return;
    submitting.current=true;setBusy(true);setError('');
    try {
      await apiRequest(`/purchase-orders/${po.id}/${action}`,{method:'PUT',...(action==='payment'?{body:JSON.stringify({paymentMethod,referenceNo,amountPaid:Number(amountPaid)})}:{})});
      if(action==='confirm'){setUnlocked(1);setStep(1);}
      if(action==='payment'){setUnlocked(2);setStep(2);}
      onRefresh();
      if(action==='send-payment') onClose();
    }catch(e){setError(e.message);}finally{submitting.current=false;setBusy(false);}
  }
  function editPayment(setValue, value) { setValue(value); setUnlocked(1); setPdfReady(false); }
  const tabs=['Confirm','Payment','Document'];
  return <DocumentModal title="Supplier Confirmation & Payment" compact busy={busy} onClose={onClose}>
    <p className="po-workflow-context">{po.poNo || po.id} | {po.supplier}</p>
    <div className="po-workflow-tabs" role="tablist" aria-label="Purchase order payment steps">{tabs.map((label,index)=><button key={label} type="button" role="tab" id={`po-step-${index}`} aria-controls={`po-step-panel-${index}`} aria-selected={step===index} disabled={busy||index>unlocked} onClick={()=>setStep(index)}><span>{index+1}</span>{label}</button>)}</div>
    {error&&<p role="alert" className="po-error">{error}</p>}
    <div role="tabpanel" id={`po-step-panel-${step}`} aria-labelledby={`po-step-${step}`} className="po-workflow-panel">
      {step===0&&<><h4>Confirm supplier acceptance</h4><p>{unlocked>0?'Supplier acceptance has been confirmed.':`Has ${po.supplier} accepted this purchase order?`}</p><footer className="po-form-footer"><button type="button" className="po-history-close-btn" disabled={busy} onClick={onClose}>Close</button><button type="button" className="po-btn-confirm" disabled={busy} onClick={()=>unlocked>0?setStep(1):save('confirm')}>{busy?'Saving...':unlocked>0?'Next':'Confirm & Next'}</button></footer></>}
      {step===1&&<form className="po-payment-form" onSubmit={event=>{event.preventDefault();save('payment');}}>
        <div className="po-payment-heading"><div><h4>Payment Details</h4><p className="po-form-intro">Enter the amount and reference for the payment made.</p></div><div className="po-payment-order-amount"><span>Order amount</span><strong>{money(po.totalAmount)}</strong></div></div>
        <div className="po-workflow-fields">
          <label className="po-field" htmlFor="po-payment-method">Mode of Payment<select id="po-payment-method" required disabled={busy} value={paymentMethod} onChange={event=>editPayment(setPaymentMethod,event.target.value)}>{['GCash','Card','Bank Transfer'].map(method=><option key={method}>{method}</option>)}</select></label>
          <label className="po-field" htmlFor="po-amount-paid">Amount Paid (PHP)<input id="po-amount-paid" required type="number" inputMode="decimal" min="0.01" max="9999999999.99" step="0.01" disabled={busy} value={amountPaid} onChange={event=>editPayment(setAmountPaid,event.target.value)} placeholder="Enter amount paid" /></label>
          <label className="po-field po-payment-reference" htmlFor="po-payment-reference">Reference No.<input id="po-payment-reference" required maxLength={100} disabled={busy} value={referenceNo} onChange={event=>editPayment(setReferenceNo,event.target.value)} placeholder="Enter transaction reference number" /></label>
        </div>
        {unlocked===2&&<p className="po-form-intro">Payment details saved. You can edit them before sending.</p>}
        <footer className="po-form-footer"><button type="button" className="po-history-close-btn" disabled={busy} onClick={()=>setStep(0)}>Back</button>{unlocked===2?<button type="button" className="po-btn-confirm" onClick={()=>setStep(2)}>View Document</button>:<button className="po-btn-confirm" disabled={busy||!referenceNo.trim()||!amountPaid||Number(amountPaid)<=0}>{busy?'Saving...':'Save & Preview'}</button>}</footer>
      </form>}
      {step===2&&<><p className="po-form-intro">Review the payment PDF before emailing it to <strong>{recipient || 'the supplier?s saved email'}</strong>.</p><PurchaseOrderDocument orderId={po.id} paymentReceipt onReady={setPdfReady} /><footer className="po-form-footer"><button type="button" className="po-history-close-btn" disabled={busy} onClick={()=>setStep(1)}>Back</button><button type="button" className="po-btn-confirm" disabled={busy||!pdfReady||!recipient} onClick={()=>save('send-payment')}>{busy?'Sending...':'Send to Supplier'}</button></footer></>}
    </div>
  </DocumentModal>;
}

export function POTable({orders,loading,onRefresh}) {
  const [page,setPage]=useState(1),[details,setDetails]=useState(null),[receiving,setReceiving]=useState(false),[showDocument,setShowDocument]=useState(false),[quantities,setQuantities]=useState({}),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [workflow,setWorkflow]=useState(null),[declining,setDeclining]=useState(null),[paymentPreview,setPaymentPreview]=useState(null),[showDelivery,setShowDelivery]=useState(false);
  function openPayment(po) { if(po.paymentEmailSentAt) return; setError(''); setWorkflow(po); }
  const submitting=useRef(false),receiptKey=useRef(null);const pages=Math.max(1,Math.ceil(orders.length/5)),current=Math.min(page,pages);
  async function view(id,receive=false){setBusy(true);setError('');try{const po=await apiRequest(`/purchase-orders/${id}`);setDetails(po);setShowDelivery(false);setShowDocument(false);setReceiving(receive);receiptKey.current=crypto.randomUUID();setQuantities(Object.fromEntries(po.items.map(i=>[i.productId,Number(i.qty)-Number(i.receivedQty)])));}catch(e){setError(e.message);}finally{setBusy(false);}}
  async function transition(po,action){const prompts={reject:'Confirm the supplier has declined this purchase order? This will mark it as Rejected.',confirm:'Confirm the supplier has accepted this PO?',dispatch:'Confirm the supplier has dispatched this PO?',send:'Send this PO to the supplier’s saved email?'};if(action!=='reject'&&!window.confirm(prompts[action]))return;if(submitting.current)return;submitting.current=true;setBusy(true);setError('');try{await apiRequest(`/purchase-orders/${po.id}/${action}`,{method:'PUT'});if(action==='reject')setDeclining(null);onRefresh();}catch(e){setError(e.message);}finally{submitting.current=false;setBusy(false);}}
  async function receive(e){e.preventDefault();if(submitting.current)return;submitting.current=true;setBusy(true);setError('');try{const result=await apiRequest(`/purchase-orders/${details.PurchaseOrderID}/receive`,{method:'PUT',body:JSON.stringify({requestKey:receiptKey.current,items:details.items.map(i=>({productId:i.productId,qty:quantities[i.productId]}))})});setDetails(null);onRefresh();if(result.status!=='Received')setError(result.message);}catch(e){setError(e.message);}finally{submitting.current=false;setBusy(false);}}
  return <>{error&&<p role="alert" className="po-error">{error}</p>}<div className="restocking-table-wrap"><div className="paginated-table-scroll"><table className="restocking-table po-orders-table"><thead><tr>{['Purchase Order ID','Supplier Name','Date','Total Items','Quantity','Total Amount','Status','Actions'].map(c=><th key={c}>{c}</th>)}</tr></thead><tbody>{loading?<tr><td colSpan={8}>Loading…</td></tr>:!orders.length?<tr><td colSpan={8} className="po-orders-empty">No purchase orders yet.</td></tr>:orders.slice((current-1)*5,current*5).map(po=><tr key={po.id}><td>{po.poNo||po.id}</td><td>{po.supplier}</td><td>{new Date(po.orderDate).toLocaleDateString()}</td><td>{po.itemCount}</td><td>{po.totalQty}</td><td>{money(po.totalAmount)}</td><td><span className={`po-history-status-pill ${po.status.toLowerCase().replaceAll(' ','-')}`}>{po.status}</span></td><td><div className="po-action-buttons">
  <POActionButton label="View purchase order" icon={Eye} disabled={busy} onClick={()=>view(po.id)} />
  {po.status==='Pending'&&<POActionButton label="Send to supplier" icon={Send} tone="send" disabled={busy} onClick={()=>transition(po,'send')} />}
  {po.status==='Sent'&&<><POActionButton label="Approve purchase order" icon={Check} tone="approve" disabled={busy} onClick={()=>openPayment(po)} /><POActionButton label="Declined by supplier" icon={X} tone="reject" disabled={busy} onClick={()=>{setError('');setDeclining(po);}} /></>}
  {po.status==='Approved'&&!po.paymentEmailSentAt&&!po.paymentRecorded&&<POActionButton label="Record payment" icon={CreditCard} tone="approve" disabled={busy} onClick={()=>openPayment(po)} />}
  {['Approved','Paid','Out for Delivery','Received'].includes(po.status)&&!po.paymentEmailSentAt&&!!po.paymentRecorded&&<POActionButton label="View payment document" icon={ReceiptText} tone="approve" disabled={busy} onClick={()=>openPayment(po)} />}
  {po.status==='Paid'&&<POActionButton label="Confirm goods received" icon={Truck} tone="dispatch" disabled={busy} onClick={()=>view(po.id,true)} />}
  {po.status==='Out for Delivery'&&<POActionButton label="Mark as received" icon={PackageCheck} tone="receive" disabled={busy} onClick={()=>view(po.id,true)} />}
</div></td></tr>)}</tbody></table></div><Pagination currentPage={current} totalPages={pages} onPageChange={setPage}/></div>
    {declining&&<DocumentModal title="Declined by Supplier" compact busy={busy} onClose={()=>setDeclining(null)}>
      <div className="po-workflow-panel"><p>Confirm that <strong>{declining.supplier}</strong> declined purchase order <strong>{declining.poNo || declining.id}</strong>.</p><p className="po-form-intro">The purchase order will be marked as Rejected and cannot proceed to payment, delivery, or stock receipt.</p>
      {error&&<p role="alert" className="po-error">{error}</p>}
      <footer className="po-form-footer"><button type="button" className="po-history-close-btn" disabled={busy} onClick={()=>setDeclining(null)}>Cancel</button><button type="button" className="po-btn-confirm po-confirm-decline" disabled={busy} onClick={()=>transition(declining,'reject')}>{busy?'Saving...':'Confirm Decline'}</button></footer></div>
    </DocumentModal>}
    {paymentPreview&&<DocumentModal title="Payment Document" onClose={()=>setPaymentPreview(null)}><PurchaseOrderDocument orderId={paymentPreview} paymentReceipt /></DocumentModal>}
    {workflow&&<POPaymentWorkflow po={workflow} onClose={()=>setWorkflow(null)} onRefresh={()=>{onRefresh();if(details)apiRequest(`/purchase-orders/${details.PurchaseOrderID}`).then(setDetails).catch(e=>setError(e.message));}} />}
    {details&&<Modal className={receiving?'po-receive-modal':''} title={receiving?'Confirm Goods Received':'Purchase Order Details'} close={()=>setDetails(null)} busy={busy}>{error&&<p role="alert" className="po-error">{error}</p>}{!receiving && <div className="po-document-actions"><button type="button" className="po-history-view-btn po-view-order-btn" aria-haspopup="dialog" onClick={() => setShowDocument(true)}><FileText size={18} aria-hidden="true" /><span>View Purchase Order</span></button>{showDocument && <DocumentModal onClose={() => setShowDocument(false)}><PurchaseOrderDocument orderId={details.PurchaseOrderID} supplier={{name: details.SupplierName, email: details.SupplierEmail, phone: details.SupplierPhone, address: details.SupplierAddress}} warehouse={{name: details.WarehouseName, address: details.WarehouseAddress}} items={details.items.map(i => ({...i, unitCost: i.costPrice}))} paymentMethod={details.PaymentMethod} referenceNo={details.PaymentReference} poNo={details.PONo} orderDate={details.OrderDate} /></DocumentModal>}{['Approved','Paid','Out for Delivery','Received'].includes(details.Status) && <button type="button" className="po-history-view-btn po-view-order-btn" onClick={()=>details.PaymentMethod && details.PaymentReference ? setPaymentPreview(details.PurchaseOrderID) : openPayment({id:details.PurchaseOrderID,poNo:details.PONo,supplier:details.SupplierName,status:details.Status,totalAmount:details.TotalAmount,paymentEmailSentAt:details.PaymentEmailSentAt,paymentRecorded:!!(details.PaymentMethod && details.PaymentReference)})}><ReceiptText size={18} aria-hidden="true" /><span>View Payment Document</span></button>}<button type="button" className="po-history-view-btn po-view-order-btn" aria-haspopup="dialog" onClick={()=>setShowDelivery(true)}><Truck size={18} aria-hidden="true" /><span>View Delivery</span></button></div>}<div className="po-view-details">
      <div className="po-view-detail"><strong>Purchase Order No:</strong><span>{details.PONo}</span></div>
      <div className="po-view-detail"><strong>Status:</strong><span className={`po-history-status-pill ${details.Status.toLowerCase().replaceAll(' ', '-')}`}>{details.Status}</span></div>
      <div className="po-view-detail"><strong>Supplier:</strong><span>{details.SupplierName}</span></div>
      <div className="po-view-detail"><strong>Email:</strong><span>{details.SupplierEmail || 'Not provided'}</span></div>
      <div className="po-view-detail"><strong>Phone:</strong><span>{details.SupplierPhone || 'Not provided'}</span></div>
      <div className="po-view-detail"><strong>Destination Warehouse:</strong><span>{details.WarehouseName || 'Warehouse not provided'}</span></div>
      <div className="po-view-detail po-view-address"><strong>Address:</strong><span>{details.WarehouseAddress || 'Not provided'}</span></div>
      <div className="po-view-detail"><strong>Amount Paid:</strong><span>{details.AmountPaid == null ? 'Not recorded' : money(details.AmountPaid)}</span></div>
      <div className="po-view-detail"><strong>Payment:</strong><span>{details.PaymentMethod || 'Not recorded'}</span></div>
      <div className="po-view-detail"><strong>Reference:</strong><span>{details.PaymentReference || 'None'}</span></div>
    </div>

    {showDelivery&&!receiving&&<DocumentModal title="Delivery Details" onClose={()=>setShowDelivery(false)}>
      <div className="po-delivery-details">
        <dl className="po-delivery-info">
          <div><dt>Purchase Order</dt><dd>{details.PONo || details.PurchaseOrderID}</dd></div>
          <div><dt>Status</dt><dd><span className={`po-history-status-pill ${details.Status.toLowerCase().replaceAll(' ','-')}`}>{details.Status}</span></dd></div>
          <div><dt>Supplier</dt><dd>{details.SupplierName}</dd></div>
          <div><dt>Destination Warehouse</dt><dd>{details.WarehouseName || 'Not recorded'}</dd></div>
          <div className="po-delivery-address"><dt>Delivery Address</dt><dd>{details.WarehouseAddress || 'Not recorded'}</dd></div>
        </dl>
        <section><h4>Delivery Items</h4><div className="po-create-table-scroll po-delivery-table-wrap"><table className="po-history-items-table po-delivery-items"><thead><tr><th>Product</th><th>Ordered Qty</th><th>Delivered Qty</th><th>Remaining Qty</th></tr></thead><tbody>{details.items.map(item=><tr key={item.productId}><td>{item.productName}</td><td>{item.qty}</td><td>{Number(item.receivedQty||0)}</td><td>{Math.max(0,Number(item.qty)-Number(item.receivedQty||0))}</td></tr>)}</tbody></table></div></section>
        <section><h4>Delivery Records</h4>
        {details.deliveries?.length?<div className="po-create-table-scroll po-delivery-table-wrap"><table className="po-history-items-table po-delivery-records"><thead><tr><th>Received On</th><th>Product</th><th>Quantity</th><th>Warehouse</th></tr></thead><tbody>{details.deliveries.map(delivery=><tr key={delivery.id}><td><span className="po-delivery-date">{new Date(delivery.receivedAt).toLocaleDateString('en-PH',{year:'numeric',month:'short',day:'numeric'})}</span><span className="po-delivery-time">{new Date(delivery.receivedAt).toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit'})}</span></td><td>{delivery.productName}</td><td>{delivery.quantity}</td><td>{delivery.warehouse}</td></tr>)}</tbody></table></div>:<p className="po-delivery-empty">No delivery records available.</p>}
        </section>
      </div>
    </DocumentModal>}
    <form onSubmit={receive}><div className="po-create-table-scroll"><table className="po-history-items-table"><thead><tr><th>Item</th><th>Ordered Qty</th>{receiving?<th>Quantity to Receive</th>:<><th>Cost Price</th><th>Total</th></>}</tr></thead><tbody>{details.items.map(i=><tr key={i.productId}><td>{i.productName}</td><td>{i.qty}</td>{receiving?<td>{quantities[i.productId]}</td>:<><td>{money(i.costPrice)}</td><td>{money(i.subtotal)}</td></>}</tr>)}</tbody></table></div>{receiving&&<footer className="po-form-footer"><button type="button" className="po-history-close-btn" disabled={busy} onClick={()=>setDetails(null)}>Cancel</button><button className="po-btn-confirm" disabled={busy||!details.WarehouseID}>{busy?'Receiving…':'Confirm Goods Received'}</button></footer>}</form></Modal>}
  </>;
}
