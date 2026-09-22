import React, { useEffect, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { ShoppingCart, X } from "lucide-react";
import { apiRequest } from "./api";
import "./Dashboard.css";

function formatPeso(amount) {
  return `₱ ${Number(amount || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ---------------------------------------------------------------------------
// Small building blocks
// ---------------------------------------------------------------------------

function Badge({ children, tone = "neutral", onClick }) {
  const toneClass = tone === "dark" ? "badge badge-dark" : "badge";
  return (
    <button type="button" onClick={onClick} className={toneClass}>
      {children}
    </button>
  );
}

function StatCard({ label, value, badge, badgeTone, onBadgeClick }) {
  return (
    <div className="stat-card">
      <span className="stat-label">{label}</span>
      <div className="stat-row">
        <span className="stat-value">{value}</span>
        <Badge tone={badgeTone} onClick={onBadgeClick}>{badge}</Badge>
      </div>
    </div>
  );
}

function StatusPill({ status }) {
  const className = status === "Critical" ? "pill pill-critical" : "pill pill-low";
  return <span className={className}>{status}</span>;
}

function RestockRow({ item, onReorder, isReordering }) {
  return (
    <div className="restock-row">
      <div>
        <p className="restock-name">{item.name}</p>
        <p className="restock-meta">
          Stock: {item.stock} &nbsp;|&nbsp; Reorder At: {item.suggest}
        </p>
      </div>
      <div className="restock-actions">
        <StatusPill status={item.status} />
        <button
          type="button"
          aria-label={`Reorder ${item.name}`}
          className="icon-button"
          onClick={() => onReorder(item)}
          disabled={isReordering}
          title="Add to restocking queue"
        >
          <ShoppingCart size={20} />
        </button>
      </div>
    </div>
  );
}

function CustomTooltip({ active, payload, label }) {
  if (active && payload && payload.length) {
    return (
      <div className="chart-tooltip">
        <p className="chart-tooltip-label">{label}</p>
        <p className="chart-tooltip-value">{formatPeso(payload[0].value)}</p>
      </div>
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// Modals
// ---------------------------------------------------------------------------

const overlayStyle = {
  position: "fixed", inset: 0, background: "rgba(17,24,39,0.45)",
  display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16,
};
const cardStyle = {
  background: "#fff", borderRadius: 12, padding: "24px 28px", width: "100%", maxWidth: 480,
  maxHeight: "80vh", overflowY: "auto", boxShadow: "0 20px 50px rgba(0,0,0,0.2)",
};

function ModalShell({ title, onClose, children }) {
  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={cardStyle} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h2 style={{ fontSize: "1.15rem", fontWeight: 800, margin: 0 }}>{title}</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer" }}>
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function LowStockModal({ isOpen, onClose }) {
  const [rows, setRows] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setIsLoading(true);
    apiRequest("/dashboard/low-stock")
      .then(setRows)
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, [isOpen]);

  if (!isOpen) return null;
  return (
    <ModalShell title="Products Needing Attention" onClose={onClose}>
      {isLoading && <p>Loading…</p>}
      {!isLoading && rows.length === 0 && <p>No products are below their reorder level.</p>}
      {!isLoading && rows.map((r) => (
        <div key={r.id} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #f3f4f6" }}>
          <div>
            <p style={{ margin: 0, fontWeight: 600 }}>{r.name}</p>
            <p style={{ margin: 0, fontSize: "0.8rem", color: "#6b7280" }}>Stock: {r.stock} / Reorder at: {r.reorderLevel}</p>
          </div>
          <StatusPill status={r.status} />
        </div>
      ))}
    </ModalShell>
  );
}

function TopProductsModal({ isOpen, onClose }) {
  const [rows, setRows] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setIsLoading(true);
    apiRequest("/dashboard/top-products?days=30&limit=10")
      .then(setRows)
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, [isOpen]);

  if (!isOpen) return null;
  return (
    <ModalShell title="Best Sellers (Last 30 Days)" onClose={onClose}>
      {isLoading && <p>Loading…</p>}
      {!isLoading && rows.length === 0 && <p>No sales recorded in the last 30 days.</p>}
      {!isLoading && rows.map((r, i) => (
        <div key={r.id} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #f3f4f6" }}>
          <div>
            <p style={{ margin: 0, fontWeight: 600 }}>{i + 1}. {r.name}</p>
            <p style={{ margin: 0, fontSize: "0.8rem", color: "#6b7280" }}>{r.unitsSold} units sold</p>
          </div>
          <span style={{ fontWeight: 700 }}>{formatPeso(r.revenue)}</span>
        </div>
      ))}
    </ModalShell>
  );
}

function ActivityLogModal({ isOpen, onClose }) {
  const [rows, setRows] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setIsLoading(true);
    apiRequest("/dashboard/activity-log?limit=40")
      .then(setRows)
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, [isOpen]);

  if (!isOpen) return null;
  return (
    <ModalShell title="Activity Log" onClose={onClose}>
      {isLoading && <p>Loading…</p>}
      {!isLoading && rows.length === 0 && <p>No activity recorded yet.</p>}
      {!isLoading && rows.map((r) => (
        <div key={r.id} style={{ padding: "8px 0", borderBottom: "1px solid #f3f4f6" }}>
          <p style={{ margin: 0, fontSize: "0.85rem" }}>
            <strong>{r.user}</strong> — {r.action} in {r.module}
            {r.description ? `: ${r.description}` : ""}
          </p>
          <p style={{ margin: 0, fontSize: "0.75rem", color: "#9ca3af" }}>{new Date(r.date).toLocaleString()}</p>
        </div>
      ))}
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// Main Dashboard component
// ---------------------------------------------------------------------------

export default function Dashboard() {
  const [summary, setSummary] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [toast, setToast] = useState("");
  const [reorderingId, setReorderingId] = useState(null);

  const [showLowStock, setShowLowStock] = useState(false);
  const [showTopProducts, setShowTopProducts] = useState(false);
  const [showActivityLog, setShowActivityLog] = useState(false);

  const load = () => {
    setIsLoading(true);
    apiRequest("/dashboard/summary")
      .then((data) => {
        setSummary(data);
        setLoadError("");
      })
      .catch((err) => setLoadError(err.message || "Failed to load dashboard data."))
      .finally(() => setIsLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const showToast = (msg) => {
    setToast(msg);
    window.setTimeout(() => setToast(""), 2500);
  };

  const handleReorder = async (item) => {
    setReorderingId(item.id);
    try {
      const result = await apiRequest(`/restocking/${item.id}/quick`, { method: "POST" });
      showToast(result.message);
    } catch (err) {
      showToast(err.message || "Failed to queue restock.");
    } finally {
      setReorderingId(null);
    }
  };

  if (isLoading && !summary) {
    return (
      <div className="dashboard">
        <div className="dashboard-inner">
          <h1 className="dashboard-title">Dashboard</h1>
          <p>Loading…</p>
        </div>
      </div>
    );
  }

  if (loadError && !summary) {
    return (
      <div className="dashboard">
        <div className="dashboard-inner">
          <h1 className="dashboard-title">Dashboard</h1>
          <p style={{ color: "#dc2626", fontWeight: 600 }}>{loadError}</p>
        </div>
      </div>
    );
  }

  const statCards = [
    {
      label: "Sales Performance (Today)",
      value: formatPeso(summary.salesPerformance),
      badge: summary.salesPerformanceChangeLabel,
      badgeTone: summary.salesPerformanceChangeLabel.startsWith("-") ? "dark" : "neutral",
    },
    {
      label: "Transactions (Today)",
      value: String(summary.transactions),
      badge: summary.transactionsChangeLabel,
      badgeTone: summary.transactionsChangeLabel.startsWith("-") ? "dark" : "neutral",
    },
    {
      label: "Stock Attention",
      value: String(summary.stockAttention),
      badge: "View",
      onBadgeClick: () => setShowLowStock(true),
    },
    {
      label: "Best Seller (30d)",
      value: summary.bestSeller,
      badge: "View",
      onBadgeClick: () => setShowTopProducts(true),
    },
  ];

  return (
    <div className="dashboard">
      <div className="dashboard-inner">
        <h1 className="dashboard-title">Dashboard</h1>

        {/* Stat cards */}
        <div className="stat-grid">
          {statCards.map((card) => (
            <StatCard key={card.label} {...card} />
          ))}
        </div>

        {/* Sales trend + Restock suggestion */}
        <div className="two-col">
          <div className="panel">
            <h2 className="panel-title">Sales Trend (Last 7 Days)</h2>
            <div className="chart-box">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={summary.salesTrend} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="#eee" />
                  <XAxis dataKey="day" tick={{ fontSize: 12, fill: "#6b7280" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 12, fill: "#6b7280" }} axisLine={false} tickLine={false} />
                  <Tooltip content={<CustomTooltip />} />
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke="#ef4444"
                    strokeWidth={2}
                    dot={{ r: 4, fill: "#059669", strokeWidth: 0 }}
                    activeDot={{ r: 6 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="panel">
            <h2 className="panel-title">Restock Suggestion</h2>
            <div className="restock-list">
              {summary.restockSuggestions.length === 0 && (
                <p style={{ color: "#9ca3af", fontSize: "0.85rem" }}>All products are above their reorder level.</p>
              )}
              {summary.restockSuggestions.map((item) => (
                <RestockRow
                  key={item.id}
                  item={item}
                  onReorder={handleReorder}
                  isReordering={reorderingId === item.id}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Activity Timeline */}
        <div className="panel">
          <div className="panel-header">
            <h2 className="panel-title">Activity Timeline</h2>
            <Badge onClick={() => setShowActivityLog(true)}>View Logs</Badge>
          </div>
          <div className="activity-list">
            {summary.activityLog.length === 0 && (
              <p style={{ color: "#9ca3af", fontSize: "0.85rem" }}>No recent activity.</p>
            )}
            {summary.activityLog.map((entry) => (
              <div key={entry.id} className="activity-row">
                <span className="activity-text">{entry.text}</span>
                <span className="activity-date">{new Date(entry.date).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <LowStockModal isOpen={showLowStock} onClose={() => setShowLowStock(false)} />
      <TopProductsModal isOpen={showTopProducts} onClose={() => setShowTopProducts(false)} />
      <ActivityLogModal isOpen={showActivityLog} onClose={() => setShowActivityLog(false)} />

      {toast && (
        <div style={{
          position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)",
          background: "#111827", color: "#fff", padding: "10px 20px", borderRadius: 999,
          fontSize: "0.85rem", fontWeight: 600, zIndex: 1200,
        }}>
          {toast}
        </div>
      )}
    </div>
  );
}