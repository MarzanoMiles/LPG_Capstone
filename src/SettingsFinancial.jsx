import { useRef, useState } from "react";
import { apiRequest } from "./api";
import { financialSettingsPayload, financialSwitch } from "./utils/financialSettings";
import { clearReceiptSettingsCache } from "./utils/receipt";
const defaultDiscounts = [
 { label: "No Discount", value: 0 },
 { label: "Senior/PWD (5%)", value: 0.05 },
 { label: "Member (10%)", value: 0.1 },
];
export default function SettingsFinancial({ settings, disabled, onSaved }) {
 const dialog = useRef(null);
 const [saved, setSaved] = useState(null);
 const [draft, setDraft] = useState(null);
 const [saving, setSaving] = useState(false);
 const [error, setError] = useState("");
 const [discountError, setDiscountError] = useState("");
 const current = saved || settings;
 const update = (key, value) => setDraft(prev => ({...prev, [key]: value}));
 const open = () => { setDraft({...current, allowIssueRefund: financialSwitch(current.allowIssueRefund), enableCancellationFee: financialSwitch(current.enableCancellationFee)}); setError(""); setDiscountError(""); dialog.current.showModal(); };
 const addDiscount = () => {
  const name = draft.newDiscountName?.trim();
  const raw = draft.newDiscountValue;
  const percent = Number(raw);
  if (!name || raw == null || String(raw).trim() === "" || !Number.isFinite(percent) || percent < 0 || percent > 100) {
   setDiscountError("Enter a discount name and a percentage from 0 to 100.");
   return;
  }
  setDraft(prev => ({...prev, discounts: [...(prev.discounts || defaultDiscounts), {label: name, value: percent / 100, enabled: true}], showDiscountModal: false, newDiscountName: "", newDiscountValue: ""}));
  setDiscountError("");
 };
 const save = async event => {
  event.preventDefault();
  let payload;
  try { payload = financialSettingsPayload(draft); }
  catch (err) { setError(err.message); return; }
  setSaving(true); setError("");
  try {
   const result = await apiRequest("/settings/tax", {method: "PUT", body: JSON.stringify(payload)});
   setSaved({...result.settings, discounts: draft.discounts}); clearReceiptSettingsCache(); dialog.current.close(); onSaved(result.message);
  } catch (err) { setError(err.message || "Failed to save financial rules."); }
  finally { setSaving(false); }
 };
 return <>
  <div className="settings-card">
   <h2 className="card-title">Financial &amp; Tax Rules</h2>
   <dl className="operations-summary">
    <div><dt>Tax</dt><dd>{current.taxEnabled ? `${current.taxRate}%` : "Disabled"}</dd></div>
    <div><dt>Currency</dt><dd>{current.currency}</dd></div>
    <div><dt>Rounding</dt><dd>{[current.roundUp && "Round up", current.roundDown && "Round down", current.twoDecimalStandard && "2 decimal standard"].filter(Boolean).join(", ") || "None"}</dd></div>
    <div><dt>Allow Issue Refund</dt><dd>{current.allowIssueRefund ? "On" : "Off"}</dd></div>
    <div><dt>Enable Cancellation Fee</dt><dd>{current.allowIssueRefund && current.enableCancellationFee ? "On" : "Off"}</dd></div>
    {current.allowIssueRefund && current.enableCancellationFee && <div><dt>Cancellation Fee</dt><dd>{current.cancellationFeeType === "Percentage" ? `${current.cancellationFeeValue}%` : `PHP ${Number(current.cancellationFeeValue).toFixed(2)}`}</dd></div>}
   </dl>
   <div className="card-actions"><button className="btn btn-primary" onClick={open} disabled={disabled}>Edit</button></div>
  </div>
  <dialog ref={dialog} className="operations-dialog financial-dialog" aria-labelledby="financial-title" onCancel={e => {if(saving) e.preventDefault();}}>
   {draft && <form onSubmit={save}>
    <h2 id="financial-title">Financial &amp; Tax Rules</h2>
    <fieldset className="operations-fields" disabled={saving}>
     <p className="operations-help">Configure taxes, currency and receipt rounding below.</p>
     <div className="toggle-group"><div><label htmlFor="allow-refunds">Allow Issue Refund</label><p className="operations-help">Allow authorized users to record refunds across all order types.</p></div><label className="toggle-switch"><input id="allow-refunds" role="switch" type="checkbox" checked={draft.allowIssueRefund} onChange={e => update("allowIssueRefund", e.target.checked)} /><span className="toggle-slider" /></label></div>
     <div className="toggle-group"><div><label htmlFor="enable-fees">Enable Cancellation Fee</label><p className="operations-help">Deduct fees from qualifying prepaid cancellation refunds. Requires refunds to be on.</p></div><label className="toggle-switch"><input id="enable-fees" role="switch" type="checkbox" disabled={!draft.allowIssueRefund} checked={draft.allowIssueRefund && draft.enableCancellationFee} onChange={e => update("enableCancellationFee", e.target.checked)} /><span className="toggle-slider" /></label></div>
     {draft.allowIssueRefund && draft.enableCancellationFee && <div className="operations-hours">
      <div className="form-group"><label htmlFor="fee-type">Fee Type</label><p className="operations-help">Choose a peso amount or percentage of the eligible refund.</p><select id="fee-type" className="form-control" value={draft.cancellationFeeType} onChange={e => update("cancellationFeeType", e.target.value)}><option value="Fixed">Fixed Amount ({'\u20b1'})</option><option value="Percentage">Percentage (%)</option></select></div>
      <div className="form-group"><label htmlFor="fee-value">Fee Amount</label><p className="operations-help">The fee is capped at the eligible refund amount.</p><input id="fee-value" className="form-control" type="number" min="0" max={draft.cancellationFeeType === "Percentage" ? 100 : 9999999999.99} step="0.01" required value={draft.cancellationFeeValue} onChange={e => update("cancellationFeeValue", e.target.value)} /></div>
     </div>}
     <div className="financial-controls">
      <div className="financial-tax-row">
       <div className="form-group">
        <label htmlFor="financial-tax-enabled">Tax Enable</label>
        <p className="operations-help" id="financial-tax-enabled-help">Include tax in sale calculations.</p>
        <label className="toggle-switch"><input id="financial-tax-enabled" type="checkbox" role="switch" aria-describedby="financial-tax-enabled-help" checked={draft.taxEnabled} onChange={e => update("taxEnabled", e.target.checked)} /><span className="toggle-slider" /></label>
       </div>
       <div className="form-group">
        <label htmlFor="financial-tax-rate">Tax Rate (%)</label>
        <p className="operations-help" id="financial-tax-rate-help">Set the rate used when tax is enabled.</p>
        <input id="financial-tax-rate" aria-describedby="financial-tax-rate-help" type="number" min="0" max="100" step="0.01" required className="form-control" value={draft.taxRate} onChange={e => update("taxRate", e.target.value)} />
       </div>
      </div>
      <div className="grid-2-col financial-currency-row">
       <div className="form-group"><label htmlFor="financial-currency">Currency</label><p className="operations-help">Set the currency code used by receipts.</p><input id="financial-currency" className="form-control" value={draft.currency} onChange={e => update("currency", e.target.value)} required pattern="[A-Z]{3}" maxLength={3} placeholder="PHP" /></div>
       <fieldset className="operations-group"><legend>Rounding</legend><div className="checkbox-group">
        {[["roundUp", "Round up"], ["roundDown", "Round down"], ["twoDecimalStandard", "2 decimal standard"]].map(([key, label]) => <label className="checkbox-label" key={key}><input type="checkbox" checked={draft[key]} onChange={e => update(key, e.target.checked)} />{label}</label>)}
       </div></fieldset>
      </div>
      <section className="financial-discounts" aria-labelledby="financial-discounts-title">
       <div className="financial-discounts-heading"><div><h3 id="financial-discounts-title">Discounts</h3><p className="operations-help">Manage discount options and their availability.</p></div><button type="button" className="financial-add-discount" onClick={() => { update("showDiscountModal", !draft.showDiscountModal); setDiscountError(""); }}>{draft.showDiscountModal ? "Close" : "+ Add discount"}</button></div>
       <div className="financial-discount-list">
        {(draft.discounts || defaultDiscounts).map((disc, index) => <div className="financial-discount-row" key={`${disc.label}-${index}`}>
         <label className="checkbox-label financial-discount-name"><input type="checkbox" checked={disc.enabled !== false} onChange={e => update("discounts", (draft.discounts || defaultDiscounts).map((item, i) => i === index ? {...item, enabled: e.target.checked} : item))} /><span>{disc.label.replace(/\s*\([\d.]+%\)$/, "")}</span></label>
         <span className="financial-discount-rate">{Number((disc.value * 100).toFixed(2))}%</span>
         <button type="button" className="financial-remove-discount" aria-label={`Remove ${disc.label}`} onClick={() => update("discounts", (draft.discounts || defaultDiscounts).filter((_, i) => i !== index))}>Remove</button>
        </div>)}
        {draft.discounts?.length === 0 && <p className="financial-discount-empty">No discount options. Add a discount to get started.</p>}
       </div>
       {draft.showDiscountModal && <div className="financial-discount-editor">
        <div className="financial-discount-editor-fields">
         <div className="form-group"><label htmlFor="discount-name">Discount name</label><input id="discount-name" className="form-control" placeholder="e.g., Student" value={draft.newDiscountName || ""} onChange={e => update("newDiscountName", e.target.value)} /></div>
         <div className="form-group"><label htmlFor="discount-percent">Percentage (%)</label><input id="discount-percent" type="number" min="0" max="100" step="any" className="form-control" placeholder="e.g., 15" value={draft.newDiscountValue ?? ""} onChange={e => update("newDiscountValue", e.target.value)} /></div>
        </div>
        {discountError && <p className="operations-error" role="alert">{discountError}</p>}
        <div className="card-actions"><button type="button" className="btn operations-cancel" onClick={() => {setDraft(prev => ({...prev, showDiscountModal: false, newDiscountName: "", newDiscountValue: ""})); setDiscountError("");}}>Cancel</button><button type="button" className="btn btn-primary" onClick={addDiscount}>Add discount</button></div>
       </div>}
      </section>
      <div className="card-actions"><button type="button" className="btn operations-cancel" disabled={saving} onClick={() => dialog.current.close()}>Cancel</button><button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving..." : "Save"}</button></div>
     </div>
    </fieldset>
    {error && <p className="operations-error" role="alert">{error}</p>}
   </form>}
  </dialog>
 </>;
}
