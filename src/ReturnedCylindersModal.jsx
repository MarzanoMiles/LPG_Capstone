import { useState } from "react";
import { ChevronDown, Plus, Trash2, Warehouse } from "lucide-react";
import "./PaymentModal.css";

export default function ReturnedCylindersModal({items=[],cylinderProducts=[],inventoryStocks=[],warehouseName,warehouseOptions,warehouseId,onWarehouseChange,loading=false,onCancel,onConfirm,confirmationNote="Stock will be updated in the warehouse shown above when payment is completed."}) {
  const [draftItems,setDraftItems]=useState(()=>items.length ? items.map(item=>({...item})) : [{productId:"",qty:""}]);
  const validReturns=draftItems.length>0 && draftItems.every(item=>cylinderProducts.some(p=>p.id===item.productId) && /^[0-9]+$/.test(String(item.qty)) && Number.isSafeInteger(Number(item.qty)) && Number(item.qty)>0 && Number(item.qty)<=2147483647);
  const editReturn=(index,changes)=>setDraftItems(items=>items.map((item,i)=>i===index?{...item,...changes}:item));
  const brands=[...new Set(cylinderProducts.map(product=>product.brand).filter(Boolean))];
  const selectIdentity=(index,brand,weight)=>{
    const matches=cylinderProducts.filter(product=>product.brand===brand && String(product.unitValue ?? "")===weight);
    editReturn(index,{brand,weight,productId:matches.length===1?matches[0].id:""});
  };
  const stockKnown=!loading && (!warehouseOptions || !!warehouseId);
  const currentStock=productId=>warehouseOptions
    ? Number(inventoryStocks.find(stock=>stock.warehouseId===warehouseId && stock.productId===productId)?.stock || 0)
    : Number(cylinderProducts.find(product=>product.id===productId)?.stock || 0);
  const selectedIds=[...new Set(draftItems.filter(item=>cylinderProducts.some(product=>product.id===item.productId)).map(item=>item.productId))];
  const totalItems=draftItems.reduce((sum,item)=>sum+Number(item.qty || 0),0);
  const newStockCount=selectedIds.reduce((sum,id)=>sum+currentStock(id),0)+draftItems.filter(item=>selectedIds.includes(item.productId)).reduce((sum,item)=>sum+Number(item.qty || 0),0);
  return (
    <div className="payment-modal-overlay">
      <div className="payment-modal cylinder-return-modal" role="dialog" aria-modal="true" aria-label="Returned Empty Cylinders">
        <div className="return-header">
          <h2 className="payment-modal-title">Returned Empty Cylinders</h2>
          <p className="return-description">Select the cylinders returned by the customer and enter their quantities.</p>
          <div className={`return-warehouse${warehouseOptions ? " return-warehouse-picker" : ""}`}><Warehouse size={16} />{warehouseOptions ? <><label htmlFor="cylinder-return-warehouse">Return to</label><div className="return-warehouse-select"><select id="cylinder-return-warehouse" value={warehouseId || ""} disabled={loading} onChange={event=>onWarehouseChange(event.target.value)}><option value="">Select warehouse</option>{warehouseOptions.map(warehouse=><option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select><ChevronDown size={16} aria-hidden="true" /></div></> : <span>Return to <strong>{warehouseName || "Selected warehouse"}</strong></span>}</div>
        </div>
        <div className="return-toolbar">
          <span>{draftItems.length} {draftItems.length === 1 ? "product row" : "product rows"}</span>
          <button type="button" className="payment-modal-btn confirm" disabled={!cylinderProducts.length} onClick={() => setDraftItems((items) => [...items, { productId: "", qty: "" }])}><Plus size={16} /> Add Item</button>
        </div>
        <div className="return-table-wrap"><table className="return-table"><thead><tr><th>Product</th><th>Brand</th><th>Weight</th><th>Current Stock</th><th>Qty</th><th><span className="return-sr-only">Actions</span></th></tr></thead>
          <tbody>{draftItems.map((item, index) => {
            const product = cylinderProducts.find((p) => p.id === item.productId);
            const brand=product?.brand ?? item.brand ?? "";
            const weight=String(product?.unitValue ?? item.weight ?? "");
            const weights=[...new Set(cylinderProducts.filter(p=>p.brand===brand).map(p=>String(p.unitValue ?? "")))].filter(Boolean);
            const matches=cylinderProducts.filter(p=>p.brand===brand && String(p.unitValue ?? "")===weight);
            return <tr key={index}>
              <td data-label="Product">{matches.length>1 ? <select aria-label={`Product ${index + 1}`} value={item.productId} onChange={e=>editReturn(index,{productId:e.target.value})}><option value="">Select cylinder variant</option>{matches.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select> : <span>{product?.name || "Select brand and weight"}</span>}</td>
              <td data-label="Brand"><select aria-label={`Brand ${index + 1}`} disabled={loading} value={brand} onChange={e=>selectIdentity(index,e.target.value,"")}><option value="">Select brand</option>{brands.map(value=><option key={value} value={value}>{value}</option>)}</select></td>
              <td data-label="Weight"><select aria-label={`Weight ${index + 1}`} disabled={loading || !brand} value={weight} onChange={e=>selectIdentity(index,brand,e.target.value)}><option value="">Select weight</option>{weights.map(value=><option key={value} value={value}>{value} kg</option>)}</select></td>
              <td data-label="Current Stock">{product ? (stockKnown ? currentStock(product.id).toLocaleString() : loading ? "Loading stock?" : "Select warehouse") : "-"}</td>
              <td data-label="Qty"><input placeholder="0" aria-label={`Quantity ${index + 1}`} type="text" inputMode="numeric" pattern="[0-9]*" value={item.qty} onChange={(e) => { if (/^\d*$/.test(e.target.value)) editReturn(index, { qty: e.target.value }); }} /></td>
              <td className="return-row-action"><button className="return-remove-btn" type="button" aria-label={`Remove item ${index + 1}`} onClick={() => setDraftItems((items) => items.filter((_, i) => i !== index))}><Trash2 size={17} /></button></td>
            </tr>;
          })}</tbody></table></div>
        {loading && <p className="return-empty" role="status">Loading return options?</p>}
        {!loading && !cylinderProducts.length && <p className="return-empty" role="status">No cylinder products are available for this warehouse.</p>}
        {!draftItems.length && <p className="return-empty">Click Add Item to select a returned cylinder.</p>}
        <div className="return-summary"><span>Total Items</span><strong>{totalItems}</strong></div>
        <div className="return-summary" aria-live="polite"><span>New Stock Count</span><strong>{stockKnown && selectedIds.length ? newStockCount.toLocaleString() : "-"}</strong></div>
        <p className="return-stock-caption">Projected stock for the selected cylinder products after these returns.</p>
        <p className="return-note">{confirmationNote}</p>
        <div className="payment-modal-actions return-actions">
          <button type="button" className="payment-modal-btn cancel" onClick={onCancel}>Cancel</button>
          <button type="button" className="payment-modal-btn confirm" disabled={!validReturns || loading || (warehouseOptions && !warehouseId)} onClick={() => onConfirm(draftItems.map(item => ({productId:item.productId,qty:Number(item.qty)})))}>Okay</button>
        </div>
      </div>
    </div>
  );

}
