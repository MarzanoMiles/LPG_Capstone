import { useCallback, useEffect, useRef, useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { apiRequest } from './api';
import './AddProductModal.css';
import './UserSettingsModal.css';

const definitions = {
  roles: { title: 'Manage Roles', label: 'Role', fields: [['name', 'Role Name']] },
  branches: { title: 'Manage Branches', label: 'Branch', fields: [['name', 'Branch Name'], ['address', 'Address'], ['contact', 'Contact No.']] },
  warehouses: { title: 'Manage Warehouses', label: 'Warehouse', fields: [['name', 'Warehouse Name'], ['location', 'Location'], ['branchId', 'Branch']] },
};

export default function UserSettingsModal({ kind, branches, onClose, onChanged }) {
  const config = definitions[kind];
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState({});
  const [deleting, setDeleting] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const cancelDeleteRef = useRef(null);
  const nameRef = useRef(null);

  const load = useCallback(() => apiRequest(`/user-settings/${kind}`).then(setRows), [kind]);
  useEffect(() => {
    load().catch(e => setError(e.message)).finally(() => setLoading(false));
  }, [load]);
  useEffect(() => {
    if (!deleting) return;
    const previousFocus = document.activeElement;
    cancelDeleteRef.current?.focus();
    return () => previousFocus?.focus();
  }, [deleting]);

  const cancelDelete = () => { setDeleting(null); setError(''); };
  const mutate = async (method, row) => {
    setBusy(true);
    setError('');
    try {
      await apiRequest(`/user-settings/${kind}${row?.id ? `/${row.id}` : ''}`, {
        method,
        ...(method === 'DELETE' ? {} : { body: JSON.stringify(row) }),
      });
      await load();
      await onChanged();
      // Deleting a different record should not discard an edit in progress.
      if (method !== 'DELETE' || form.id === row.id) setForm({});
      setDeleting(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="add-product-modal-overlay lookup-overlay user-manage-overlay" onClick={e => e.stopPropagation()}>
      <div className={`add-product-modal-card user-manage-card ${kind === 'roles' ? 'user-manage-roles' : ''}`}
        role="dialog" aria-modal={!deleting} aria-labelledby="user-manage-title" inert={Boolean(deleting)}
        onKeyDown={e => { if (e.key === 'Escape' && !busy && !deleting) { e.stopPropagation(); onClose(); } }}>
        <h2 id="user-manage-title" className="add-product-title">{config.title}</h2>
        {error && !deleting && <p className="user-manage-error" role="alert">{error}</p>}

        <form className="add-product-form" onSubmit={e => {
          e.preventDefault();
          const values = Object.fromEntries(config.fields.map(([key]) => [key, (form[key] || '').trim()]));
          mutate(form.id ? 'PUT' : 'POST', { ...values, ...(form.id ? { id: form.id } : {}) });
        }}>
          <div className="user-manage-fields">
            {config.fields.map(([key, label]) => (
              <div className="form-field" key={key}>
                <label htmlFor={`user-manage-${key}`}>{label}</label>
                {key === 'branchId' ? (
                  <select id={`user-manage-${key}`} disabled={busy || loading} value={form[key] || ''}
                    onChange={e => setForm({ ...form, [key]: e.target.value })}>
                    <option value="">Unassigned</option>
                    {branches.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
                  </select>
                ) : (
                  <input id={`user-manage-${key}`} ref={key === 'name' ? nameRef : undefined}
                    required={key !== 'contact'} disabled={busy || loading}
                    maxLength={key === 'name' ? (kind === 'roles' ? 50 : 100) : key === 'contact' ? 30 : 255}
                    placeholder={key === 'contact' ? 'Optional' : `Enter ${label.toLowerCase()}`}
                    value={form[key] || ''} onChange={e => setForm({ ...form, [key]: e.target.value })} />
                )}
              </div>
            ))}
          </div>
          <div className="lookup-form-actions">
            {form.id && <button type="button" className="btn-modal-cancel" disabled={busy} onClick={() => {
              setForm({}); setError(''); nameRef.current?.focus();
            }}>Cancel</button>}
            <button type="submit" className="btn-modal-add" disabled={busy || loading}>
              {busy ? 'Saving...' : form.id ? 'Save Changes' : `Add ${config.label}`}
            </button>
          </div>
        </form>

        <div className="user-manage-table-wrap">
          <table className="user-manage-table">
            <thead><tr>
              {config.fields.map(([key, label]) => <th key={key}>{label}</th>)}
              <th className="user-manage-actions-heading">Actions</th>
            </tr></thead>
            <tbody>
              {rows.map(row => <tr key={row.id}>
                {config.fields.map(([key]) => <td key={key}>
                  {key === 'branchId' ? branches.find(branch => branch.id === row[key])?.name || 'Unassigned' : row[key] || '\u2014'}
                </td>)}
                <td><div className="user-manage-row-actions">
                  <button type="button" disabled={busy || loading} aria-label={`Edit ${row.name}`} title="Edit" onClick={() => {
                    setForm(row); setError(''); nameRef.current?.focus();
                  }}><Pencil size={16} /></button>
                  <button type="button" disabled={busy || loading} aria-label={`Delete ${row.name}`} title="Delete" onClick={() => {
                    setError(''); setDeleting(row);
                  }}><Trash2 size={16} /></button>
                </div></td>
              </tr>)}
              {(loading || !rows.length) && <tr><td colSpan={config.fields.length + 1} className="user-manage-empty">
                {loading ? 'Loading...' : `No ${kind} found.`}
              </td></tr>}
            </tbody>
          </table>
        </div>

        <div className="lookup-form-actions">
          <button type="button" className="btn-modal-cancel" disabled={busy} onClick={onClose}>Close</button>
        </div>
      </div>

      {deleting && <div className="add-product-modal-overlay lookup-delete-overlay">
        <div className="add-product-modal-card lookup-delete-card" role="alertdialog" aria-modal="true"
          aria-labelledby="user-manage-delete-title" aria-describedby="user-manage-delete-description" onKeyDown={event => {
            if (event.key === 'Escape' && !busy) { event.preventDefault(); cancelDelete(); }
            if (event.key === 'Tab') {
              const buttons = [...event.currentTarget.querySelectorAll('button:not(:disabled)')];
              const first = buttons[0]; const last = buttons[buttons.length - 1];
              if (!first) { event.preventDefault(); return; }
              if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
              else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
            }
          }}>
          <h2 id="user-manage-delete-title" className="add-product-title">Delete {config.label}</h2>
          <div id="user-manage-delete-description">
            <p>Are you sure you want to delete <strong>{deleting.name}</strong>?</p>
            <p>This action cannot be undone. Entries assigned to users or operational records cannot be deleted.
              {kind === 'roles' && ' System roles cannot be deleted.'}</p>
          </div>
          {error && <p role="alert" className="lookup-delete-error">{error}</p>}
          <div className="lookup-form-actions">
            <button ref={cancelDeleteRef} type="button" className="btn-modal-cancel" disabled={busy} onClick={cancelDelete}>Cancel</button>
            <button type="button" className="btn-modal-add lookup-delete-confirm" disabled={busy} onClick={() => mutate('DELETE', deleting)}>
              {busy ? 'Deleting...' : 'Delete'}
            </button>
          </div>
        </div>
      </div>}
    </div>
  );
}
