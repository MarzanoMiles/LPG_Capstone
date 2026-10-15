import "./PageLayout.css";

export default function PageLayout({ children, className = "", contentClassName = "" }) {
  return (
    <div className={`page-layout ${className}`}>
      <div className={`page-container ${contentClassName}`}>{children}</div>
    </div>
  );
}

export function PageHeader({ title, children }) {
  return (
    <header className="page-header">
      <h1 className="module-title">{title}</h1>
      {children && <div className="page-header-actions">{children}</div>}
    </header>
  );
}
