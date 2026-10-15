import PageLayout, { PageHeader } from "./PageLayout";
import Pagination from "./Pagination";
import React, { useEffect, useState } from "react";
import { Search, ChevronDown, Plus, FileText, Edit, Trash2 } from "lucide-react";
import AddSupplierModal from "./AddSupplierModal";
import ViewSupplierModal from "./ViewSupplierModal";
import DeleteSupplierModal from "./DeleteSupplierModal";
import { apiRequest } from "./api";
import "./Suppliers.css";

const PAGE_SIZE = 5;

export default function Suppliers() {
  const [suppliers, setSuppliers] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [supplierToDelete, setSupplierToDelete] = useState(null);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All Status");

  // Modal Control States
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isViewModalOpen, setIsViewModalOpen] = useState(false);
  const [selectedSupplier, setSelectedSupplier] = useState(null);

  const loadSuppliers = () => {
    setIsLoading(true);
    const params = new URLSearchParams();
    if (search.trim()) params.set("search", search.trim());
    if (statusFilter !== "All Status") params.set("status", statusFilter);
    const endpoint = params.toString() ? `/suppliers?${params.toString()}` : "/suppliers";

    apiRequest(endpoint)
      .then((data) => {
        setSuppliers(data);
        setLoadError("");
      })
      .catch((err) => setLoadError(err.message || "Failed to load suppliers."))
      .finally(() => setIsLoading(false));
  };

  useEffect(() => {
    loadSuppliers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, statusFilter]);

  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(suppliers.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paginatedRows = suppliers.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter]);

  // Open Modal for "Add Supplier"
  const handleOpenAddModal = () => {
    setSelectedSupplier(null);
    setIsModalOpen(true);
  };

  // Open Modal for "Edit Supplier"
  const handleOpenEditModal = (supplier) => {
    setSelectedSupplier(supplier);
    setIsModalOpen(true);
  };

  // Open Modal for "View Details"
  const handleOpenViewModal = (supplier) => {
    setSelectedSupplier(supplier);
    setIsViewModalOpen(true);
  };

  const handleDelete = async (supplier) => {
    await apiRequest(`/suppliers/${supplier.id}`, { method: "DELETE" });
    setSuppliers((rows) => rows.filter((row) => row.id !== supplier.id));
    loadSuppliers();
  };

  return (
    <PageLayout className="suppliers-page">
      <PageHeader title="Suppliers" />

      {loadError && <p style={{ color: "#dc2626", fontWeight: 600 }}>{loadError}</p>}

      {/* Toolbar Controls */}
      <div className="suppliers-toolbar">
        <div className="suppliers-search-wrap">
          <input
            type="text"
            className="suppliers-search-input"
            placeholder="Search by Supplier Name, ID or Contact Person"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Search size={18} className="suppliers-search-icon" />
        </div>

        <div className="suppliers-select-wrap">
          <select
            className="suppliers-select"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="All Status">All Status</option>
            <option value="Active">Active</option>
            <option value="Inactive">Inactive</option>
          </select>
          <ChevronDown size={16} className="suppliers-select-icon" />
        </div>

        <button type="button" className="btn-add-supplier" onClick={handleOpenAddModal}>
          <Plus size={18} /> Add Supplier
        </button>
      </div>

      {/* Table Section */}
      <div className="suppliers-section-title">Supplier List</div>

      <div className="suppliers-table-wrap">
        <div className="paginated-table-scroll">
          <table className="suppliers-table">
            <thead>
              <tr>
                <th>Supplier ID</th>
                <th>Supplier Name</th>
                <th>Contact Person</th>
                <th>Email</th>
                <th>Address</th>
                <th>Contact</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={7} style={{ textAlign: "center", padding: 24 }}>Loading…</td></tr>
              )}
              {!isLoading && suppliers.length === 0 && (
                <tr><td colSpan={7} style={{ textAlign: "center", padding: 24 }}>No suppliers found.</td></tr>
              )}
              {!isLoading &&
                paginatedRows.map((item) => (
                  <tr key={item.id}>
                    <td>{item.id}</td>
                    <td>{item.name}</td>
                    <td>{item.contactPerson || "—"}</td>
                    <td>{item.email || "—"}</td>
                    <td>{item.address || "—"}</td>
                    <td>{item.phone || "\u2014"}</td>
                    <td>
                      <div className="suppliers-actions-cell">
                        <button
                          type="button"
                          className="action-icon-btn view"
                          title="View Details"
                          onClick={() => handleOpenViewModal(item)}
                        >
                          <FileText size={18} />
                        </button>
                        <button
                          type="button"
                          className="action-icon-btn edit"
                          title="Edit Supplier"
                          onClick={() => handleOpenEditModal(item)}
                        >
                          <Edit size={18} />
                        </button>
                        <button
                          type="button"
                          className="action-icon-btn delete"
                          title="Delete Supplier"
                          aria-label={`Delete supplier ${item.name}`}
                          onClick={() => setSupplierToDelete(item)}
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setPage} />
      </div>

      {supplierToDelete && (
        <DeleteSupplierModal supplier={supplierToDelete} onClose={() => setSupplierToDelete(null)} onConfirm={handleDelete} />
      )}

      {/* Add / Edit Supplier Pop-up Window */}
      <AddSupplierModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        selectedSupplier={selectedSupplier}
        onSaved={loadSuppliers}
      />

      {/* View Supplier Details Pop-up Window */}
      <ViewSupplierModal
        key={`${selectedSupplier?.id}-${isViewModalOpen}`}
        isOpen={isViewModalOpen}
        onClose={() => setIsViewModalOpen(false)}
        supplier={selectedSupplier}
      />
    </PageLayout>
  );
}
