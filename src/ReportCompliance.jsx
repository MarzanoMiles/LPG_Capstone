import React, { useEffect, useMemo, useState } from "react";
import {
  CalendarClock,
  CalendarX2,
  CalendarCheck2,
  FileText,
  ChevronLeft,
  ChevronRight,
  MoreVertical,
  Info,
  Download,
  CheckCircle,
  Trash2,
  X,
} from "lucide-react";
import { apiRequest } from "./api";
import "./ReportCompliance.css";

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const REPORT_TYPES = ["Sales Summary", "Inventory Audit", "Restocking Logs"];

function statusIconTone(status) {
  if (status === "Overdue" || status === "Due Soon") return "danger";
  if (status === "Upcoming") return "warning";
  return "success"; // Submitted
}

function statusPillClass(status) {
  if (status === "Overdue" || status === "Due Soon") return "status-pill danger";
  if (status === "Upcoming") return "status-pill warning";
  return "status-pill success";
}

function toISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function relativeLabel(dueDateStr) {
  const due = new Date(dueDateStr);
  const today = new Date();
  due.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((due - today) / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  if (diffDays === -1) return "Yesterday";
  if (diffDays > 0) return `In ${diffDays} days`;
  return `${Math.abs(diffDays)} days overdue`;
}

function buildCalendarGrid(year, month) {
  const firstOfMonth = new Date(year, month, 1);
  const firstWeekday = (firstOfMonth.getDay() + 6) % 7;
  const gridStart = new Date(year, month, 1 - firstWeekday);

  const cells = [];
  for (let i = 0; i < 42; i++) {
    const cellDate = new Date(gridStart);
    cellDate.setDate(gridStart.getDate() + i);
    cells.push(cellDate);
  }
  return cells;
}

function StatCard({ label, value, sub, tone, icon: Icon }) {
  return (
    <div className="rc-stat-card">
      <div className={`rc-stat-icon ${tone}`}>
        <Icon size={22} />
      </div>
      <div>
        <p className="rc-stat-label">{label}</p>
        <p className={`rc-stat-value ${tone}`}>{value}</p>
        <p className={`rc-stat-sub ${tone}`}>{sub}</p>
      </div>
    </div>
  );
}

function ReportRow({ report, onGenerate, onSubmit, onDelete, isBusy }) {
  const tone = statusIconTone(report.status);
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="report-row" style={{ position: "relative" }}>
      <div className={`report-icon ${tone}`}>
        <FileText size={20} />
      </div>
      <div className="report-info">
        <p className="report-name">{report.name}</p>
        <p className="report-period">{report.period}</p>
        <p className="report-size">{report.fileName || "Not generated yet"}</p>
      </div>
      <div className="report-due">
        <p className={`report-due-date ${tone}`}>Due: {new Date(report.dueDate).toLocaleDateString()}</p>
        <p className={`report-relative ${tone}`}>{relativeLabel(report.dueDate)}</p>
      </div>
      <span className={statusPillClass(report.status)}>{report.status}</span>
      <button
        type="button"
        className="report-menu-btn"
        aria-label="More options"
        onClick={() => setMenuOpen((v) => !v)}
      >
        <MoreVertical size={18} />
      </button>

      {menuOpen && (
        <div
          style={{
            position: "absolute", top: 44, right: 0, background: "#fff", border: "1px solid #e5e7eb",
            borderRadius: 8, boxShadow: "0 8px 24px rgba(0,0,0,0.12)", zIndex: 10, minWidth: 180,
          }}
        >
          <button
            type="button"
            disabled={isBusy}
            onClick={() => { setMenuOpen(false); onGenerate(report); }}
            style={menuItemStyle}
          >
            <Download size={14} /> Generate CSV
          </button>
          {report.status !== "Submitted" && (
            <button
              type="button"
              disabled={isBusy}
              onClick={() => { setMenuOpen(false); onSubmit(report); }}
              style={menuItemStyle}
            >
              <CheckCircle size={14} /> Mark as Submitted
            </button>
          )}
          <button
            type="button"
            disabled={isBusy}
            onClick={() => { setMenuOpen(false); onDelete(report); }}
            style={{ ...menuItemStyle, color: "#dc2626" }}
          >
            <Trash2 size={14} /> Delete
          </button>
        </div>
      )}
    </div>
  );
}

const menuItemStyle = {
  display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "10px 14px",
  background: "none", border: "none", textAlign: "left", cursor: "pointer", fontSize: "0.85rem",
};

function downloadCsv(fileName, csvText) {
  const blob = new Blob([csvText], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function NewReportModal({ isOpen, onClose, onCreated }) {
  const [reportName, setReportName] = useState("");
  const [reportType, setReportType] = useState(REPORT_TYPES[0]);
  const [periodLabel, setPeriodLabel] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  if (!isOpen) return null;

  const reset = () => {
    setReportName("");
    setReportType(REPORT_TYPES[0]);
    setPeriodLabel("");
    setPeriodStart("");
    setPeriodEnd("");
    setDueDate("");
    setError("");
  };

  const handleSubmit = async () => {
    if (!reportName || !periodLabel || !periodStart || !periodEnd || !dueDate) {
      setError("All fields are required.");
      return;
    }
    setIsSubmitting(true);
    setError("");
    try {
      await apiRequest("/reports", {
        method: "POST",
        body: JSON.stringify({ reportName, reportType, periodLabel, periodStart, periodEnd, dueDate }),
      });
      onCreated();
      reset();
      onClose();
    } catch (err) {
      setError(err.message || "Failed to schedule report.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(17,24,39,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}
      onClick={onClose}
    >
      <div
        style={{ background: "#fff", borderRadius: 12, padding: "24px 28px", width: "100%", maxWidth: 440, boxShadow: "0 20px 50px rgba(0,0,0,0.2)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ fontSize: "1.2rem", fontWeight: 800, margin: 0 }}>Schedule Compliance Report</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer" }}>
            <X size={20} />
          </button>
        </div>

        {error && <p style={{ color: "#dc2626", fontWeight: 600 }}>{error}</p>}

        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 16 }}>
          <div>
            <label style={labelStyle}>Report Name</label>
            <input style={inputStyle} value={reportName} onChange={(e) => setReportName(e.target.value)} placeholder="e.g. July Sales Summary" />
          </div>
          <div>
            <label style={labelStyle}>Report Type</label>
            <select style={inputStyle} value={reportType} onChange={(e) => setReportType(e.target.value)}>
              {REPORT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Period Label</label>
            <input style={inputStyle} value={periodLabel} onChange={(e) => setPeriodLabel(e.target.value)} placeholder="e.g. July 2026" />
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Period Start</label>
              <input type="date" style={inputStyle} value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Period End</label>
              <input type="date" style={inputStyle} value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
            </div>
          </div>
          <div>
            <label style={labelStyle}>Due Date</label>
            <input type="date" style={inputStyle} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
        </div>

        <div style={{ display: "flex", gap: 12, marginTop: 20 }}>
          <button
            onClick={onClose}
            style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: "1px solid #d1d5db", background: "#e5e7eb", fontWeight: 700, cursor: "pointer" }}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={isSubmitting}
            style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: "none", background: "#2563eb", color: "#fff", fontWeight: 700, cursor: "pointer" }}
          >
            {isSubmitting ? "Saving…" : "Schedule"}
          </button>
        </div>
      </div>
    </div>
  );
}

const labelStyle = { fontSize: "0.8rem", fontWeight: 600, color: "#374151", display: "block", marginBottom: 4 };
const inputStyle = { width: "100%", border: "1px solid #d1d5db", borderRadius: 8, padding: "8px 12px", fontSize: "0.875rem", boxSizing: "border-box" };

export default function ReportCompliance() {
  const [reports, setReports] = useState([]);
  const [summary, setSummary] = useState({ dueSoon: 0, overdue: 0, submittedThisMonth: 0, total: 0 });
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [isNewReportOpen, setIsNewReportOpen] = useState(false);

  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [selectedDate, setSelectedDate] = useState(toISODate(today));

  const loadData = () => {
    setIsLoading(true);
    Promise.all([apiRequest("/reports"), apiRequest("/reports/summary")])
      .then(([reportData, summaryData]) => {
        setReports(reportData);
        setSummary(summaryData);
        setLoadError("");
      })
      .catch((err) => setLoadError(err.message || "Failed to load reports."))
      .finally(() => setIsLoading(false));
  };

  useEffect(() => {
    loadData();
  }, []);

  const reportsByDate = useMemo(() => {
    const map = {};
    reports.forEach((r) => {
      const iso = r.dueDate.slice(0, 10);
      if (!map[iso]) map[iso] = [];
      map[iso].push(r);
    });
    return map;
  }, [reports]);

  const cells = useMemo(() => buildCalendarGrid(viewYear, viewMonth), [viewYear, viewMonth]);

  const goToToday = () => {
    const now = new Date();
    setViewYear(now.getFullYear());
    setViewMonth(now.getMonth());
    setSelectedDate(toISODate(now));
  };
  const goToPrevMonth = () => {
    const d = new Date(viewYear, viewMonth - 1, 1);
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
  };
  const goToNextMonth = () => {
    const d = new Date(viewYear, viewMonth + 1, 1);
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
  };

  const monthLabel = new Date(viewYear, viewMonth, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const selectedReports = reportsByDate[selectedDate] || [];

  const statCards = [
    { label: "Reports Due Soon", value: summary.dueSoon, sub: "Within 7 days", tone: "purple", icon: CalendarClock },
    { label: "Overdue Reports", value: summary.overdue, sub: "Past due date", tone: "red", icon: CalendarX2 },
    { label: "Submitted This Month", value: summary.submittedThisMonth, sub: new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" }), tone: "green", icon: CalendarCheck2 },
    { label: "Total Reports", value: summary.total, sub: "All time", tone: "blue", icon: FileText },
  ];

  const handleGenerate = async (report) => {
    setBusyId(report.id);
    setActionError("");
    try {
      const result = await apiRequest(`/reports/${report.id}/generate`, { method: "POST" });
      downloadCsv(result.fileName, result.csv);
      loadData();
    } catch (err) {
      setActionError(err.message || "Failed to generate report.");
    } finally {
      setBusyId(null);
    }
  };

  const handleSubmit = async (report) => {
    setBusyId(report.id);
    setActionError("");
    try {
      await apiRequest(`/reports/${report.id}/submit`, { method: "PUT" });
      loadData();
    } catch (err) {
      setActionError(err.message || "Failed to mark report as submitted.");
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (report) => {
    const confirmed = window.confirm(`Delete "${report.name}" (${report.period})?`);
    if (!confirmed) return;
    setBusyId(report.id);
    setActionError("");
    try {
      await apiRequest(`/reports/${report.id}`, { method: "DELETE" });
      loadData();
    } catch (err) {
      setActionError(err.message || "Failed to delete report.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="rc-page">
      <div className="rc-inner">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h1 className="rc-title">Report and Compliance</h1>
          <button
            onClick={() => setIsNewReportOpen(true)}
            style={{ background: "#2563eb", color: "#fff", border: "none", borderRadius: 8, padding: "10px 18px", fontWeight: 700, cursor: "pointer" }}
          >
            + Schedule Report
          </button>
        </div>

        {loadError && <p style={{ color: "#dc2626", fontWeight: 600 }}>{loadError}</p>}
        {actionError && <p style={{ color: "#dc2626", fontWeight: 600 }}>{actionError}</p>}

        {/* Stat Cards */}
        <div className="rc-stat-grid">
          {statCards.map((card) => (
            <StatCard key={card.label} {...card} />
          ))}
        </div>

        {/* Main Panel Grid */}
        <div className="rc-layout">
          {/* Recent Reports Table */}
          <div className="rc-panel">
            <h2 className="rc-panel-title">ALL REPORTS</h2>
            <div className="report-table-header">
              <div></div>
              <span>Report</span>
              <span className="header-due">Due Date</span>
              <span className="header-status">Status</span>
              <div></div>
            </div>
            <div className="report-list">
              {isLoading && <p style={{ padding: "16px 0", color: "#9ca3af" }}>Loading…</p>}
              {!isLoading && reports.length === 0 && (
                <p style={{ padding: "16px 0", color: "#9ca3af" }}>No reports scheduled yet.</p>
              )}
              {!isLoading &&
                reports.map((report) => (
                  <ReportRow
                    key={report.id}
                    report={report}
                    onGenerate={handleGenerate}
                    onSubmit={handleSubmit}
                    onDelete={handleDelete}
                    isBusy={busyId === report.id}
                  />
                ))}
            </div>
          </div>

          {/* Calendar Widget */}
          <div className="rc-panel">
            <div className="calendar-header">
              <h2 className="calendar-title">{monthLabel}</h2>
              <div className="calendar-nav">
                <button type="button" className="calendar-nav-btn" onClick={goToPrevMonth} aria-label="Previous month">
                  <ChevronLeft size={16} />
                </button>
                <button type="button" className="calendar-nav-btn" onClick={goToNextMonth} aria-label="Next month">
                  <ChevronRight size={16} />
                </button>
                <button type="button" className="calendar-today-btn" onClick={goToToday}>
                  Today
                </button>
              </div>
            </div>

            <div className="calendar-weekdays">
              {WEEKDAYS.map((d) => <span key={d}>{d}</span>)}
            </div>

            <div className="calendar-grid">
              {cells.map((cellDate) => {
                const iso = toISODate(cellDate);
                const inCurrentMonth = cellDate.getMonth() === viewMonth;
                const isSelected = iso === selectedDate;
                const dayReports = reportsByDate[iso] || [];
                const dotTone = dayReports.length ? statusIconTone(dayReports[0].status) : null;

                return (
                  <button
                    type="button"
                    key={iso}
                    className={`calendar-cell ${inCurrentMonth ? "" : "muted"} ${isSelected ? "selected" : ""}`}
                    onClick={() => setSelectedDate(iso)}
                  >
                    <span>{cellDate.getDate()}</span>
                    {dotTone && !isSelected && <span className={`calendar-dot ${dotTone}`} />}
                    {dotTone && isSelected && <span className="calendar-dot selected-dot" />}
                  </button>
                );
              })}
            </div>

            {/* Reports Due Section */}
            <div className="selected-date-section">
              <h3 className="selected-date-title">Reports Due on Selected Date</h3>
              {selectedReports.length === 0 ? (
                <p className="selected-date-empty">No reports due on this date.</p>
              ) : (
                selectedReports.map((report) => {
                  const tone = statusIconTone(report.status);
                  return (
                    <div key={report.id} className="selected-report-row">
                      <div className={`report-icon small ${tone}`}>
                        <FileText size={16} />
                      </div>
                      <div className="selected-report-info">
                        <p className="report-name">{report.name}</p>
                        <p className={`report-due-date ${tone}`}>Due: {new Date(report.dueDate).toLocaleDateString()}</p>
                      </div>
                      <span className={statusPillClass(report.status)}>{report.status}</span>
                    </div>
                  );
                })
              )}
            </div>

            {/* Legend */}
            <div className="calendar-legend">
              <span><span className="legend-dot danger" /> Due Soon / Overdue</span>
              <span><span className="legend-dot warning" /> Upcoming</span>
              <span><span className="legend-dot success" /> Submitted</span>
            </div>
          </div>
        </div>

        {/* Banner */}
        <div className="rc-banner">
          <div className="rc-banner-left">
            <Info size={22} className="rc-banner-icon" />
            <div>
              <p className="rc-banner-title">Stay Compliant</p>
              <p className="rc-banner-text">
                Submit reports on time to ensure compliance and avoid penalties.
              </p>
            </div>
          </div>
        </div>
      </div>

      <NewReportModal isOpen={isNewReportOpen} onClose={() => setIsNewReportOpen(false)} onCreated={loadData} />
    </div>
  );
}