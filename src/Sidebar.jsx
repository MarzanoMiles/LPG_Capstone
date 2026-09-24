import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  LayoutGrid,
  ShoppingCart,
  Boxes,
  Package,
  DollarSign,
  RotateCcw,
  Users,
  Database,
  User,
  Settings,
  FileText,
  Truck,
  Search,
  Bell,
  UserCircle,
  LogOut,
  AlertTriangle,
  CalendarClock,
  CheckCircle,
  X,
} from "lucide-react";

// Import your custom logo image
import logoImg from "./assets/logo.png";
import { apiRequest } from "./api";
import "./Sidebar.css";

// ---------------------------------------------------------------------------
// Nav config — edit this array to add/remove/reorder tabs
// ---------------------------------------------------------------------------

const navItems = [
  { id: "dashboard", label: "Dashboard", icon: LayoutGrid },
  { id: "pos", label: "POS Terminal", icon: ShoppingCart },
  { id: "inventory", label: "Inventory", icon: Boxes },
  { id: "products", label: "Products", icon: Package },
  { id: "sales", label: "Sales", icon: DollarSign },
  { id: "restocking", label: "Restocking", icon: RotateCcw },
  { id: "orders", label: "Order and Delivery", icon: Truck },
  { id: "suppliers", label: "Suppliers", icon: Users },
  { id: "report", label: "Report and Compliance", icon: FileText },
  { id: "data", label: "Data", icon: Database },
  { id: "users", label: "Users", icon: User },
  { id: "settings", label: "Settings", icon: Settings },
];

function relativeLabel(dueDateStr) {
  const due = new Date(dueDateStr);
  const today = new Date();
  due.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((due - today) / 86400000);
  if (diffDays === 0) return "Due today";
  if (diffDays === 1) return "Due tomorrow";
  if (diffDays > 0) return `Due in ${diffDays} days`;
  return `${Math.abs(diffDays)} day(s) overdue`;
}

// ---------------------------------------------------------------------------
// Centered notification modal
// ---------------------------------------------------------------------------

function NotificationModal({ isOpen, onClose, isLoading, error, overdue, dueSoon, onGoToReport }) {
  if (!isOpen) return null;

  const hasNotifications = overdue.length > 0 || dueSoon.length > 0;

  return (
    <div className="notif-modal-overlay" onClick={onClose}>
      <div className="notif-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="notif-modal-header">
          <div className="notif-modal-header-title">
            <Bell size={18} />
            <h2>Report &amp; Compliance Notifications</h2>
          </div>
          <button type="button" className="notif-modal-close" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>

        <div className="notif-modal-body">
          {isLoading && <p className="notif-empty">Loading…</p>}
          {!isLoading && error && <p className="notif-empty notif-error">{error}</p>}

          {!isLoading && !error && !hasNotifications && (
            <div className="notif-clear-state">
              <CheckCircle size={40} className="notif-clear-icon" />
              <p className="notif-clear-title">You're all caught up!</p>
              <p className="notif-clear-sub">No due or overdue reports right now.</p>
            </div>
          )}

          {!isLoading && !error && hasNotifications && (
            <div className="notif-list">
              {overdue.length > 0 && (
                <div className="notif-section">
                  <p className="notif-section-label notif-section-danger">Overdue</p>
                  {overdue.map((r) => (
                    <button key={`overdue-${r.id}`} type="button" className="notif-item notif-item-danger" onClick={onGoToReport}>
                      <AlertTriangle size={16} className="notif-item-icon" />
                      <div className="notif-item-body">
                        <p className="notif-item-title">{r.name}</p>
                        <p className="notif-item-sub">{r.period} · {relativeLabel(r.dueDate)}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {dueSoon.length > 0 && (
                <div className="notif-section">
                  <p className="notif-section-label notif-section-warning">Due Soon</p>
                  {dueSoon.map((r) => (
                    <button key={`duesoon-${r.id}`} type="button" className="notif-item notif-item-warning" onClick={onGoToReport}>
                      <CalendarClock size={16} className="notif-item-icon" />
                      <div className="notif-item-body">
                        <p className="notif-item-title">{r.name}</p>
                        <p className="notif-item-sub">{r.period} · {relativeLabel(r.dueDate)}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {hasNotifications && (
          <div className="notif-modal-footer">
            <button type="button" className="notif-modal-footer-btn" onClick={onGoToReport}>
              View Report &amp; Compliance
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sidebar component
// ---------------------------------------------------------------------------

export default function Sidebar({ activeItem, onNavigate, onProfileClick }) {
  // Falls back to internal state if the parent doesn't control activeItem
  const [internalActive, setInternalActive] = useState("dashboard");
  const [isProfileDropdownOpen, setIsProfileDropdownOpen] = useState(false);
  const [isNotifModalOpen, setIsNotifModalOpen] = useState(false);

  const [reports, setReports] = useState([]);
  const [isLoadingNotifs, setIsLoadingNotifs] = useState(false);
  const [notifError, setNotifError] = useState("");

  const [searchTerm, setSearchTerm] = useState("");
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  const profileRef = useRef(null);
  const searchRef = useRef(null);

  const current = activeItem ?? internalActive;

  const handleClick = (id) => {
    if (onNavigate) {
      onNavigate(id);
    } else {
      setInternalActive(id);
    }
  };

  const handleProfileSelect = (id) => {
    setIsProfileDropdownOpen(false);

    if (id === "profile") {
      handleClick("settings");
      return;
    }

    if (id === "logout" && onProfileClick) {
      onProfileClick();
    }
  };

  // --- Notifications: due-soon and overdue reports only ---
  const loadNotifications = () => {
    setIsLoadingNotifs(true);
    apiRequest("/reports")
      .then((data) => {
        setReports(data);
        setNotifError("");
      })
      .catch((err) => setNotifError(err.message || "Failed to load notifications."))
      .finally(() => setIsLoadingNotifs(false));
  };

  useEffect(() => {
    loadNotifications();
    // Refresh periodically so the badge count doesn't go stale during a long session.
    const interval = setInterval(loadNotifications, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const { dueSoon, overdue } = useMemo(() => {
    return {
      dueSoon: reports.filter((r) => r.status === "Due Soon"),
      overdue: reports.filter((r) => r.status === "Overdue"),
    };
  }, [reports]);

  const notificationCount = overdue.length + dueSoon.length;

  const handleNotificationClick = () => {
    setIsProfileDropdownOpen(false);
    setIsSearchOpen(false);
    loadNotifications(); // refresh right as it opens
    setIsNotifModalOpen(true);
  };

  const goToReport = () => {
    setIsNotifModalOpen(false);
    handleClick("report");
  };

  // --- Search: filters the nav items by label as the user types ---
  const searchResults = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return [];
    return navItems.filter((item) => item.label.toLowerCase().includes(term));
  }, [searchTerm]);

  const handleSearchChange = (e) => {
    setSearchTerm(e.target.value);
    setIsSearchOpen(true);
  };

  const handleSearchSelect = (id) => {
    handleClick(id);
    setSearchTerm("");
    setIsSearchOpen(false);
  };

  const handleSearchKeyDown = (e) => {
    if (e.key === "Enter" && searchResults.length > 0) {
      e.preventDefault();
      handleSearchSelect(searchResults[0].id);
    }
    if (e.key === "Escape") {
      setIsSearchOpen(false);
    }
  };

  // Close the profile dropdown / search dropdown when clicking outside of them
  useEffect(() => {
    function handleOutsideClick(e) {
      if (profileRef.current && !profileRef.current.contains(e.target)) {
        setIsProfileDropdownOpen(false);
      }
      if (searchRef.current && !searchRef.current.contains(e.target)) {
        setIsSearchOpen(false);
      }
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  // Close the notification modal on Escape
  useEffect(() => {
    if (!isNotifModalOpen) return;
    function handleEscape(e) {
      if (e.key === "Escape") setIsNotifModalOpen(false);
    }
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isNotifModalOpen]);

  return (
    <aside className="sidebar">
      {/* Custom Image Logo */}
      <div className="sidebar-logo">
        <img src={logoImg} alt="GasTrack Logo" className="sidebar-logo-img" />
      </div>

      {/* Avatar + notification bell */}
      <div className="sidebar-top-icons">
        <div className="profile-menu-wrapper" ref={profileRef}>
          <button
            type="button"
            className="icon-circle"
            aria-label="Profile"
            aria-expanded={isProfileDropdownOpen}
            onClick={() => {
              setIsProfileDropdownOpen((v) => !v);
              setIsSearchOpen(false);
            }}
          >
            <UserCircle size={20} />
          </button>

          {isProfileDropdownOpen && (
            <div className="profile-dropdown">
              <button
                type="button"
                className="profile-dropdown-item"
                onClick={() => handleProfileSelect("profile")}
              >
                <User size={16} className="profile-dropdown-icon" />
                <span>Profile</span>
              </button>
              <button
                type="button"
                className="profile-dropdown-item"
                onClick={() => handleProfileSelect("logout")}
              >
                <LogOut size={16} className="profile-dropdown-icon" />
                <span>Log out</span>
              </button>
            </div>
          )}
        </div>

        <button
          type="button"
          className="icon-circle"
          aria-label="Notifications"
          onClick={handleNotificationClick}
        >
          <Bell size={18} />
          {notificationCount > 0 && (
            <span className="notification-badge">{notificationCount > 99 ? "99+" : notificationCount}</span>
          )}
        </button>
      </div>

      {/* Search */}
      <div className="sidebar-search-wrap" ref={searchRef}>
        <div className="sidebar-search">
          <Search size={16} className="sidebar-search-icon" />
          <input
            type="text"
            placeholder="Search for..."
            className="sidebar-search-input"
            value={searchTerm}
            onChange={handleSearchChange}
            onFocus={() => searchTerm && setIsSearchOpen(true)}
            onKeyDown={handleSearchKeyDown}
          />
        </div>

        {isSearchOpen && searchTerm && (
          <div className="sidebar-search-dropdown">
            {searchResults.length === 0 && (
              <p className="search-empty">No matching pages for "{searchTerm}"</p>
            )}
            {searchResults.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                className="search-result-item"
                onClick={() => handleSearchSelect(id)}
              >
                <Icon size={16} className="search-result-icon" />
                <span>{label}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Nav items */}
      <nav className="sidebar-nav">
        {navItems.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            className={`sidebar-nav-item ${current === id ? "active" : ""}`}
            onClick={() => handleClick(id)}
          >
            <Icon size={18} className="sidebar-nav-icon" />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      {/* Centered notification popup */}
      <NotificationModal
        isOpen={isNotifModalOpen}
        onClose={() => setIsNotifModalOpen(false)}
        isLoading={isLoadingNotifs}
        error={notifError}
        overdue={overdue}
        dueSoon={dueSoon}
        onGoToReport={goToReport}
      />
    </aside>
  );
}