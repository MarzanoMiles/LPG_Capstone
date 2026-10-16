import React, { useState, useEffect, useLayoutEffect, useMemo } from "react";
import Login from "./Login";
import ResetPasswordPage from "./ResetPasswordPage";
import Sidebar from "./Sidebar";
import Dashboard from "./Dashboard";
import PosTerminal from "./PosTerminal";
import PaymentModal from "./PaymentModal";
import Sales from "./Sales";
import Users from "./Users";
import Settings from "./Settings";
import Inventory from "./Inventory";
import Products from "./Products";
import Restocking from "./Restocking";
import AddProductModal from "./AddProductModal";
import Suppliers from "./Suppliers";
import "./App.css";
import ReportCompliance from "./ReportCompliance";
import Data from "./Data";
import OrderAndDelivery from "./OrderAndDelivery";
import LogoutModal from "./LogoutModal";
import { apiRequest } from "./api";
import { getAllowedNavIds } from "./rbac";
import "./ManagementLayout.css";

const pages = {
  dashboard: Dashboard,
  pos: PosTerminal,
  inventory: Inventory,
  products: Products,
  sales: Sales,
  restocking: Restocking,
  suppliers: Suppliers,
  data: Data,
  users: Users,
  settings: Settings,
  report: ReportCompliance,
  orders: OrderAndDelivery,
};

function isResetPasswordRoute() {
  return window.location.hash.startsWith("#/reset-password");
}

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(() => Boolean(localStorage.getItem("token")));
  const [activeItem, setActiveItem] = useState("dashboard");
  const [isLogoutModalOpen, setIsLogoutModalOpen] = useState(false);
  const [showResetPage, setShowResetPage] = useState(isResetPasswordRoute);
  const [currentUser, setCurrentUser] = useState(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [sessionError, setSessionError] = useState('');

  useLayoutEffect(() => {
    const onSessionExpired = event => {
      setSessionError(event.detail?.message || 'Please sign in again.');
      setIsAuthenticated(false);
      setIsLogoutModalOpen(false);
      setActiveItem('dashboard');
    };
    window.addEventListener('auth:session-expired', onSessionExpired);
    return () => window.removeEventListener('auth:session-expired', onSessionExpired);
  }, []);

  useEffect(() => {
    const handleHashChange = () => setShowResetPage(isResetPasswordRoute());
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  const handleLogin = async ({ email, password }) => {
    const data = await apiRequest("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });

    localStorage.setItem("token", data.token);
    localStorage.setItem("user", JSON.stringify(data.user));
    setSessionError('');
    setCurrentUser(data.user);
    setIsAuthenticated(true);
  };

  const handleRegisterSuccess = (data) => {
    localStorage.setItem("token", data.token);
    localStorage.setItem("user", JSON.stringify(data.user));
    setSessionError('');
    setCurrentUser(data.user);
    setIsAuthenticated(true);
  };

  const handleLogout = async () => {
    try { await apiRequest('/auth/logout', {method:'POST'}); }
    catch (error) { if (error.status !== 401) { setSessionError(error.message); return; } }
    setIsLogoutModalOpen(false);
    localStorage.removeItem('token'); localStorage.removeItem('user');
    setCurrentUser(null); setSessionReady(false); setIsAuthenticated(false); setActiveItem('dashboard');
  };

  useEffect(() => {
    if (!isAuthenticated) { setSessionReady(false); return; }
    let active = true;
    const refresh = () => apiRequest('/auth/me').then(actor => {
      if (!active) return;
      const user = {id:actor.UserID,firstName:actor.FirstName,lastName:actor.LastName,email:actor.Email,
        role:actor.RoleName, moduleAccess:actor.ModuleAccess};
      localStorage.setItem('user', JSON.stringify(user)); setCurrentUser(user); setSessionReady(true); setSessionError('');
    }).catch(error => { if (active) setSessionError(error.message); });
    refresh();
    const interval = setInterval(refresh, 30000);
    window.addEventListener('focus',refresh); window.addEventListener('auth:access-updated',refresh);
    return () => { active=false; clearInterval(interval); window.removeEventListener('focus',refresh); window.removeEventListener('auth:access-updated',refresh); };
  }, [isAuthenticated]);

  const allowedNavIds = useMemo(() => getAllowedNavIds(currentUser), [currentUser]);

  useEffect(() => {
    if (!isAuthenticated) return;
    if (!allowedNavIds.length) return;
    if (!allowedNavIds.includes(activeItem)) {
      setActiveItem(allowedNavIds[0]);
    }
  }, [isAuthenticated, allowedNavIds, activeItem]);

  // The password-reset link takes priority over everything else, whether or
  // not the person happens to already be logged in on this browser.
  if (showResetPage) {
    return (
      <ResetPasswordPage
        onDone={() => {
          window.location.hash = "";
          setShowResetPage(false);
        }}
      />
    );
  }

  if (!isAuthenticated) {
    return <Login onLogin={handleLogin} onRegisterSuccess={handleRegisterSuccess} sessionError={sessionError} />;
  }

  const resolvedActiveItem = allowedNavIds.includes(activeItem)
    ? activeItem
    : (allowedNavIds[0] || null);
  const ActivePage = pages[resolvedActiveItem];

  return (
    <div className="app-shell">
      <Sidebar
        accessIds={allowedNavIds}
        sessionUser={currentUser}
        activeItem={resolvedActiveItem}
        onNavigate={setActiveItem}
        onProfileClick={() => setIsLogoutModalOpen(true)}
      />
      <main className="app-content">
        {sessionError && <p role="alert">{sessionError}</p>}
        {!sessionReady ? <p>Verifying your account...</p> : ActivePage ? <ActivePage /> : <p>No module access is assigned to your account. Contact an administrator.</p>}
      </main>
      <LogoutModal
        isOpen={isLogoutModalOpen}
        onClose={() => setIsLogoutModalOpen(false)}
        onLogout={handleLogout}
      />
    </div>
  );
}
