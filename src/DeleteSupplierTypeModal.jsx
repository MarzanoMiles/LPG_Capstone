import { useEffect, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';

export default function DeleteSupplierTypeModal({ type, onClose, onConfirm }) {
  const dialog = useRef(null);
  const submitting = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { dialog.current.showModal(); }, []);
  async function confirm() {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true); setError('');
    try { await onConfirm(type); onClose(); }
    catch (err) { setError(err.message || 'Could not delete supplier type. Please try again.'); }
    finally { submitting.current = false; setBusy(false); }
  }
  return <dialog ref={dialog} className="supplier-type-delete-dialog" aria-labelledby="supplier-type-delete-title" aria-describedby="supplier-type-delete-description" onCancel={event => { event.preventDefault(); if (!submitting.current) onClose(); }}>
    <div className="supplier-type-delete-icon"><Trash2 size={24} aria-hidden="true"/></div>
    <h3 id="supplier-type-delete-title">Delete Supplier Type?</h3>
    <p className="supplier-type-delete-name">{type.name}</p>
    <p id="supplier-type-delete-description">This will permanently remove this option from the Supplier Type list. This action cannot be undone.</p>
    {error && <p className="supplier-type-error" role="alert">{error}</p>}
    <div className="supplier-type-delete-actions">
      <button type="button" autoFocus disabled={busy} onClick={onClose}>Cancel</button>
      <button type="button" className="supplier-type-delete-confirm" disabled={busy} onClick={confirm}>{busy ? 'Deleting...' : 'Delete Type'}</button>
    </div>
  </dialog>;
}
