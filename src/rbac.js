export const MODULE_KEYS = {
  dashboard: "dashboard",
  pos: "pos",
  inventory: "inventory",
  products: "products",
  sales: "sales",
  restocking: "restocking",
  orders: "orders",
  suppliers: "suppliers",
  report: "report",
  data: "data",
  users: "users",
  settings: "settings",
};

export function normalizeModuleAccess(raw) {
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch { raw = null; }
  }
  const aliases = {
    'pos terminal': 'pos', 'order and delivery': 'orders', 'orders and deliveries': 'orders',
    'report generation & compliance': 'report', 'report and compliance': 'report',
    'report generation and compliance': 'report', 'data module': 'data',
  };
  const result = Object.fromEntries(Object.keys(MODULE_KEYS).map(key => [key, false]));
  const entries = Array.isArray(raw) ? raw.map(key => [key, true])
    : raw && typeof raw === 'object' ? Object.entries(raw) : [];
  for (const [name, value] of entries) {
    const label = String(name).trim().toLowerCase();
    const key = aliases[label] || label;
    if (Object.hasOwn(MODULE_KEYS, key)) result[key] = value === true || value === 1 || value === '1' || value === 'true';
  }
  return result;
}

export function canonicalRole(roleName) {
  const role = String(roleName || "").trim().toLowerCase();
  if (!role) return "";
  if (role === "admin") return "administrator";
  return role;
}

const ROLE_ACCESS = {
  administrator: [
    MODULE_KEYS.dashboard,
    MODULE_KEYS.pos,
    MODULE_KEYS.inventory,
    MODULE_KEYS.products,
    MODULE_KEYS.sales,
    MODULE_KEYS.restocking,
    MODULE_KEYS.orders,
    MODULE_KEYS.suppliers,
    MODULE_KEYS.report,
    MODULE_KEYS.data,
    MODULE_KEYS.users,
    MODULE_KEYS.settings,
  ],
  "operations supervisor": [
    MODULE_KEYS.dashboard,
    MODULE_KEYS.inventory,
    MODULE_KEYS.products,
    MODULE_KEYS.sales,
    MODULE_KEYS.restocking,
    MODULE_KEYS.suppliers,
    MODULE_KEYS.report,
    MODULE_KEYS.data,
    MODULE_KEYS.users,
    MODULE_KEYS.settings,
  ],
  "assistant operations supervisor": [
    MODULE_KEYS.dashboard,
    MODULE_KEYS.inventory,
    MODULE_KEYS.products,
    MODULE_KEYS.sales,
    MODULE_KEYS.restocking,
    MODULE_KEYS.suppliers,
    MODULE_KEYS.report,
    MODULE_KEYS.data,
  ],
  "store supervisor": [
    MODULE_KEYS.dashboard,
    MODULE_KEYS.pos,
    MODULE_KEYS.inventory,
    MODULE_KEYS.products,
    MODULE_KEYS.sales,
    MODULE_KEYS.orders,
    MODULE_KEYS.report,
    MODULE_KEYS.data,
  ],
  "assistant store supervisor": [
    MODULE_KEYS.dashboard,
    MODULE_KEYS.pos,
    MODULE_KEYS.inventory,
    MODULE_KEYS.products,
    MODULE_KEYS.sales,
    MODULE_KEYS.orders,
  ],
  stockman: [MODULE_KEYS.inventory],
  "head maintenance": [MODULE_KEYS.inventory],
  drivers: [MODULE_KEYS.orders],
  helpers: [MODULE_KEYS.orders],
};

export function getAllowedNavIdsByRole(roleName) {
  return ROLE_ACCESS[canonicalRole(roleName)] || [];
}

export function buildModulesByRole(roleName) {
  const allowed = new Set(getAllowedNavIdsByRole(roleName));
  return {
    dashboard: allowed.has(MODULE_KEYS.dashboard),
    pos: allowed.has(MODULE_KEYS.pos),
    inventory: allowed.has(MODULE_KEYS.inventory),
    products: allowed.has(MODULE_KEYS.products),
    sales: allowed.has(MODULE_KEYS.sales),
    restocking: allowed.has(MODULE_KEYS.restocking),
    orders: allowed.has(MODULE_KEYS.orders),
    suppliers: allowed.has(MODULE_KEYS.suppliers),
    report: allowed.has(MODULE_KEYS.report),
    data: allowed.has(MODULE_KEYS.data),
    users: allowed.has(MODULE_KEYS.users),
    settings: allowed.has(MODULE_KEYS.settings),
  };
}


export function getAllowedNavIds(user) {
  const access = normalizeModuleAccess(user?.moduleAccess);
  return Object.keys(MODULE_KEYS).filter(key => access[key]);
}
