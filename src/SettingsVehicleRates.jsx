import { useEffect, useRef, useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { apiRequest } from './api';

const fields = [
  ['name', 'Vehicle Name/Class'],
  ['capacityKg', 'Capacity/Max Weight (kg)'],
  ['baseRate', 'Base Rate (₱)'],
  ['perKmRate', 'Per KM Rate (₱)'],
  ['freeDeliverySubtotal', 'Min Subtotal For Free Delivery (₱)'],
];
const money = value => Number(value).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function SettingsVehicleRates({ settings, disabled, onSaved }) {
  const dialog = useRef(null);
  const vehicleDialog = useRef(null);
  const deleteDialog = useRef(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [saved, setSaved] = useState(null);
  const [draft, setDraft] = useState([]);
  const [editing, setEditing] = useState(null);
  const [vehicle, setVehicle] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const vehicleEditorOpen = vehicle !== null;
  useEffect(() => {
    if (vehicleEditorOpen) vehicleDialog.current.showModal();
    else vehicleDialog.current.close();
  }, [vehicleEditorOpen]);
  let user;
  try { user = JSON.parse(localStorage.getItem('user') || 'null'); } catch { user = null; }
  const isAdmin = ['admin', 'administrator'].includes(String(user?.role || user?.roleName || '').trim().toLowerCase());
  const current = saved ?? settings.vehicleRates ?? [];
  const open = (index = null) => {
    setDraft(current.map(item => ({ ...item })));
    setEditing(index);
    setVehicle(index === null ? null : { ...current[index] });
    setError('');
    dialog.current.showModal();
  };
  const applyVehicle = () => {
    const name = vehicle.name.trim().replace(/\s+/g, ' ');
    if (!name || name.length > 100) { setError('Enter a vehicle name/class (maximum 100 characters).'); return; }
    if (draft.some((item, i) => i !== editing && item.name.toLowerCase() === name.toLowerCase())) {
      setError('A vehicle with this name/class already exists.'); return;
    }
    const next = { name };
    for (const [key] of fields.slice(1)) {
      const raw = vehicle[key];
      if (raw === '' || raw == null || !Number.isFinite(Number(raw)) || Number(raw) < 0 || Number(raw) > 9999999999.99) {
        setError('Complete every numeric field with a non-negative number up to 9999999999.99.'); return;
      }
      next[key] = Number(raw);
    }
    setDraft(items => editing === -1 ? [...items, next] : items.map((item, i) => i === editing ? next : item));
    setVehicle(null); setEditing(null); setError('');
  };
  const remove = index => {
    setPendingDelete(index);
    deleteDialog.current.showModal();
  };
  const cancelDelete = () => {
    deleteDialog.current.close();
    setPendingDelete(null);
  };
  const confirmDelete = () => {
    if (pendingDelete === null) return;
    setDraft(items => items.filter((_, index) => index !== pendingDelete));
    cancelDelete();
  };
  const save = async () => {
    setSaving(true); setError('');
    try {
      const result = await apiRequest('/settings/vehicle-rates', { method: 'PUT', body: JSON.stringify({ vehicleRates: draft }) });
      setSaved(result.vehicleRates); dialog.current.close(); onSaved(result.message);
    } catch (err) { setError(err.message || 'Failed to save vehicle rates.'); }
    finally { setSaving(false); }
  };
  const table = (rows, managing = false) => <div className="vehicle-table-scroll"><table className="vehicle-rate-table">
    <thead><tr>{fields.map(([key, label]) => <th key={key} scope="col">{label}</th>)}{managing && <th scope="col">Actions</th>}</tr></thead>
    <tbody>{rows.length === 0 ? <tr><td className="vehicle-table-empty" colSpan={managing ? 6 : 5}>No vehicle rates configured.</td></tr> : rows.map((item, index) => <tr key={index}>
      <td>{item.name}</td><td>{item.capacityKg} kg</td><td>{money(item.baseRate)}</td><td>{money(item.perKmRate)}</td><td>{money(item.freeDeliverySubtotal)}</td>
      {managing && <td><div className="vehicle-row-actions"><button type="button" className="btn operations-cancel" disabled={disabled} aria-label={`Edit ${item.name}`} onClick={() => {
        setEditing(index); setVehicle({ ...item }); setError('');
      }}><Pencil size={16} /></button><button type="button" className="btn operations-cancel" aria-label={`Remove ${item.name}`} onClick={() => remove(index)}><Trash2 size={16} /></button></div></td>}
    </tr>)}</tbody>
  </table></div>;
  return <>
    <div className="settings-card">
      <h2 className="card-title">Delivery Fee &amp; Vehicle Rate Matrix</h2>
      {table(current)}
      {isAdmin && <div className="card-actions"><button type="button" className="btn btn-primary" disabled={disabled} onClick={() => open()}>Edit</button></div>}
    </div>
    <dialog ref={dialog} className="operations-dialog vehicle-rate-dialog" aria-labelledby="vehicle-rates-title" onCancel={event => { if (saving) event.preventDefault(); }}>
      <h2 id="vehicle-rates-title">Delivery Fee &amp; Vehicle Rate Matrix</h2>
      <p className="operations-help">Add vehicles or use the pencil and trash icons to manage rates. Save to keep your changes.</p>
      <fieldset className="operations-fields" disabled={saving}>
        <div className="vehicle-matrix-toolbar">
          <button type="button" className="btn btn-primary" disabled={draft.length >= 100} onClick={() => { setEditing(-1); setVehicle(Object.fromEntries(fields.map(([key]) => [key, '']))); setError(''); }}>+ Add Vehicle</button>
        </div>
        {table(draft, true)}
        <div className="card-actions"><button type="button" className="btn operations-cancel" onClick={() => dialog.current.close()}>Cancel</button><button type="button" className="btn btn-primary" onClick={save}>{saving ? 'Saving...' : 'Save'}</button></div>
      </fieldset>
      {!vehicle && error && <p className="operations-error" role="alert">{error}</p>}
    </dialog>
    <dialog ref={vehicleDialog} className="operations-dialog vehicle-editor-dialog" aria-labelledby="vehicle-editor-title" onCancel={() => {setVehicle(null); setError('');}}>
      <h2 id="vehicle-editor-title">{editing === -1 ? 'Add Vehicle' : 'Edit Vehicle'}</h2>
      <p className="operations-help">Enter the vehicle class, maximum weight and delivery rates. All fields are required.</p>
      {vehicle && <form className="vehicle-editor-form" onSubmit={event => { event.preventDefault(); applyVehicle(); }}>
          <div className="vehicle-editor-fields">{fields.map(([key, label]) => <div className="form-group" key={key}>
            <label htmlFor={`vehicle-${key}`}>{label}</label>
            <input id={`vehicle-${key}`} className="form-control" required type={key === 'name' ? 'text' : 'number'}
              {...(key === 'name' ? { maxLength: 100 } : { min: 0, max: 9999999999.99, step: 'any' })}
              value={vehicle[key]} onChange={event => setVehicle(prev => ({ ...prev, [key]: event.target.value }))} />
          </div>)}</div>
          <p className="operations-help vehicle-draft-help">Save the matrix after applying this vehicle to keep your changes.</p>
          <div className="card-actions"><button type="button" className="btn operations-cancel" onClick={() => {setVehicle(null); setError('');}}>Cancel</button><button className="btn btn-primary" type="submit">{editing === -1 ? 'Add Vehicle' : 'Apply Changes'}</button></div>
        </form>}
      {error && <p className="operations-error" role="alert">{error}</p>}
    </dialog>
    <dialog ref={deleteDialog} className="operations-dialog vehicle-delete-dialog" aria-labelledby="vehicle-delete-title" aria-describedby="vehicle-delete-description" onCancel={() => setPendingDelete(null)}>
      <h2 id="vehicle-delete-title">Delete Confimation</h2>
      <p id="vehicle-delete-description">Remove <strong>{pendingDelete !== null ? draft[pendingDelete]?.name : ''}</strong> from the Delivery Fee &amp; Vehicle Rate Matrix?</p>
      <p className="operations-help">Existing transactions and their saved delivery fees will be kept. This change takes effect when you save the matrix.</p>
      <div className="card-actions">
        <button type="button" className="btn operations-cancel" autoFocus onClick={cancelDelete}>Cancel</button>
        <button type="button" className="btn vehicle-delete-confirm" onClick={confirmDelete}>Delete</button>
      </div>
    </dialog>
  </>;
}
