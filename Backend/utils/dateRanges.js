// Resolves a named date range (or explicit custom bounds) into { start, end } SQL DATE strings.
function resolveDateRange(dateRange, dateFrom, dateTo) {
  const today = new Date();
  const iso = (d) => d.toISOString().slice(0, 10);

  if (dateRange === "Custom") {
    if (!dateFrom || !dateTo) throw new Error("dateFrom and dateTo are required for a Custom date range.");
    return { start: dateFrom, end: dateTo };
  }

  if (dateRange === "This Week") {
    const day = today.getDay(); // 0 = Sunday
    const diffToMonday = day === 0 ? -6 : 1 - day;
    const monday = new Date(today);
    monday.setDate(today.getDate() + diffToMonday);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return { start: iso(monday), end: iso(sunday) };
  }

  if (dateRange === "This Month") {
    const first = new Date(today.getFullYear(), today.getMonth(), 1);
    const last = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    return { start: iso(first), end: iso(last) };
  }

  // Default: "Today"
  return { start: iso(today), end: iso(today) };
}

module.exports = { resolveDateRange };