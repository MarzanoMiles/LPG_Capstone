import React, { useEffect, useState } from "react";
import { ChevronDown, Settings, LockKeyhole } from "lucide-react";
import "./AddUserModal.css";
import { apiRequest } from "./api";
import { normalizeModuleAccess } from './rbac';
import UserSettingsModal from "./UserSettingsModal";

const moduleOptions = [
  { key: "dashboard", label: "Dashboard" },
  { key: "pos", label: "POS Terminal" },
  { key: "inventory", label: "Inventory" },
  { key: "products", label: "Products" },
  { key: "sales", label: "Sales" },
  { key: "restocking", label: "Restocking" },
  { key: "orders", label: "Order and Delivery" },
  { key: "suppliers", label: "Suppliers" },
  { key: "report", label: "Report and Compliance" },
  { key: "data", label: "Data" },
  { key: "users", label: "Users" },
  { key: "settings", label: "Settings" },
];

const statusOptions = ["Active", "Inactive"];

const emptyForm = {
  firstName: "",
  lastName: "",
  usernameEmail: "",
  password: "",
  confirmPassword: "",
  role: "",
  roleId: "",
  warehouseId: "",
  branch: "",
  branchId: "",
  status: "Active",
  modules: {},
};

export default function AddUserModal({ isOpen, onCancel, onSaved, selectedUser }) {
  const [canEditAccess, setCanEditAccess] = useState(false);
  const [accessCheckError, setAccessCheckError] = useState('');
  const [roles, setRoles] = useState([]);
  const [branches, setBranches] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [settingsKind, setSettingsKind] = useState(null);
  const refreshOptions = () => Promise.all([apiRequest("/roles"), apiRequest("/user-settings/branches"), apiRequest("/user-settings/warehouses")]).then(([r,b,w]) => { setRoles(r); setBranches(b); setWarehouses(w);
    setForm(prev => {
      const selectedRole = r.find(x => x.id === prev.roleId);
      const selectedWarehouse = w.find(x => x.id === prev.warehouseId);
      return {...prev, role: selectedRole?.name || (prev.roleId ? '' : prev.role), branch: selectedWarehouse?.name || (prev.warehouseId ? '' : prev.branch), branchId: b.some(x => x.id === prev.branchId) ? prev.branchId : ''};
    }); });
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isEditing = Boolean(selectedUser);

  useEffect(() => {
    if (!isOpen) return;
    setError("");
    setCanEditAccess(false);
    setAccessCheckError('');
    let active = true;
    apiRequest('/auth/me').then(actor => {
      if (active) setCanEditAccess(['admin', 'administrator'].includes(String(actor.RoleName || '').trim().toLowerCase()));
    }).catch(err => {
      if (active) { setCanEditAccess(false); setAccessCheckError(err.message || 'Unable to verify access permissions. Reopen this form to retry.'); }
    });
    refreshOptions().catch(err => setError(err.message || "Failed to load assignments."));
    return () => { active = false; };
  }, [isOpen]);

  useEffect(() => {
    if (selectedUser) {
      setForm({
        firstName: selectedUser.firstName || "",
        lastName: selectedUser.lastName || "",
        usernameEmail: selectedUser.email || "",
        password: "",
        confirmPassword: "",
        role: selectedUser.role || "",
        roleId: selectedUser.roleId || "",
        warehouseId: selectedUser.warehouseId || "",
        branch: selectedUser.branch || "",
        branchId: selectedUser.branchId || "",
        status: selectedUser.status || "Active",
        modules: normalizeModuleAccess(selectedUser.moduleAccess),
      });
    } else {
      setForm(emptyForm);
    }
    setError("");
  }, [selectedUser, isOpen]);

  if (!isOpen) return null;

  const updateField = (field, value) => setForm((prev) => ({ ...prev, [field]: value,
    ...(field === 'role' ? {roleId: roles.find(r => r.name === value)?.id || ''} : {}),
    ...(field === 'branch' ? {warehouseId: warehouses.find(w => w.name === value)?.id || ''} : {}),
  }));
  const resetAndClose = () => {
    setForm(emptyForm);
    setError("");
    onCancel();
  };

  const handleSave = async () => {
    if (!form.firstName.trim() || !form.lastName.trim() || !form.usernameEmail.trim()) {
      setError("First name, last name, and email are required.");
      return;
    }
    if (!isEditing) {
      if (!form.password || !form.confirmPassword) {
        setError("Password and confirm password are required for a new user.");
        return;
      }
    }
    if (form.password && form.password !== form.confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    if (!form.role || !form.branch) {
      setError("Please select a role and branch/warehouse.");
      return;
    }

    if (!roles.length || !warehouses.length) {
      setError("Roles/branches are still loading. Please wait and try again.");
      return;
    }

    setError("");
    setIsSubmitting(true);
    try {
      if (isEditing) {
        const payload = {
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          role: form.role,
          branch: form.branch,
          branchId: form.branchId,
          status: form.status,
          ...(canEditAccess ? { modules: normalizeModuleAccess(form.modules) } : {}),
        };
        if (form.password) payload.password = form.password;
        await apiRequest(`/users/${selectedUser.id}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
      } else {
        await apiRequest("/users", {
          method: "POST",
          body: JSON.stringify({
            firstName: form.firstName.trim(),
            lastName: form.lastName.trim(),
            usernameEmail: form.usernameEmail,
            password: form.password,
            role: form.role,
            branch: form.branch,
            branchId: form.branchId,
            status: form.status,
            ...(canEditAccess ? { modules: normalizeModuleAccess(form.modules) } : {}),
          }),
        });
      }
      window.dispatchEvent(new Event('auth:access-updated'));
      onSaved?.();
      setForm(emptyForm);
      onCancel();
    } catch (err) {
      setError(err.message || "Failed to save user.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="add-user-overlay" onClick={resetAndClose}>
      <div className="add-user-modal user-form-modal" role="dialog" aria-modal="true" aria-labelledby="user-form-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="user-form-title" className="add-user-title">{isEditing ? "Edit User" : "New User Information"}</h2>

        {error && <p style={{ color: "#dc2626", fontWeight: 600, marginTop: -8, marginBottom: 12 }}>{error}</p>}

        {/* Basic Information */}
        <h3 className="add-user-section">BASIC INFORMATION</h3>
        <div className="add-user-grid two-col">
          <div className="field">
            <label className="field-label" htmlFor="user-first-name">First Name</label>
            <input id="user-first-name" autoComplete="given-name" className="field-input" maxLength={50} placeholder="Juan Miguel" value={form.firstName} onChange={e => updateField('firstName', e.target.value)} />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="user-last-name">Last Name</label>
            <input id="user-last-name" autoComplete="family-name" className="field-input" maxLength={50} placeholder="Dela Cruz" value={form.lastName} onChange={e => updateField('lastName', e.target.value)} />
          </div>
          <div className="field full-width">
            <label className="field-label" htmlFor="user-email">Email Address</label>
            <input id="user-email" type="email" autoComplete="email" className="field-input" placeholder="juan@example.com" value={form.usernameEmail} onChange={e => updateField('usernameEmail', e.target.value)} disabled={isEditing} />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="user-password">{isEditing ? 'New Password (optional)' : 'Password'}</label>
            <input id="user-password" type="password" autoComplete="new-password" className="field-input" placeholder="Enter password" value={form.password} onChange={e => updateField('password', e.target.value)} />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="user-confirm-password">{isEditing ? 'Confirm New Password' : 'Confirm Password'}</label>
            <input id="user-confirm-password" type="password" autoComplete="new-password" className="field-input" placeholder="Re-enter password" value={form.confirmPassword} onChange={e => updateField('confirmPassword', e.target.value)} />
          </div>
        </div>

        {/* Role & Assignment */}
        <h3 className="add-user-section">Role &amp; Assignment</h3>
        {!roles.length || !warehouses.length ? (
          <p style={{ color: "#6b7280", marginTop: 0 }}>Loading roles and branches…</p>
        ) : null}
        <div className="add-user-grid two-col">
          <div className="field">
            <label className="field-label">Role <button type="button" className="user-settings-gear" aria-label="Manage Roles" onClick={() => setSettingsKind("roles")}><Settings size={16}/></button></label>
            <div className="select-wrap">
              <select
                className="field-select"
                value={form.role}
                onChange={(e) => updateField("role", e.target.value)}
              >
                <option value="">Select role</option>
                {roles.map((r) => (
                  <option key={r.id} value={r.name}>{r.name}</option>
                ))}
              </select>
              <ChevronDown size={16} className="select-icon" />
            </div>
          </div>
          <div className="field">
            <label className="field-label">Branch <button type="button" className="user-settings-gear" aria-label="Manage Branches" onClick={() => setSettingsKind("branches")}><Settings size={16}/></button></label>
            <div className="select-wrap">
              <select className="field-select" value={form.branchId} onChange={e => setForm(prev => ({...prev, branchId:e.target.value, branch:'', warehouseId:''}))}>
                <option value="">Unassigned</option>{branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
              <ChevronDown size={16} className="select-icon" />
            </div>
          </div>
          <div className="field">
            <label className="field-label">Warehouse <button type="button" className="user-settings-gear" aria-label="Manage Warehouses" onClick={() => setSettingsKind("warehouses")}><Settings size={16}/></button></label>
            <div className="select-wrap">
              <select
                className="field-select"
                value={form.branch}
                onChange={(e) => updateField("branch", e.target.value)}
              >
                <option value="">Select Warehouse</option>
                {warehouses.filter(w => !w.branchId || w.branchId === form.branchId).map((b) => (
                  <option key={b.id} value={b.name}>{b.name}</option>
                ))}
              </select>
              <ChevronDown size={16} className="select-icon" />
            </div>
          </div>
          <div className="field">
            <label className="field-label">Status</label>
            <div className="select-wrap">
              <select
                className="field-select"
                value={form.status}
                onChange={(e) => updateField("status", e.target.value)}
              >
                {statusOptions.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <ChevronDown size={16} className="select-icon" />
            </div>
          </div>
        </div>

        {/* Module Access */}
        <div className="user-access-heading">
          <h3 className="add-user-section">Module Access</h3>
          <span>{moduleOptions.filter(m => form.modules[m.key]).length} of {moduleOptions.length} enabled</span>
        </div>
        <p id="user-access-help" className="user-access-help"><LockKeyhole size={14} aria-hidden="true" /> Toggle module access for this user.</p>
        {accessCheckError && <p role="alert" className="add-user-error">{accessCheckError}</p>}
        <div className="user-access-groups">
          {[
            {title: 'Sales & Operations', keys: ['pos', 'sales', 'orders', 'inventory', 'products', 'restocking', 'suppliers']},
            {title: 'Management & Administration', keys: ['dashboard', 'report', 'data', 'users', 'settings']},
          ].map(group => <section className="user-access-group" key={group.title} aria-label={group.title}>
            <h4>{group.title}</h4>
            <ul>{group.keys.map(key => {
              const enabled = !!form.modules[key];
              return <li key={key} className={enabled ? 'enabled' : 'restricted'}>
                <span id={`user-access-${key}`} className="user-access-module">{moduleOptions.find(m => m.key === key).label}</span>
                <label className="user-access-toggle" title={canEditAccess ? 'Change module access' : 'Only administrators can change module access'}>
                  <input type="checkbox" role="switch" checked={enabled} disabled={!canEditAccess || isSubmitting}
                    onChange={e => {
                      const checked = e.target.checked;
                      setForm(prev => ({...prev, modules: {...prev.modules, [key]: checked}}));
                    }}
                    aria-labelledby={`user-access-${key}`} aria-describedby="user-access-help" />
                  <span className="user-access-toggle-track" aria-hidden="true" />
                  <span className="user-access-toggle-state">{enabled ? 'On' : 'Off'}</span>
                </label>
              </li>;
            })}</ul>
          </section>)}
        </div>

        {/* Actions */}
        <div className="add-user-actions">
          <button type="button" className="add-user-btn cancel" onClick={resetAndClose}>
            Cancel
          </button>
          <button type="button" className="add-user-btn save" onClick={handleSave} disabled={isSubmitting}>
            {isSubmitting ? "Saving…" : isEditing ? "Save Changes" : "Save User"}
          </button>
        </div>
      </div>
      {settingsKind && <UserSettingsModal key={settingsKind} kind={settingsKind} branches={branches} onClose={() => setSettingsKind(null)} onChanged={refreshOptions} />}
    </div>
  );
}





