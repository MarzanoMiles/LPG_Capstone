import React, { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Download, FileSearch, Printer, Trash2, Upload } from "lucide-react";
import SalesInfoModal from "./SalesInfoModal";
import { apiRequest } from "./api";
import { printReceipt } from "./utils/receipt";
import "./Sales.css";

function formatPeso(amount) {
  return `₱ ${Number(amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function StatCard({ label, value }) {
  return (
    <div className="sales-stat-card">
      <p className="sales-stat-label">{label}</p>
      <p className="sales-stat-value">{value}</p>
    </div>
  );
}

function FilterSelect({ value, onChange, options }) {
  return (
    <div className="sales-select-wrap">
      <select className="sales-select" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((opt) => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>
      <ChevronDown size={16} className="sales-select-icon" />
    </div>
  );
}

function downloadCsvTemplate() {
  const template =
    "SaleRef,ProductID,Quantity,UnitPrice,Discount,PaymentMethod,SaleDate\n" +
    "IMP-1,1,2,249.00,0,Cash,2026-01-05 10:30:00\n" +
    "IMP-1,3,1,907.00,0,Cash,2026-01-05 10:30:00\n" +
    "IMP-2,2,1,603.00,20,GCash,2026-01-06 14:00:00\n";
  const blob = new Blob([template], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "sales_import_template.csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function Sales() {
  const [sales, setSales] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [importMessage, setImportMessage] = useState("");

  const [searchTerm, setSearchTerm] = useState("");
  const [cashierFilter, setCashierFilter] = useState("All Cashier");
  const [statusFilter, setStatusFilter] = useState("All Status");
  const [selectedSale, setSelectedSale] = useState(null);
  const [isSaleLoading, setIsSaleLoading] = useState(false);
  const [printingId, setPrintingId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [isImporting, setIsImporting] = useState(false);

  const fileInputRef = useRef(null);

  const loadSales = () => {
    setIsLoading(true);
    apiRequest("/sales")
      .then((data) => {
        setSales(data);
        setLoadError("");
      })
      .catch((err) => setLoadError(err.message || "Failed to load sales."))
      .finally(() => setIsLoading(false));
  };

  useEffect(() => {
    loadSales();
  }, []);

  const cashiers = useMemo(
    () => ["All Cashier", ...new Set(sales.map((s) => s.cashierName || s.cashier))],
    [sales]
  );
  const statuses = useMemo(
    () => ["All Status", ...new Set(sales.map((s) => s.status).filter(Boolean))],
    [sales]
  );

  const filteredSales = useMemo(() => {
    return sales.filter((s) => {
      const matchesSearch = s.saleNo.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesCashier =
        cashierFilter === "All Cashier" || (s.cashierName || s.cashier) === cashierFilter;
      const matchesStatus = statusFilter === "All Status" || s.status === statusFilter;
      return matchesSearch && matchesCashier && matchesStatus;
    });
  }, [sales, searchTerm, cashierFilter, statusFilter]);

  const statCards = useMemo(() => {
    const today = new Date().toDateString();
    const todaysSales = sales.filter((s) => new Date(s.datetime).toDateString() === today);
    const todaysTotal = todaysSales.reduce((sum, s) => sum + Number(s.amount), 0);
    const avg = sales.length ? sales.reduce((sum, s) => sum + Number(s.amount), 0) / sales.length : 0;
    return [
      { label: "Today's Sale", value: formatPeso(todaysTotal) },
      { label: "Total Transactions", value: String(sales.length) },
      { label: "Average Order Value", value: formatPeso(avg) },
      { label: "Today's Transactions", value: String(todaysSales.length) },
    ];
  }, [sales]);

  const handleImportClick = () => {
    setActionError("");
    setImportMessage("");
    fileInputRef.current?.click();
  };

  const handleFileSelected = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    const adjustInventory = window.confirm(
      "Should this import also deduct current stock levels for the imported items?\n\n" +
        "Click OK to deduct stock (use this if these sales haven't been recorded in inventory yet).\n" +
        "Click Cancel to skip stock changes (use this for backfilling old historical records)."
    );

    setIsImporting(true);
    setActionError("");
    setImportMessage("");
    try {
      const csvText = await file.text();
      const result = await apiRequest("/sales/import", {
        method: "POST",
        body: JSON.stringify({ csvText, adjustInventory, fileName: file.name }),
      });
      setImportMessage(
        `Imported ${result.imported} sale(s).${result.skipped ? ` ${result.skipped} row group(s) skipped — check console for details.` : ""}`
      );
      if (result.errors?.length) console.warn("Import errors:", result.errors);
      loadSales();
    } catch (err) {
      setActionError(err.message || "Failed to import sales CSV.");
    } finally {
      setIsImporting(false);
    }
  };

  const handleView = async (sale) => {
    setActionError("");
    setIsSaleLoading(true);
    try {
      const full = await apiRequest(`/sales/${sale.id}`);
      setSelectedSale(full);
    } catch (err) {
      setActionError(err.message || "Failed to load sale details.");
    } finally {
      setIsSaleLoading(false);
    }
  };

  const handlePrint = async (sale) => {
    setActionError("");
    setPrintingId(sale.id);
    try {
      const full = await apiRequest(`/sales/${sale.id}`);
      const items = (full.items || []).map((it) => ({
        name: it.name,
        qty: it.qty,
        unitPrice: Number(it.costPrice),
        subtotal: Number(it.subtotal),
      }));
      const subtotal = items.reduce((s, it) => s + it.subtotal, 0);
      const discount = Number(full.discount || 0);
      const totalAmount = Number(full.amount || 0);
      const vat = totalAmount - subtotal + discount; // back-calculated since GET /sales/:id doesn't store vat separately

      printReceipt({
        saleNo: full.saleNo,
        datetime: full.datetime,
        cashierName: full.cashierName,
        orderType: full.type,
        items,
        subtotal,
        discount,
        vat: vat > 0 ? vat : 0,
        totalAmount,
      });
    } catch (err) {
      setActionError(err.message || "Failed to load sale for printing.");
    } finally {
      setPrintingId(null);
    }
  };

  const handleDelete = async (sale) => {
    const confirmed = window.confirm(
      `Void sale ${sale.saleNo}? This restores the sold stock back to inventory and cannot be undone.`
    );
    if (!confirmed) return;

    setActionError("");
    setDeletingId(sale.id);
    try {
      await apiRequest(`/sales/${sale.id}`, { method: "DELETE" });
      loadSales();
    } catch (err) {
      setActionError(err.message || "Failed to void sale.");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="sales-page">
      <div className="sales-inner">
        <h1 className="sales-title">Sales</h1>

        {loadError && <p style={{ color: "#dc2626", fontWeight: 600 }}>{loadError}</p>}
        {actionError && <p style={{ color: "#dc2626", fontWeight: 600 }}>{actionError}</p>}
        {importMessage && <p style={{ color: "#16a34a", fontWeight: 600 }}>{importMessage}</p>}

        <div className="sales-stat-grid">
          {statCards.map((card) => (
            <StatCard key={card.label} {...card} />
          ))}
        </div>

        <div className="sales-toolbar">
          <input
            type="text"
            placeholder="Search By Sales ID"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="sales-search-input"
          />

          <FilterSelect value={cashierFilter} onChange={setCashierFilter} options={cashiers} />
          <FilterSelect value={statusFilter} onChange={setStatusFilter} options={statuses} />

          <button type="button" className="import-btn" onClick={downloadCsvTemplate} style={{ marginLeft: 0, background: "#6b7280" }}>
            <Download size={16} />
            CSV Template
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            style={{ display: "none" }}
            onChange={handleFileSelected}
          />
          <button type="button" className="import-btn" onClick={handleImportClick} disabled={isImporting}>
            <Upload size={16} />
            {isImporting ? "Importing…" : "Import Sales Data"}
          </button>
        </div>

        <div className="sales-table-wrap">
          <table className="sales-table">
            <thead>
              <tr>
                <th>Sales ID</th>
                <th>Date and Time</th>
                <th>Cashier</th>
                <th>Order ID</th>
                <th>Type</th>
                <th>Amount</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={7} style={{ textAlign: "center", padding: 24 }}>Loading…</td></tr>
              )}
              {!isLoading &&
                filteredSales.map((sale) => (
                  <tr key={sale.id}>
                    <td>{sale.saleNo}</td>
                    <td>{new Date(sale.datetime).toLocaleString()}</td>
                    <td>{sale.cashierName || sale.cashier}</td>
                    <td>{sale.orderId}</td>
                    <td>{sale.type || "—"}</td>
                    <td>{formatPeso(sale.amount)}</td>
                    <td>
                      <div className="sales-action-icons">
                        <button
                          type="button"
                          className="sales-action-icon view"
                          aria-label={`View ${sale.saleNo}`}
                          onClick={() => handleView(sale)}
                          disabled={isSaleLoading}
                        >
                          <FileSearch size={16} />
                        </button>
                        <button
                          type="button"
                          className="sales-action-icon print"
                          aria-label={`Print receipt for ${sale.saleNo}`}
                          onClick={() => handlePrint(sale)}
                          disabled={printingId === sale.id}
                        >
                          <Printer size={16} />
                        </button>
                        <button
                          type="button"
                          className="sales-action-icon delete"
                          aria-label={`Void ${sale.saleNo}`}
                          onClick={() => handleDelete(sale)}
                          disabled={deletingId === sale.id}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              {!isLoading && filteredSales.length === 0 && (
                <tr>
                  <td colSpan={7} className="no-results-cell">
                    No sales match your filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <SalesInfoModal
        isOpen={!!selectedSale}
        sale={
          selectedSale
            ? {
                id: selectedSale.saleNo,
                datetime: new Date(selectedSale.datetime).toLocaleString(),
                cashier: selectedSale.cashier,
                cashierName: selectedSale.cashierName,
                orderId: selectedSale.orderId,
                discount: Number(selectedSale.discount),
                items: (selectedSale.items || []).map((it) => ({
                  name: it.name,
                  qty: it.qty,
                  costPrice: Number(it.costPrice),
                })),
              }
            : null
        }
        storeName="GasTrack Store"
        onClose={() => setSelectedSale(null)}
      />
    </div>
  );
}