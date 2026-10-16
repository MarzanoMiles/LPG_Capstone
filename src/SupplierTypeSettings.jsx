import { useState } from 'react';
import { Pencil, Trash2, X } from 'lucide-react';
import { apiRequest } from './api';
import DeleteSupplierTypeModal from './DeleteSupplierTypeModal';

export default function SupplierTypeSettings({ types, onChanged, onClose }) {
  const [name, setName] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [typeToDelete, setTypeToDelete] = useState(null);
  async function save(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError('');
    try {
      const result = await apiRequest(editingId ? `/suppliers/types/${editingId}` : '/suppliers/types', {
        method: editingId ? 'PUT' : 'POST', body: JSON.stringify({ name: name.trim() }),
      });
      await onChanged({ ...result, action: editingId ? 'edit' : 'add' });
      setName(''); setEditingId(null);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  async function remove(type) {
    if (busy) return;
    setBusy(true); setError('');
    try {
      await apiRequest(`/suppliers/types/${type.id}`, { method: 'DELETE' });
      await onChanged({ id: type.id, action: 'delete' });
      if (editingId === type.id) { setName(''); setEditingId(null); }
    } finally { setBusy(false); }
  }
  return <div className="supplier-type-settings-overlay">
    <div className="supplier-type-settings-card" role="dialog" aria-modal="true" aria-labelledby="supplier-type-settings-title">
      <div className="supplier-type-settings-header"><h3 id="supplier-type-settings-title">Supplier Types</h3><button type="button" aria-label="Close supplier type settings" disabled={busy} onClick={onClose}><X size={18}/></button></div>
      <p className="supplier-type-help">Manage the options available when adding or editing a supplier.</p>
      {error && <p className="supplier-type-error" role="alert">{error}</p>}
      <form className="supplier-type-editor" onSubmit={save}>
        <label htmlFor="supplier-type-name">{editingId ? 'Edit Type' : 'New Type'}</label>
        <div><input id="supplier-type-name" required maxLength={80} value={name} disabled={busy} onChange={e => setName(e.target.value)} placeholder="Enter supplier type"/><button type="submit" disabled={busy || !name.trim()}>{busy ? 'Saving...' : editingId ? 'Save' : 'Add'}</button></div>
        {editingId && <button className="supplier-type-cancel-edit" type="button" disabled={busy} onClick={() => { setName(''); setEditingId(null); }}>Cancel editing</button>}
      </form>
      <ul className="supplier-type-list">{types.map(type => <li key={type.id}>
        <div><span>{type.name}</span><small>{Number(type.usageCount)} supplier{Number(type.usageCount) === 1 ? '' : 's'}</small></div>
        <div><button type="button" aria-label={`Edit ${type.name}`} disabled={busy} onClick={() => { setEditingId(type.id); setName(type.name); setError(''); }}><Pencil size={16}/></button><button type="button" aria-label={`Delete ${type.name}`} disabled={busy || Number(type.usageCount) > 0} title={Number(type.usageCount) > 0 ? 'Reassign suppliers before deleting this type' : 'Delete type'} onClick={() => setTypeToDelete(type)}><Trash2 size={16}/></button></div>
      </li>)}</ul>
      {!types.length && <p className="supplier-type-help">No supplier types yet. Add an option above.</p>}
      <button className="supplier-type-done" type="button" disabled={busy} onClick={onClose}>Done</button>
    </div>
    {typeToDelete && <DeleteSupplierTypeModal type={typeToDelete} onClose={() => setTypeToDelete(null)} onConfirm={remove}/>}
  </div>;
}
