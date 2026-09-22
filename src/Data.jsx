import React, { useEffect, useState } from "react";
import { Download, FileText, ChevronDown, AlertTriangle } from "lucide-react";
import { apiRequest } from "./api";
import "./Data.css";

function downloadBase64File(fileName, mimeType, base64) {
  const byteChars = atob(base64);
  const byteNumbers = new Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
  const byteArray = new Uint8Array(byteNumbers);
  const blob = new Blob([byteArray], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function Data() {
  const [activeTab, setActiveTab] = useState("Export");

  const [exportDataType, setExportDataType] = useState("Sales Data");
  const [exportDateRange, setExportDateRange] = useState("Today");
  const [exportDateFrom, setExportDateFrom] = useState("");
  const [exportDateTo, setExportDateTo] = useState("");
  const [isExporting, setIsExporting] = useState(null); // holds the format currently exporting
  const [exportError, setExportError] = useState("");
  const [exportMessage, setExportMessage] = useState("");

  const [importDataType, setImportDataType] = useState("Sales Data");
  const [importDateRange, setImportDateRange] = useState("Today");

  const [exportLogs, setExportLogs] = useState([]);
  const [importLogs, setImportLogs] = useState([]);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);
  const [selectedLogRow, setSelectedLogRow] = useState(null);

  const loadLogs = () => {
    setIsLoadingLogs(true);
    Promise.all([
      apiRequest("/data/logs?activityType=Export"),
      apiRequest("/data/logs?activityType=Import"),
    ])
      .then(([exportData, importData]) => {
        setExportLogs(exportData);
        setImportLogs(importData);
      })
      .catch(() => {})
      .finally(() => setIsLoadingLogs(false));
  };

  useEffect(() => {
    loadLogs();
  }, []);

  const getPageTitle = () => {
    return activeTab === "Export" || activeTab === "Export Logs" ? "Data Export" : "Data Import";
  };

  const handleExport = async (format) => {
    setIsExporting(format);
    setExportError("");
    setExportMessage("");
    try {
      if (exportDateRange === "Custom" && (!exportDateFrom || !exportDateTo)) {
        throw new Error("Please select both a start and end date for a custom range.");
      }
      const result = await apiRequest("/data/export", {
        method: "POST",
        body: JSON.stringify({
          dataType: exportDataType,
          dateRange: exportDateRange,
          dateFrom: exportDateRange === "Custom" ? exportDateFrom : undefined,
          dateTo: exportDateRange === "Custom" ? exportDateTo : undefined,
          format,
        }),
      });
      downloadBase64File(result.fileName, result.mimeType, result.fileBase64);
      setExportMessage(`Exported ${result.rowCount} row(s) to ${result.fileName}.`);
      loadLogs();
    } catch (err) {
      setExportError(err.message || "Failed to export data.");
    } finally {
      setIsExporting(null);
    }
  };

  const isReimportable = exportDataType === "Sales Line Items";

  return (
    <div className="data-page">
      <div className="data-inner">
        <h1 className="data-title">{getPageTitle()}</h1>

        {/* Navigation Tabs */}
        <div className="data-tabs-wrap">
          <div className="data-tabs">
            {["Export", "Export Logs", "Import", "Import Logs"].map((tab) => (
              <button
                key={tab}
                type="button"
                className={`data-tab ${activeTab === tab ? "active" : ""}`}
                onClick={() => {
                  setActiveTab(tab);
                  setSelectedLogRow(null);
                }}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>

        {/* ------------------------------------------------------------------- */}
        {/* 1. EXPORT TAB                                                       */}
        {/* ------------------------------------------------------------------- */}
        {activeTab === "Export" && (
          <div className="data-card-container">
            {exportError && <p style={{ color: "#dc2626", fontWeight: 600 }}>{exportError}</p>}
            {exportMessage && <p style={{ color: "#16a34a", fontWeight: 600 }}>{exportMessage}</p>}

            <div className="data-options-grid">
              <div className="data-form-side">
                <h2 className="data-section-heading">Export Options</h2>

                <div className="data-input-group">
                  <label className="data-label">Data Type</label>
                  <div className="data-select-wrap">
                    <select
                      className="data-select"
                      value={exportDataType}
                      onChange={(e) => setExportDataType(e.target.value)}
                    >
                      <option value="Sales Data">Sales Data (summary report)</option>
                      <option value="Sales Line Items">Sales Line Items (re-importable)</option>
                      <option value="Inventory Data">Inventory Data</option>
                      <option value="Products Data">Products Data</option>
                      <option value="Restocking Logs">Restocking Logs</option>
                      <option value="Supplier Records">Supplier Records</option>
                    </select>
                    <ChevronDown size={18} className="data-select-icon" />
                  </div>
                </div>

                <div className="data-input-group">
                  <label className="data-label">Date Range</label>
                  <div className="data-select-wrap">
                    <select
                      className="data-select"
                      value={exportDateRange}
                      onChange={(e) => setExportDateRange(e.target.value)}
                    >
                      <option value="Today">Today</option>
                      <option value="This Week">This Week</option>
                      <option value="This Month">This Month</option>
                      <option value="Custom">Custom</option>
                    </select>
                    <ChevronDown size={18} className="data-select-icon" />
                  </div>
                </div>

                {exportDateRange === "Custom" && (
                  <div style={{ display: "flex", gap: 12 }}>
                    <div className="data-input-group" style={{ flex: 1 }}>
                      <label className="data-label">From</label>
                      <input
                        type="date"
                        className="data-select"
                        value={exportDateFrom}
                        onChange={(e) => setExportDateFrom(e.target.value)}
                      />
                    </div>
                    <div className="data-input-group" style={{ flex: 1 }}>
                      <label className="data-label">To</label>
                      <input
                        type="date"
                        className="data-select"
                        value={exportDateTo}
                        onChange={(e) => setExportDateTo(e.target.value)}
                      />
                    </div>
                  </div>
                )}

                <p style={{ fontSize: "0.75rem", color: "#9ca3af", margin: 0 }}>
                  Note: Inventory Data, Products Data, and Supplier Records are always exported as a
                  full current snapshot — the date range above only filters Sales Data, Sales Line
                  Items, and Restocking Logs.
                </p>
                {isReimportable ? (
                  <p style={{ fontSize: "0.75rem", color: "#16a34a", margin: "8px 0 0 0", fontWeight: 600 }}>
                    ✓ This CSV can be re-imported directly via the "Import Sales Data" button on the Sales page.
                  </p>
                ) : (
                  exportDataType === "Sales Data" && (
                    <p style={{ fontSize: "0.75rem", color: "#9ca3af", margin: "8px 0 0 0" }}>
                      This is a summary report (one row per sale) for record-keeping — it can't be
                      re-imported. Use "Sales Line Items" above if you need a re-importable CSV.
                    </p>
                  )
                )}
              </div>

              <div className="data-action-card">
                <FileText size={38} className="data-action-icon" />
                <h3 className="data-action-title">Ready to Export</h3>
                <p className="data-action-sub">Select your preferred format to download</p>
                <div className="data-format-buttons">
                  <button
                    type="button"
                    className="data-btn-format"
                    onClick={() => handleExport("CSV")}
                    disabled={isExporting !== null}
                  >
                    <Download size={14} /> {isExporting === "CSV" ? "Exporting…" : "CSV"}
                  </button>
                  <button
                    type="button"
                    className="data-btn-format"
                    onClick={() => handleExport("Excel")}
                    disabled={isExporting !== null}
                  >
                    <Download size={14} /> {isExporting === "Excel" ? "Exporting…" : "Excel"}
                  </button>
                  <button
                    type="button"
                    className="data-btn-format"
                    onClick={() => handleExport("PDF")}
                    disabled={isExporting !== null}
                  >
                    <Download size={14} /> {isExporting === "PDF" ? "Exporting…" : "PDF"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ------------------------------------------------------------------- */}
        {/* 2. EXPORT LOGS TAB                                                  */}
        {/* ------------------------------------------------------------------- */}
        {activeTab === "Export Logs" && (
          <div className="data-logs-wrapper">
            <div className="data-table-card">
              <div className="data-card-header">
                <AlertTriangle size={22} className="data-alert-icon" />
                <h2>Data Export History</h2>
              </div>
              <div className="data-table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>File</th>
                      <th>Type</th>
                      <th>Format</th>
                      <th>Status</th>
                      <th>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {isLoadingLogs && (
                      <tr><td colSpan={5} style={{ textAlign: "center", padding: 24 }}>Loading…</td></tr>
                    )}
                    {!isLoadingLogs && exportLogs.length === 0 && (
                      <tr><td colSpan={5} style={{ textAlign: "center", padding: 24 }}>No exports yet.</td></tr>
                    )}
                    {!isLoadingLogs &&
                      exportLogs.map((log) => (
                        <tr
                          key={log.id}
                          className={selectedLogRow === log.id ? "selected" : ""}
                          onClick={() => setSelectedLogRow(log.id)}
                        >
                          <td>{log.file}</td>
                          <td>{log.type}</td>
                          <td>{log.format}</td>
                          <td>
                            <span className={`data-status-pill ${log.status === "Successful" ? "success" : "failed"}`}>
                              {log.status}
                            </span>
                          </td>
                          <td>{new Date(log.date).toLocaleString()}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ------------------------------------------------------------------- */}
        {/* 3. IMPORT TAB                                                       */}
        {/* ------------------------------------------------------------------- */}
        {activeTab === "Import" && (
          <div className="data-card-container">
            <p style={{ color: "#6b7280", fontSize: "0.85rem", marginBottom: 12 }}>
              For importing Sales data specifically, use the "Import Sales Data" button on the{" "}
              <strong>Sales</strong> page — it expects the "Sales Line Items" CSV format (export one from
              this page's Export tab, or use the page's own "CSV Template" button). General bulk import
              for other data types isn't wired up yet.
            </p>
            <div className="data-options-grid">
              <div className="data-form-side">
                <h2 className="data-section-heading">Import Options</h2>

                <div className="data-input-group">
                  <label className="data-label">Data Type</label>
                  <div className="data-select-wrap">
                    <select
                      className="data-select"
                      value={importDataType}
                      onChange={(e) => setImportDataType(e.target.value)}
                    >
                      <option value="Sales Data">Sales Data</option>
                      <option value="Inventory Data">Inventory Data</option>
                      <option value="Products Data">Products Data</option>
                      <option value="Supplier Records">Supplier Records</option>
                    </select>
                    <ChevronDown size={18} className="data-select-icon" />
                  </div>
                </div>

                <div className="data-input-group">
                  <label className="data-label">Date Range</label>
                  <div className="data-select-wrap">
                    <select
                      className="data-select"
                      value={importDateRange}
                      onChange={(e) => setImportDateRange(e.target.value)}
                    >
                      <option value="Today">Today</option>
                      <option value="This Week">This Week</option>
                      <option value="This Month">This Month</option>
                      <option value="Custom">Custom</option>
                    </select>
                    <ChevronDown size={18} className="data-select-icon" />
                  </div>
                </div>
              </div>

              <div className="data-action-card">
                <FileText size={38} className="data-action-icon" />
                <h3 className="data-action-title">Ready to Import</h3>
                <p className="data-action-sub">
                  {importDataType === "Sales Data" ? "Go to the Sales page to import" : "Not yet available for this data type"}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ------------------------------------------------------------------- */}
        {/* 4. IMPORT LOGS TAB                                                  */}
        {/* ------------------------------------------------------------------- */}
        {activeTab === "Import Logs" && (
          <div className="data-logs-wrapper">
            <div className="data-table-card">
              <div className="data-card-header">
                <AlertTriangle size={22} className="data-alert-icon" />
                <h2>Data Import History</h2>
              </div>
              <div className="data-table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>File</th>
                      <th>Type</th>
                      <th>Format</th>
                      <th>Status</th>
                      <th>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {isLoadingLogs && (
                      <tr><td colSpan={5} style={{ textAlign: "center", padding: 24 }}>Loading…</td></tr>
                    )}
                    {!isLoadingLogs && importLogs.length === 0 && (
                      <tr><td colSpan={5} style={{ textAlign: "center", padding: 24 }}>No imports yet.</td></tr>
                    )}
                    {!isLoadingLogs &&
                      importLogs.map((log) => (
                        <tr
                          key={log.id}
                          className={selectedLogRow === log.id ? "selected" : ""}
                          onClick={() => setSelectedLogRow(log.id)}
                        >
                          <td>{log.file}</td>
                          <td>{log.type}</td>
                          <td>{log.format}</td>
                          <td>
                            <span className={`data-status-pill ${log.status === "Successful" ? "success" : "failed"}`}>
                              {log.status}
                            </span>
                          </td>
                          <td>{new Date(log.date).toLocaleString()}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}