const MODULE_KEYS = ['dashboard', 'pos', 'inventory', 'products', 'sales', 'restocking',
  'orders', 'suppliers', 'report', 'data', 'users', 'settings'];
const aliases = {
  'pos terminal': 'pos', 'order and delivery': 'orders', 'orders and deliveries': 'orders',
  'report generation & compliance': 'report', 'report and compliance': 'report',
  'report generation and compliance': 'report', 'data module': 'data',
};
const emptyModuleAccess = () => Object.fromEntries(MODULE_KEYS.map(key => [key, false]));
function normalizeModuleAccess(raw) {
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch { raw = null; }
  }
  const result = emptyModuleAccess();
  const entries = Array.isArray(raw) ? raw.map(key => [key, true])
    : raw && typeof raw === 'object' ? Object.entries(raw) : [];
  for (const [name, value] of entries) {
    const label = String(name).trim().toLowerCase();
    const key = aliases[label] || label;
    if (MODULE_KEYS.includes(key)) result[key] = value === true || value === 1 || value === '1' || value === 'true';
  }
  return result;
}
module.exports = { emptyModuleAccess, normalizeModuleAccess };
