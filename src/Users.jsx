import PageLayout, { PageHeader } from "./PageLayout";
import Pagination from "./Pagination";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Search,
  ChevronDown,
  Plus,
  FileSearch,
  Pencil,
  Trash2,
  X,
} from "lucide-react";
import AddUserModal from "./AddUserModal";
import { isVisibleWarehouseName } from "./utils/warehouseFilters";
import { apiRequest } from "./api";
import { formatTimestampManila } from "./utils/datetime";
import "./Users.css";

const PAGE_SIZE = 5;
const ACTIVITY_PAGE_SIZE = 5;



const ROLE_OPTIONS = [
  "Administrator",
  "Operations Supervisor",
  "Assistant Operations Supervisor",
  "Store Supervisor",
  "Assistant Store Supervisor",
  "Stockman",
  "Head Maintenance",
  "Drivers",
  "Helpers",
  "Customer",
];

// ---------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------

function StatusPill({ status }) {
  const className = status === "Active" ? "status-pill active" : "status-pill inactive";
  return <span className={className}>{status}</span>;
}

function FilterSelect({ value, onChange, options }) {
  return (
    <div className="filter-select-wrap">
      <select className="filter-select" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((opt) => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>
      <ChevronDown size={16} className="filter-select-icon" />
    </div>
  );
}

function ViewUserModal({ user, onClose }) {
  if (!user) return null;
  const modules = user.moduleAccess || {};
  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(17,24,39,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}
      onClick={onClose}
    >
      <div
        style={{ background: "#fff", borderRadius: 12, padding: "24px 28px", width: "100%", maxWidth: 420, boxShadow: "0 20px 50px rgba(0,0,0,0.2)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ fontSize: "1.25rem", fontWeight: 800, margin: 0 }}>User Details</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer" }}>
            <X size={20} />
          </button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 16, fontSize: "0.9rem" }}>
          <div><strong>User ID:</strong> {user.id}</div>
          <div><strong>Full Name:</strong> {user.name}</div>
          <div><strong>Email:</strong> {user.email}</div>
          <div><strong>Role:</strong> {user.role}</div>
          <div><strong>Branch:</strong> {user.branch || "—"}</div>
          <div><strong>Status:</strong> {user.status}</div>
          <div><strong>Created:</strong> {new Date(user.createdAt).toLocaleString()}</div>
          <div>
            <strong>Module Access:</strong>{" "}
            {Object.entries(modules).filter(([, v]) => v).map(([k]) => k).join(", ") || "None"}
          </div>
        </div>
        <button
          onClick={onClose}
          style={{ marginTop: 20, width: "100%", padding: "10px 0", borderRadius: 8, border: "none", background: "#e5e7eb", color: "#111827", fontWeight: 700, cursor: "pointer" }}
        >
          Close
        </button>
      </div>
    </div>
  );
}

function DeleteUserModal({ user, busy, error, onCancel, onConfirm }) {
  const dialog = useRef(null);
  useEffect(() => {
    const element = dialog.current;
    element.showModal();
    return () => element.close();
  }, []);
  return (
    <dialog ref={dialog} className="user-delete-dialog" aria-labelledby="delete-user-title" aria-describedby="delete-user-description"
      onCancel={event => { event.preventDefault(); if (!busy) onCancel(); }}>
      <h2 id="delete-user-title">Delete user?</h2>
      <p id="delete-user-description">Delete <strong>{user.name}</strong>? They will be removed from the Users list and will no longer be able to sign in. Their activity logs and transaction history will be preserved.</p>
      {error && <p className="user-delete-error" role="alert">{error}</p>}
      <div className="user-delete-buttons">
        <button type="button" disabled={busy} onClick={onCancel} autoFocus>Cancel</button>
        <button type="button" className="user-delete-confirm" disabled={busy} onClick={onConfirm}>{busy ? "Deleting..." : "Confirm Delete"}</button>
      </div>
    </dialog>
  );
}

// ---------------------------------------------------------------------------
// Main Users component
// ---------------------------------------------------------------------------

export default function Users() {
  const [users, setUsers] = useState([]);
  const [activityLog, setActivityLog] = useState([]);
  const [activityTotal, setActivityTotal] = useState(0);
  const [activeTab, setActiveTab] = useState("users");
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");

  const [searchTerm, setSearchTerm] = useState("");
  const [roleFilter, setRoleFilter] = useState("All Roles");
  const [statusFilter, setStatusFilter] = useState("All Status");
  const [branchFilter, setBranchFilter] = useState("All Warehouse");
  const [page, setPage] = useState(1);

  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [viewingUser, setViewingUser] = useState(null);
  const [deletingUser, setDeletingUser] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const deleteInFlight = useRef(false);

  const [activitySearchTerm, setActivitySearchTerm] = useState("");
  const [activityModule, setActivityModule] = useState("");
  const [activityAction, setActivityAction] = useState("");
  const [activityPage, setActivityPage] = useState(1);

  const loadUsers = () => {
    setIsLoading(true);
    apiRequest("/users")
      .then((data) => {
        setUsers(data);
        setLoadError("");
      })
      .catch((err) => setLoadError(err.message || "Failed to load users."))
      .finally(() => setIsLoading(false));
  };

  const loadActivityLog = useCallback(({ page: targetPage = activityPage, search = activitySearchTerm } = {}) => {
    const params = new URLSearchParams({
      page: String(targetPage),
      pageSize: String(ACTIVITY_PAGE_SIZE),
    });
    if (search) params.set("search", search);
    if (activityModule) params.set("module", activityModule);
    if (activityAction) params.set("action", activityAction);

    apiRequest("/users/activity-log?" + params.toString())
      .then((data) => {
        setActivityLog(data.rows || []);
        setActivityTotal(Number(data.total || 0));
        const safePage = Math.max(1, Number(data.page) || 1);
        if (safePage !== activityPage) {
          setActivityPage(safePage);
        }
      })
      .catch((err) => setLoadError(err.message || "Failed to load activity log."));
  }, [activityPage, activitySearchTerm, activityModule, activityAction]);

  useEffect(() => {
    loadUsers();
  }, []);

  useEffect(() => {
    loadActivityLog();
  }, [loadActivityLog]);

  const roles = useMemo(() => {
    const existing = new Set(users.map((u) => u.role).filter(Boolean));
    const ordered = [...ROLE_OPTIONS, ...[...existing].filter((r) => !ROLE_OPTIONS.includes(r))];
    return ["All Roles", ...ordered];
  }, [users]);
  const statuses = ["All Status", "Active", "Inactive"];
  const branches = useMemo(
    () => [
      "All Warehouse",
      ...new Set(users.map((u) => u.branch).filter((branch) => branch && isVisibleWarehouseName(branch))),
    ],
    [users]
  );

  const filteredUsers = useMemo(() => {
    return users.filter((u) => {
      const term = searchTerm.toLowerCase();
      const matchesSearch = u.name.toLowerCase().includes(term) || u.email.toLowerCase().includes(term);
      const matchesRole = roleFilter === "All Roles" || u.role === roleFilter;
      const matchesStatus = statusFilter === "All Status" || u.status === statusFilter;
      const matchesBranch = branchFilter === "All Warehouse" || u.branch === branchFilter;
      return matchesSearch && matchesRole && matchesStatus && matchesBranch;
    });
  }, [users, searchTerm, roleFilter, statusFilter, branchFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredUsers.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paginatedUsers = filteredUsers.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const goToPage = (p) => {
    if (p < 1 || p > totalPages) return;
    setPage(p);
  };

  const activityTotalPages = Math.max(1, Math.ceil(activityTotal / ACTIVITY_PAGE_SIZE));
  const activityCurrentPage = Math.min(activityPage, activityTotalPages);
  const goToActivityPage = (p) => {
    if (p < 1 || p > activityTotalPages) return;
    setActivityPage(p);
  };

  const handleAddUser = () => {
    setEditingUser(null);
    setShowAddUserModal(true);
  };

  const handleEdit = (user) => {
    setEditingUser(user);
    setShowAddUserModal(true);
  };

  const handleView = (user) => setViewingUser(user);

  const handleDelete = async () => {
    if (!deletingUser || deleteInFlight.current) return;
    deleteInFlight.current = true;
    setIsDeleting(true);
    setActionError("");
    try {
      await apiRequest(`/users/${deletingUser.id}`, { method: "DELETE" });
      setUsers(previous => previous.filter(user => user.id !== deletingUser.id));
      setDeletingUser(null);
      loadUsers();
      loadActivityLog();
    } catch (err) {
      setActionError(err.message || "Failed to delete user.");
    } finally {
      deleteInFlight.current = false;
      setIsDeleting(false);
    }
  };

  return (
    <PageLayout className="users-page" contentClassName="users-inner">

        <PageHeader title="Users" />

        {loadError && <p style={{ color: "#dc2626", fontWeight: 600 }}>{loadError}</p>}
        {actionError && !deletingUser && <p style={{ color: "#dc2626", fontWeight: 600 }}>{actionError}</p>}

        {/* Tabs */}
        <div className="users-tabs">
          <span
            className={`users-tab ${activeTab === "users" ? "active" : ""}`}
            onClick={() => setActiveTab("users")}
          >
            Users
          </span>
          <span
            className={`users-tab ${activeTab === "activity" ? "active" : ""}`}
            onClick={() => setActiveTab("activity")}
          >
            Activity Log
          </span>
        </div>

        {activeTab === "users" ? (
          <>
            {/* Toolbar */}
            <div className="users-toolbar">
              <div className="users-search">
                <input
                  type="text"
                  placeholder="Search by Full Name or Email"
                  value={searchTerm}
                  onChange={(e) => { setSearchTerm(e.target.value); setPage(1); }}
                  className="users-search-input"
                />
                <Search size={16} className="users-search-icon" />
              </div>

              <FilterSelect value={roleFilter} onChange={(v) => { setRoleFilter(v); setPage(1); }} options={roles} />
              <FilterSelect value={statusFilter} onChange={(v) => { setStatusFilter(v); setPage(1); }} options={statuses} />
              <FilterSelect value={branchFilter} onChange={(v) => { setBranchFilter(v); setPage(1); }} options={branches} />

              <button type="button" className="add-user-btn" onClick={handleAddUser}>
                <Plus size={16} />
                Add User
              </button>
            </div>

            {/* Table */}
            <div className="users-table-wrap">
              <div className="paginated-table-scroll">
                <table className="users-table">
                  <thead>
                    <tr>
                      <th>User ID</th>
                      <th>Full Name</th>
                      <th>Username/Email</th>
                      <th>Role</th>
                      <th>Branch / Warehouse</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {isLoading && (
                      <tr><td colSpan={7} className="no-results-cell">Loading...</td></tr>
                    )}
                    {!isLoading && paginatedUsers.map((user) => (
                      <tr key={user.id}>
                        <td>{user.id}</td>
                        <td>{user.name}</td>
                        <td>{user.email}</td>
                        <td>{user.role}</td>
                        <td>{user.branch || "—"}</td>
                        <td><StatusPill status={user.status} /></td>
                        <td>
                          <div className="action-icons">
                            <button
                              type="button"
                              className="action-icon view"
                              aria-label={`View ${user.name}`}
                              onClick={() => handleView(user)}
                            >
                              <FileSearch size={16} />
                            </button>
                            <button
                              type="button"
                              className="action-icon edit"
                              aria-label={`Edit ${user.name}`}
                              onClick={() => handleEdit(user)}
                            >
                              <Pencil size={16} />
                            </button>
                            <button
                              type="button"
                              className="action-icon delete"
                              aria-label={`Delete ${user.name}`}
                              onClick={() => { setActionError(""); setDeletingUser(user); }}
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {!isLoading && paginatedUsers.length === 0 && (
                      <tr>
                        <td colSpan={7} className="no-results-cell">
                          No users match your filters.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={goToPage} />
            </div>
          </>
        ) : (
          <>
            {/* Toolbar */}
            <div className="users-toolbar">
              <div className="users-search">
                <input
                  type="text"
                  placeholder="Search user, module, target or description"
                  value={activitySearchTerm}
                  onChange={(e) => { setActivitySearchTerm(e.target.value); setActivityPage(1); }}
                  className="users-search-input"
                />
                <Search size={16} className="users-search-icon" />
              </div>
              <input className="filter-select" aria-label="Filter module" placeholder="Exact module" value={activityModule} onChange={e => {setActivityModule(e.target.value);setActivityPage(1);}} />
              <select className="filter-select" aria-label="Filter action" value={activityAction} onChange={e => {setActivityAction(e.target.value);setActivityPage(1);}}><option value="">All Actions</option>{['Login','Logout','View','Preview','Create','Update','Delete','Approve','Reject','Dispatch','Complete','Failed Attempt','Settle','Cancel','Receive','Refund','Claim','Generate','Send','Send Payment','Import','Export','Access Denied','Action'].map(a => <option key={a}>{a}</option>)}</select>
            </div>

            {/* Table */}
            <div className="users-table-wrap">
              <div className="paginated-table-scroll">
                <table className="users-table activity-log-table">
                  <thead>
                    <tr>
                      <th>User ID</th>
                      <th>Full Name</th>
                      <th>Target Record ID</th>
                      <th>Module</th>
                      <th>Action</th>
                      <th>Description</th>
                      <th>Outcome</th>
                      <th>Date and Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activityLog.map((entry) => (
                      <tr key={entry.id}>
                        <td className="activity-log-cell-id">{entry.userId}</td>
                        <td className="activity-log-cell-name">{entry.name}</td>
                        <td className="activity-log-cell-role">{entry.targetId || "?"}</td>
                        <td className="activity-log-cell-module" title={entry.module}>{entry.module}</td>
                        <td>{entry.action}</td>
                        <td>{entry.description}</td>
                        <td>{entry.outcome || 'Success'}</td>
                        <td className="activity-log-cell-date">{formatTimestampManila(entry.datetime)}</td>
                      </tr>
                    ))}
                    {activityLog.length === 0 && (
                      <tr>
                        <td colSpan={8} className="no-results-cell">
                          No activity matches your search.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              <Pagination currentPage={activityCurrentPage} totalPages={activityTotalPages} onPageChange={goToActivityPage} />
            </div>
          </>
        )}


      <AddUserModal
        isOpen={showAddUserModal}
        selectedUser={editingUser}
        onCancel={() => {
          setShowAddUserModal(false);
          setEditingUser(null);
        }}
        onSaved={() => {
          loadUsers();
          loadActivityLog();
        }}
      />

      {deletingUser && <DeleteUserModal user={deletingUser} busy={isDeleting} error={actionError}
        onCancel={() => { if (!deleteInFlight.current) { setDeletingUser(null); setActionError(""); } }} onConfirm={handleDelete} />}
      <ViewUserModal user={viewingUser} onClose={() => setViewingUser(null)} />
    </PageLayout>
  );
}









