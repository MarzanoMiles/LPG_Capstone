import React, { useState } from "react";
import Login from "./Login";
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

// ---------------------------------------------------------------------------
// App shell — Sidebar on the left, active page on the right.
//
// As you build out more pages (POS Terminal, Inventory, Products, etc.),
// add them to the `pages` map below. The `id` values must match the `id`s
// in Sidebar.jsx's `navItems` array.
// ---------------------------------------------------------------------------

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

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(() => Boolean(localStorage.getItem("token")));
  const [activeItem, setActiveItem] = useState("dashboard");
  const [isLogoutModalOpen, setIsLogoutModalOpen] = useState(false);

  const handleLogin = async ({ email, password }) => {
    const data = await apiRequest("/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email,
        password,
      }),
    });

    localStorage.setItem("token", data.token);
    localStorage.setItem("user", JSON.stringify(data.user));
    setIsAuthenticated(true);
  };

  // Called by Login.jsx after a successful POST /auth/register, which returns
  // the same { token, user } shape as /auth/login — so registration logs the
  // new admin straight into the dashboard rather than bouncing back to login.
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

  if (!isAuthenticated) {
    return <Login onLogin={handleLogin} onRegisterSuccess={handleRegisterSuccess} />;
  }

  const ActivePage = pages[activeItem] || Dashboard;

  return (
    <div className="app-shell">
      <Sidebar
        activeItem={activeItem}
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