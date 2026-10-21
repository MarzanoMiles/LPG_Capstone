import PageLayout, { PageHeader } from "./PageLayout";
import Pagination from "./Pagination";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Download, FileSearch, Printer, Trash2, Upload } from "lucide-react";
import SalesReceiptModal from "./SalesReceiptModal";
import { buildSaleReceipt } from "./utils/saleReceipt";
import { apiRequest } from "./api";
import { printReceipt } from "./utils/receipt";
import "./Sales.css";

const PAGE_SIZE = 5;



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
    "IMP-1,P-7KF29M3Q,2,249.00,0,Cash,2026-01-05 10:30:00\n" +
    "IMP-1,P-P3N8XK5T,1,907.00,0,Cash,2026-01-05 10:30:00\n" +
    "IMP-2,P-BX6T9R4N,1,603.00,20,GCash,2026-01-06 14:00:00\n";
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
  const [currentPage, setCurrentPage] = useState(1);

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

  const totalPages = Math.max(1, Math.ceil(filteredSales.length / PAGE_SIZE));
  const validatedCurrentPage = Math.min(currentPage, totalPages);
  const paginatedSales = useMemo(() => {
    return filteredSales.slice(
      (validatedCurrentPage - 1) * PAGE_SIZE,
      validatedCurrentPage * PAGE_SIZE
    );
  }, [filteredSales, validatedCurrentPage]);

  const goToPage = (page) => {
    if (page < 1 || page > totalPages) return;
    setCurrentPage(page);
  };

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, cashierFilter, statusFilter]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

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
      setSelectedSale(buildSaleReceipt(full));
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
      await printReceipt(buildSaleReceipt(full));
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
    <PageLayout className="sales-page" contentClassName="sales-inner">

      <PageHeader title="Sales" />

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
        <div className="paginated-table-scroll">
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
                paginatedSales.map((sale) => (
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

        {!isLoading && (
          <Pagination currentPage={validatedCurrentPage} totalPages={totalPages} onPageChange={goToPage} />
        )}
      </div>


      <SalesReceiptModal
        isOpen={!!selectedSale}
        sale={selectedSale}
        onClose={() => setSelectedSale(null)}
      />
    </PageLayout>
  );
}



