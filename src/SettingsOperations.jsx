import { useRef, useState } from "react";
import { apiRequest } from "./api";

const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const fields = ["businessDays", "openingTime", "closingTime", "pickupExpirationDays", "maxDeliveryAttempts"];
const displayTime = (time) => {
  if (!time) return "Not configured";
  const [h, m] = time.split(":");
  return `${String(Number(h) % 12 || 12).padStart(2, "0")}:${m} ${Number(h) >= 12 ? "PM" : "AM"}`;
};
function TimeField({ label, value, onChange }) {
  const [h, m] = (value || "00:00").split(":");
  const hour = Number(h) % 12 || 12;
  const period = Number(h) >= 12 ? "PM" : "AM";
  const update = (hh, mm, p) => onChange(`${String(Number(hh) % 12 + (p === "PM" ? 12 : 0)).padStart(2, "0")}:${mm}`);
  return <div className="form-group"><span>{label}</span><div className="operations-time">
    <select className="form-control" aria-label={`${label} hour`} value={hour} onChange={(e) => update(e.target.value, m, period)}>{Array.from({ length: 12 }, (_, i) => i + 1).map((v) => <option key={v} value={v}>{String(v).padStart(2, "0")}</option>)}</select>
    <span>:</span>
    <select className="form-control" aria-label={`${label} minute`} value={m} onChange={(e) => update(hour, e.target.value, period)}>{Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0")).map((v) => <option key={v}>{v}</option>)}</select>
    <select className="form-control" aria-label={`${label} AM or PM`} value={period} onChange={(e) => update(hour, m, e.target.value)}><option>AM</option><option>PM</option></select>
  </div></div>;
}
export default function SettingsOperations({ settings, disabled, onSaved }) {
  const dialog = useRef(null);
  const [saved, setSaved] = useState(null);
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const current = saved || settings;
  const update = (field, value) => setDraft((prev) => ({ ...prev, [field]: value }));
  const open = () => {
    setDraft(Object.fromEntries(fields.map((key) => [key, current[key]])));
    setError("");
    dialog.current.showModal();
  };
  const save = async (event) => {
    event.preventDefault();
    if (!draft.businessDays?.length) return setError("Select at least one business day.");
    if (!draft.openingTime || !draft.closingTime || draft.openingTime >= draft.closingTime) return setError("Opening time must be earlier than closing time on the same day.");
    if (![draft.pickupExpirationDays, draft.maxDeliveryAttempts].every((v) => /^\d+$/.test(String(v)) && Number(v) > 0 && Number(v) <= 4294967295)) return setError("Both numeric values must be positive integers (maximum 4294967295).");
    setSaving(true);
    setError("");
    try {
      const result = await apiRequest("/settings/operations", { method: "PUT", body: JSON.stringify({ ...draft, pickupExpirationDays: Number(draft.pickupExpirationDays), maxDeliveryAttempts: Number(draft.maxDeliveryAttempts) }) });
      // The endpoint reads the saved company row back from the database.
      setSaved(result.settings);
      dialog.current.close();
      onSaved(result.message);
    } catch (err) { setError(err.message || "Failed to save settings."); }
    finally { setSaving(false); }
  };
  return <>
    <div className="settings-card">
      <h2 className="card-title">Business Operations &amp; Order Policies</h2>
      <dl className="operations-summary">
        <div><dt>Business Days</dt><dd>{current.businessDays?.join(", ") || "Not configured"}</dd></div>
        <div><dt>Operating Hours</dt><dd>{displayTime(current.openingTime)} – {displayTime(current.closingTime)}</dd></div>
        <div><dt>Pickup Expiration</dt><dd>{current.pickupExpirationDays == null ? "Not configured" : `${current.pickupExpirationDays} business days`}</dd></div>
        <div><dt>Maximum Delivery Attempts</dt><dd>{current.maxDeliveryAttempts ?? "Not configured"}</dd></div>
      </dl>
      <div className="card-actions"><button className="btn btn-primary" disabled={disabled} onClick={open}>Edit</button></div>
    </div>
    <dialog ref={dialog} className="operations-dialog" aria-labelledby="operations-title" onCancel={(e) => { if (saving) e.preventDefault(); }}>
      {draft && <form onSubmit={save}>
        <div className="operations-heading"><h2 id="operations-title">Business Operations &amp; Order Policies</h2><button type="button" aria-label="Close" disabled={saving} className="operations-close" onClick={() => dialog.current.close()}>×</button></div>
        <fieldset className="operations-fields" disabled={saving}>
          <fieldset className="operations-group" aria-describedby="days-help"><legend>Business Days</legend>
            <p className="operations-help" id="days-help">Select the days your business operates.</p>
            <div className="operations-day-options">{days.map((day) => <label key={day} className="checkbox-label"><input type="checkbox" checked={draft.businessDays?.includes(day) || false} onChange={(e) => update("businessDays", e.target.checked ? [...(draft.businessDays || []), day] : draft.businessDays.filter((v) => v !== day))} />{day}</label>)}</div>
          </fieldset>
          <fieldset className="operations-group" aria-describedby="hours-help"><legend>Business Hours</legend>
            <p className="operations-help" id="hours-help">Set the opening and closing times.</p>
            <div className="operations-hours"><TimeField label="Opening time" value={draft.openingTime} onChange={(v) => update("openingTime", v)} /><TimeField label="Closing time" value={draft.closingTime} onChange={(v) => update("closingTime", v)} /></div>
          </fieldset>
          <div className="form-group"><label htmlFor="pickup-days">Pickup Expiration (business days)</label><p className="operations-help" id="pickup-help">Set how many business days a paid pickup order can remain unclaimed before it expires.</p><input className="form-control" id="pickup-days" type="number" min="1" max="4294967295" step="1" required value={draft.pickupExpirationDays ?? ""} aria-describedby="pickup-help" onChange={(e) => update("pickupExpirationDays", e.target.value)} /></div>
          <div className="form-group"><label htmlFor="delivery-attempts">Maximum Delivery Attempts</label><p className="operations-help" id="delivery-help">Set the maximum number of delivery attempts allowed for an order before further resolution is required.</p><input className="form-control" id="delivery-attempts" type="number" min="1" max="4294967295" step="1" required value={draft.maxDeliveryAttempts ?? ""} aria-describedby="delivery-help" onChange={(e) => update("maxDeliveryAttempts", e.target.value)} /></div>
        </fieldset>
        {error && <p className="operations-error" role="alert">{error}</p>}
        <div className="card-actions"><button type="button" className="btn operations-cancel" disabled={saving} onClick={() => dialog.current.close()}>Cancel</button><button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : "Save Changes"}</button></div>
      </form>}
    </dialog>
  </>;
}
