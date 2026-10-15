export function customerPageData(customers, {search = '', type = '', page = 1, pageSize = 10} = {}) {
  const q = search.trim().toLowerCase();
  const filtered = customers.filter(c => (!type || c.type === type) &&
    (!q || [c.id,c.name,c.companyName,c.firstName,c.lastName,c.phone,c.address].some(value => String(value || '').toLowerCase().includes(q))));
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.max(1, Math.min(page,totalPages));
  return {filtered,totalPages,currentPage,rows:filtered.slice((currentPage-1)*pageSize,currentPage*pageSize)};
}
