import React, { useEffect, useMemo, useState } from "react";
import {
  Search,
  ChevronDown,
  Plus,
  FileSearch,
  Pencil,
  Trash2,
  ChevronLeft,
  ChevronRight,
  X,
} from "lucide-react";
import AddUserModal from "./AddUserModal";
import { apiRequest } from "./api";
import "./Users.css";

const PAGE_SIZE = 10;

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

// ---------------------------------------------------------------------------
// Main Users component
// ---------------------------------------------------------------------------

export default function Users() {
  const [users, setUsers] = useState([]);
  const [activityLog, setActivityLog] = useState([]);
  const [activeTab, setActiveTab] = useState("users");
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");

  const [searchTerm, setSearchTerm] = useState("");
  const [roleFilter, setRoleFilter] = useState("All Roles");
  const [statusFilter, setStatusFilter] = useState("All Status");
  const [branchFilter, setBranchFilter] = useState("All Branch/Warehouse");
  const [page, setPage] = useState(1);

  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [viewingUser, setViewingUser] = useState(null);

  const [activitySearchTerm, setActivitySearchTerm] = useState("");
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

  const loadActivityLog = () => {
    apiRequest("/users/activity-log")
      .then(setActivityLog)
      .catch((err) => setLoadError(err.message || "Failed to load activity log."));
  };

  useEffect(() => {
    loadUsers();
    loadActivityLog();
  }, []);

  const roles = useMemo(() => ["All Roles", ...new Set(users.map((u) => u.role))], [users]);
  const statuses = ["All Status", "Active", "Inactive"];
  const branches = useMemo(
    () => ["All Branch/Warehouse", ...new Set(users.map((u) => u.branch).filter(Boolean))],
    [users]
  );

  const filteredUsers = useMemo(() => {
    return users.filter((u) => {
      const term = searchTerm.toLowerCase();
      const matchesSearch = u.name.toLowerCase().includes(term) || u.email.toLowerCase().includes(term);
      const matchesRole = roleFilter === "All Roles" || u.role === roleFilter;
      const matchesStatus = statusFilter === "All Status" || u.status === statusFilter;
      const matchesBranch = branchFilter === "All Branch/Warehouse" || u.branch === branchFilter;
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

  const filteredActivity = useMemo(() => {
    return activityLog.filter((entry) => {
      const term = activitySearchTerm.toLowerCase();
      return !term || entry.name.toLowerCase().includes(term) || String(entry.userId).includes(term);
    });
  }, [activityLog, activitySearchTerm]);

  const activityTotalPages = Math.max(1, Math.ceil(filteredActivity.length / PAGE_SIZE));
  const activityCurrentPage = Math.min(activityPage, activityTotalPages);
  const paginatedActivity = filteredActivity.slice(
    (activityCurrentPage - 1) * PAGE_SIZE,
    activityCurrentPage * PAGE_SIZE
  );
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

  const handleDelete = async (user) => {
    const confirmed = window.confirm(`Deactivate ${user.name}? They will no longer be able to log in.`);
    if (!confirmed) return;
    setActionError("");
    try {
      await apiRequest(`/users/${user.id}`, { method: "DELETE" });
      loadUsers();
      loadActivityLog();
    } catch (err) {
      setActionError(err.message || "Failed to deactivate user.");
    }
  };

  return (
    <div className="users-page">
      <div className="users-inner">
        <h1 className="users-title">Users</h1>

        {loadError && <p style={{ color: "#dc2626", fontWeight: 600 }}>{loadError}</p>}
        {actionError && <p style={{ color: "#dc2626", fontWeight: 600 }}>{actionError}</p>}

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
                    <tr><td colSpan={7} className="no-results-cell">Loading…</td></tr>
                  )}
                  {!isLoading && paginatedUsers.map((user) => (
                    <tr key={user.id}>
                      <td>{user.id}</td>
                      <td>{user.name}</td>
                      <td>{user.email}</td>
                      <td>{user.role}</td>
                      <td>{user.branch || "—"}</td>
                      <td>
                        <StatusPill status={user.status} />
                      </td>
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
                            aria-label={`Deactivate ${user.name}`}
                            onClick={() => handleDelete(user)}
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

              {/* Pagination */}
              <div className="users-pagination">
                <button
                  type="button"
                  className="page-btn"
                  onClick={() => goToPage(currentPage - 1)}
                  disabled={currentPage === 1}
                  aria-label="Previous page"
                >
                  <ChevronLeft size={16} />
                </button>
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                  <button
                    key={p}
                    type="button"
                    className={`page-btn ${p === currentPage ? "active" : ""}`}
                    onClick={() => goToPage(p)}
                  >
                    {p}
                  </button>
                ))}
                <button
                  type="button"
                  className="page-btn"
                  onClick={() => goToPage(currentPage + 1)}
                  disabled={currentPage === totalPages}
                  aria-label="Next page"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            {/* Toolbar */}
            <div className="users-toolbar">
              <div className="users-search">
                <input
                  type="text"
                  placeholder="Search by Full Name or User ID"
                  value={activitySearchTerm}
                  onChange={(e) => { setActivitySearchTerm(e.target.value); setActivityPage(1); }}
                  className="users-search-input"
                />
                <Search size={16} className="users-search-icon" />
              </div>
            </div>

            {/* Table */}
            <div className="users-table-wrap">
              <table className="users-table">
                <thead>
                  <tr>
                    <th>User ID</th>
                    <th>Full Name</th>
                    <th>Role</th>
                    <th>Module</th>
                    <th>Action</th>
                    <th>Date and Time</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedActivity.map((entry) => (
                    <tr key={entry.id}>
                      <td>{entry.userId}</td>
                      <td>{entry.name}</td>
                      <td>{entry.role}</td>
                      <td>{entry.module}</td>
                      <td>{entry.action}{entry.description ? ` — ${entry.description}` : ""}</td>
                      <td>{new Date(entry.datetime).toLocaleString()}</td>
                    </tr>
                  ))}
                  {paginatedActivity.length === 0 && (
                    <tr>
                      <td colSpan={6} className="no-results-cell">
                        No activity matches your search.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>

              {/* Pagination */}
              <div className="users-pagination">
                <button
                  type="button"
                  className="page-btn"
                  onClick={() => goToActivityPage(activityCurrentPage - 1)}
                  disabled={activityCurrentPage === 1}
                  aria-label="Previous page"
                >
                  <ChevronLeft size={16} />
                </button>
                {Array.from({ length: activityTotalPages }, (_, i) => i + 1).map((p) => (
                  <button
                    key={p}
                    type="button"
                    className={`page-btn ${p === activityCurrentPage ? "active" : ""}`}
                    onClick={() => goToActivityPage(p)}
                  >
                    {p}
                  </button>
                ))}
                <button
                  type="button"
                  className="page-btn"
                  onClick={() => goToActivityPage(activityCurrentPage + 1)}
                  disabled={activityCurrentPage === activityTotalPages}
                  aria-label="Next page"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          </>
        )}
      </div>

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

      <ViewUserModal user={viewingUser} onClose={() => setViewingUser(null)} />
    </div>
  );
}