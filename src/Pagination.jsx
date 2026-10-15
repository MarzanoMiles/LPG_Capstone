import { ChevronLeft, ChevronRight } from "lucide-react";
import "./Pagination.css";

export default function Pagination({ currentPage, totalPages, onPageChange }) {
  const count = Math.max(1, totalPages);
  const current = Math.max(1, Math.min(currentPage, count));
  const start = Math.max(1, Math.min(current - 3, count - 5));
  const pages = Array.from({ length: Math.min(6, count) }, (_, index) => start + index);

  return (
    <nav className="table-pagination" aria-label="Table pagination">
      <div className="table-pagination-controls">
        <button type="button" onClick={() => onPageChange(current - 1)} disabled={current === 1} aria-label="Previous page">
          <ChevronLeft size={16} />
        </button>
        {pages.map((page) => (
          <button key={page} type="button" className={page === current ? "active" : undefined}
            aria-label={`Page ${page}`} aria-current={page === current ? "page" : undefined}
            onClick={() => onPageChange(page)}>
            {page}
          </button>
        ))}
        <button type="button" onClick={() => onPageChange(current + 1)} disabled={current === count} aria-label="Next page">
          <ChevronRight size={16} />
        </button>
      </div>
    </nav>
  );
}
