import React, { useEffect, useRef, useState } from 'react';
import Pagination from './Pagination';
import InventoryItemSelector from './InventoryItemSelector';
import { apiRequest } from './api';
const money = n => `₱ ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
function Modal({title,close,children,busy}) { return <div className="po-history-modal-overlay"><div className="po-history-modal-card" role="dialog" aria-modal="true" aria-label={title}><div className="po-history-modal-header"><h3>{title}</h3><button disabled={busy} className="po-history-close-btn" onClick={close}>Close</button></div>{children}</div></div>; }
export function POCreationModal({draft,onClose,onSaved}) {
  const [options,setOptions]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [warehouseId,setWarehouse]=useState(''),[paymentMethod,setPayment]=useState('GCash'),[referenceNo,setReference]=useState('');
  const [items,setItems]=useState(draft.items),[savedId,setSavedId]=useState(null);
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
      const result=await apiRequest('/purchase-orders',{method:'POST',body:JSON.stringify({supplierId,restockIds:draft.items.flatMap((item,index)=>supplierId===draft.supplierId && items.some(i=>i.productId===item.productId) && draft.restockIds[index] ? [draft.restockIds[index]] : []),warehouseId,paymentMethod,referenceNo,items,requestKey:requestKey.current})});
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
                  <thead><tr><th>#</th><th>Category</th><th>Brand</th><th>Unit Value</th><th>Product</th><th>Quantity</th><th>Cost Price</th><th>Subtotal</th><th>Action</th></tr></thead>
                  <tbody>
                    {!items.length && <tr><td colSpan={9} className="po-create-empty">No items added yet.<span>Click Add Item to select a category, brand and product.</span></td></tr>}
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
                      <td><input aria-label={`Quantity for item ${index + 1}`} type="number" min="1" step="1" required disabled={!item.productId} value={item.qty} onChange={e => setItems(prev => prev.map((it, j) => j === index ? { ...it, qty: Number(e.target.value) } : it))} /></td>
                      <td>{item.productId ? money(item.unitCost) : '-'}</td><td>{money(item.qty * item.unitCost)}</td>
                      <td><button type="button" className="po-remove-item-btn" onClick={() => setItems(prev => prev.filter((_, rowIndex) => rowIndex !== index))}>Remove</button></td>
                    </tr>)}
                  </tbody>
                </table>
              </div>
            </fieldset>
          </section>

          <div className="po-payment-summary">
            <section className="po-form-section">
              <div className="po-section-heading"><h4>Payment Information</h4></div>
              <label className="po-field">Payment Method
                <select disabled={!!savedId || busy} value={paymentMethod} onChange={e => setPayment(e.target.value)}>{['GCash', 'Card', 'Bank Transfer'].map(m => <option key={m}>{m}</option>)}</select>
              </label>
              <label className="po-field">Reference No. <span className="po-optional">(optional)</span><input maxLength={100} placeholder="Enter payment reference" disabled={!!savedId || busy} value={referenceNo} onChange={e => setReference(e.target.value)} /></label>
            </section>
            <section className="po-form-section po-order-summary">
              <div className="po-section-heading"><h4>Order Summary</h4></div>
              <dl><div><dt>Total Items</dt><dd>{new Set(items.filter(i => i.productId).map(i => i.productId)).size}</dd></div><div><dt>Total Quantity</dt><dd>{items.reduce((n, i) => n + (i.productId ? i.qty : 0), 0)}</dd></div><div className="po-summary-total"><dt>Total Amount</dt><dd>{money(items.reduce((n, i) => n + i.qty * i.unitCost, 0))}</dd></div></dl>
            </section>
          </div>
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

export function POTable({orders,loading,onRefresh}) {
  const [page,setPage]=useState(1),[details,setDetails]=useState(null),[receiving,setReceiving]=useState(false),[quantities,setQuantities]=useState({}),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const submitting=useRef(false),receiptKey=useRef(null);const pages=Math.max(1,Math.ceil(orders.length/5)),current=Math.min(page,pages);
  async function view(id,receive=false){setBusy(true);setError('');try{const po=await apiRequest(`/purchase-orders/${id}`);setDetails(po);setReceiving(receive);receiptKey.current=crypto.randomUUID();setQuantities(Object.fromEntries(po.items.map(i=>[i.productId,Number(i.qty)-Number(i.receivedQty)])));}catch(e){setError(e.message);}finally{setBusy(false);}}
  async function transition(po,action){const prompts={confirm:'Confirm the supplier has accepted this PO?',dispatch:'Confirm the supplier has dispatched this PO?',send:'Send this PO to the supplier’s saved email?'};if(!window.confirm(prompts[action]))return;if(submitting.current)return;submitting.current=true;setBusy(true);setError('');try{await apiRequest(`/purchase-orders/${po.id}/${action}`,{method:'PUT'});onRefresh();}catch(e){setError(e.message);}finally{submitting.current=false;setBusy(false);}}
  async function receive(e){e.preventDefault();if(submitting.current)return;submitting.current=true;setBusy(true);setError('');try{const result=await apiRequest(`/purchase-orders/${details.PurchaseOrderID}/receive`,{method:'PUT',body:JSON.stringify({requestKey:receiptKey.current,items:details.items.map(i=>({productId:i.productId,qty:quantities[i.productId]}))})});setDetails(null);onRefresh();if(result.status!=='Received')setError(result.message);}catch(e){setError(e.message);}finally{submitting.current=false;setBusy(false);}}
  return <>{error&&<p role="alert" className="po-error">{error}</p>}<div className="restocking-table-wrap"><div className="paginated-table-scroll"><table className="restocking-table po-orders-table"><thead><tr>{['Purchase Order ID','Supplier Name','Date','Total Items','Quantity','Total Amount','Status','Actions'].map(c=><th key={c}>{c}</th>)}</tr></thead><tbody>{loading?<tr><td colSpan={8}>Loading…</td></tr>:!orders.length?<tr><td colSpan={8} className="po-orders-empty">No purchase orders yet.</td></tr>:orders.slice((current-1)*5,current*5).map(po=><tr key={po.id}><td>{po.poNo||po.id}</td><td>{po.supplier}</td><td>{new Date(po.orderDate).toLocaleDateString()}</td><td>{po.itemCount}</td><td>{po.totalQty}</td><td>{money(po.totalAmount)}</td><td><span className={`po-history-status-pill ${po.status.toLowerCase().replaceAll(' ','-')}`}>{po.status}</span></td><td><div className="po-action-buttons"><button disabled={busy} className="po-history-view-btn" onClick={()=>view(po.id)}>View</button>{po.status==='Pending'&&<button disabled={busy} onClick={()=>transition(po,'send')}>Send</button>}{po.status==='Sent'&&<button disabled={busy} onClick={()=>transition(po,'confirm')}>Approve</button>}{po.status==='Approved'&&<button disabled={busy} onClick={()=>transition(po,'dispatch')}>Out for Delivery</button>}{po.status==='Out for Delivery'&&<button disabled={busy} onClick={()=>view(po.id,true)}>Mark as Received</button>}</div></td></tr>)}</tbody></table></div><Pagination currentPage={current} totalPages={pages} onPageChange={setPage}/></div>
    {details&&<Modal title={receiving?'Receive Purchase Order':'Purchase Order Details'} close={()=>setDetails(null)} busy={busy}>{error&&<p role="alert" className="po-error">{error}</p>}<div className="po-view-details">
      <div className="po-view-detail"><strong>Purchase Order No:</strong><span>{details.PONo}</span></div>
      <div className="po-view-detail"><strong>Status:</strong><span className={`po-history-status-pill ${details.Status.toLowerCase().replaceAll(' ', '-')}`}>{details.Status}</span></div>
      <div className="po-view-detail"><strong>Supplier:</strong><span>{details.SupplierName}</span></div>
      <div className="po-view-detail"><strong>Email:</strong><span>{details.SupplierEmail || 'Not provided'}</span></div>
      <div className="po-view-detail"><strong>Phone:</strong><span>{details.SupplierPhone || 'Not provided'}</span></div>
      <div className="po-view-detail"><strong>Destination Warehouse:</strong><span>{details.WarehouseName || 'Warehouse not provided'}</span></div>
      <div className="po-view-detail po-view-address"><strong>Address:</strong><span>{details.WarehouseAddress || 'Not provided'}</span></div>
      <div className="po-view-detail"><strong>Payment:</strong><span>{details.PaymentMethod || 'Not recorded'}</span></div>
      <div className="po-view-detail"><strong>Reference:</strong><span>{details.PaymentReference || 'None'}</span></div>
    </div><form onSubmit={receive}><table className="po-history-items-table"><thead><tr><th>Item</th><th>Ordered Qty</th><th>Previously Received</th>{receiving?<th>Actual Delivered Qty (this receipt)</th>:<><th>Unit Price</th><th>Total</th></>}</tr></thead><tbody>{details.items.map(i=><tr key={i.productId}><td>{i.productName}</td><td>{i.qty}</td><td>{i.receivedQty}</td>{receiving?<td><input aria-label={`${i.productName} actual delivered quantity`} required type="number" min="0" max={Number(i.qty)-Number(i.receivedQty)} step="1" value={quantities[i.productId]} onChange={e=>setQuantities(prev=>({...prev,[i.productId]:Number(e.target.value)}))}/></td>:<><td>{money(i.costPrice)}</td><td>{money(i.subtotal)}</td></>}</tr>)}</tbody></table>{receiving&&<><p>Enter only units physically delivered in this receipt. Partial deliveries keep the PO Out for Delivery.</p><button className="po-btn-confirm" disabled={busy||!details.WarehouseID}>{busy?'Receiving…':'Confirm Receipt & Stock In'}</button></>}</form></Modal>}
  </>;
}
