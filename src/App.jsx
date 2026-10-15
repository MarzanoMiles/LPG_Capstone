import React, { useState, useEffect, useMemo } from "react";
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
import { getAllowedNavIdsByRole } from "./rbac";
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
    setIsAuthenticated(true);
  };

  const handleRegisterSuccess = (data) => {
    localStorage.setItem("token", data.token);
    localStorage.setItem("user", JSON.stringify(data.user));
    setIsAuthenticated(true);
  };

  const handleLogout = () => {
    setIsLogoutModalOpen(false);
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    setIsAuthenticated(false);
    setActiveItem("dashboard");
  };

  const currentUser = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem("user") || "null");
    } catch {
      return null;
    }
  }, [isAuthenticated]);

  const allowedNavIds = useMemo(() => getAllowedNavIdsByRole(currentUser?.role), [currentUser?.role]);

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
    return <Login onLogin={handleLogin} onRegisterSuccess={handleRegisterSuccess} />;
  }

  const resolvedActiveItem = allowedNavIds.includes(activeItem)
    ? activeItem
    : (allowedNavIds[0] || "dashboard");
  const ActivePage = pages[resolvedActiveItem] || Dashboard;

  return (
    <div className="app-shell">
      <Sidebar
        activeItem={resolvedActiveItem}
        onNavigate={setActiveItem}
        onProfileClick={() => setIsLogoutModalOpen(true)}
      />
      <main className="app-content">
        <ActivePage />
      </main>
      <LogoutModal
        isOpen={isLogoutModalOpen}
        onClose={() => setIsLogoutModalOpen(false)}
        onLogout={handleLogout}
      />
    </div>
  );
}
