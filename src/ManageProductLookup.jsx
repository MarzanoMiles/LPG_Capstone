import React, { useEffect, useRef, useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { apiRequest } from "./api";

export default function ManageProductLookup({ label, endpoint, onClose, onChanged }) {
  const cancelDeleteRef = useRef(null);
  const [items, setItems] = useState([]);
  const [name, setName] = useState("");
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { apiRequest(`/${endpoint}`).then(setItems).catch(e => setError(e.message)); }, [endpoint]);
  useEffect(() => {
    if (!deleting) return;
    const previousFocus = document.activeElement;
    cancelDeleteRef.current?.focus();
    return () => previousFocus?.focus();
  }, [deleting]);
  const cancelDelete = () => { setDeleting(null); setError(""); };
  const mutate = async (method, id, body) => {
    setBusy(true); setError("");
    try {
      await apiRequest(`/${endpoint}${id ? `/${id}` : ""}`, { method, ...(body ? {body: JSON.stringify(body)} : {}) });
      const updated = await apiRequest(`/${endpoint}`);
      setItems(updated); onChanged(updated); setName(""); setEditing(null); setDeleting(null);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  return <div className="add-product-modal-overlay lookup-overlay">
    <div className="add-product-modal-card" role="dialog" aria-modal={!deleting} aria-label={`Manage ${label}`} inert={Boolean(deleting)}>
      <h2 className="add-product-title">Manage {label}</h2>
      {error && !deleting && <p role="alert" style={{color: '#dc2626'}}>{error}</p>}
      <form className="add-product-form" onSubmit={e => { e.preventDefault(); mutate(editing ? 'PUT' : 'POST', editing, {name: name.trim()}); }}>
        <div className="form-field"><label htmlFor="lookupName">{label} name</label><input id="lookupName" required maxLength={100} value={name} onChange={e => setName(e.target.value)} /></div>
        <div className="lookup-form-actions">
          {editing && <button type="button" className="btn-modal-cancel" disabled={busy} onClick={() => {setEditing(null); setName(''); setError('');}}>Cancel</button>}
          <button type="submit" className="btn-modal-add" disabled={busy}>{busy ? 'Saving...' : editing ? 'Save Changes' : `Add ${label}`}</button>
        </div>
      </form>
      <ul className="lookup-list">{items.map(item => <li key={item.id}><span>{item.name}</span><button disabled={busy} aria-label={`Edit ${item.name}`} onClick={() => {setEditing(item.id); setName(item.name);}}><Pencil size={16}/></button><button disabled={busy} aria-label={`Delete ${item.name}`} onClick={() => { setError(""); setDeleting(item); }}><Trash2 size={16}/></button></li>)}</ul>

      <div className="lookup-form-actions"><button type="button" className="btn-modal-cancel" disabled={busy} onClick={onClose}>Close</button></div>
    </div>
    {deleting && <div className="add-product-modal-overlay lookup-delete-overlay">
      <div className="add-product-modal-card lookup-delete-card" role="alertdialog" aria-modal="true" aria-labelledby="lookup-delete-title" aria-describedby="lookup-delete-description" onKeyDown={event => {
        if (event.key === 'Escape' && !busy) { event.preventDefault(); cancelDelete(); }
        if (event.key === 'Tab') {
          const buttons = [...event.currentTarget.querySelectorAll('button:not(:disabled)')];
          const first = buttons[0]; const last = buttons[buttons.length - 1];
          if (!first) { event.preventDefault(); return; }
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
      }}>
        <h2 id="lookup-delete-title" className="add-product-title">Delete {label}</h2>
        <div id="lookup-delete-description">
          <p>Are you sure you want to delete <strong>{deleting.name}</strong>?</p>
          <p>This action cannot be undone. Entries used by products must be reassigned before deletion.</p>
        </div>
        {error && <p role="alert" className="lookup-delete-error">{error}</p>}
        <div className="lookup-form-actions">
          <button ref={cancelDeleteRef} type="button" className="btn-modal-cancel" disabled={busy} onClick={cancelDelete}>Cancel</button>
          <button type="button" className="btn-modal-add lookup-delete-confirm" disabled={busy} onClick={() => mutate('DELETE', deleting.id)}>{busy ? 'Deleting...' : 'Delete'}</button>
        </div>
      </div>
    </div>}
  </div>;
}
