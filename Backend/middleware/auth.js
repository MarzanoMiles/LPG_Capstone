const jwt = require("jsonwebtoken");
const ApiError = require("../utils/apiError");
const {resourceFor,describeAction} = require('../utils/activityDescriptions');
const { auditContext } = require('../utils/databaseAudit');
const { normalizeModuleAccess } = require('../utils/moduleAccess');

function toActivityType(method) {
  if (method === "POST") return "Create";
  if (method === "PUT" || method === "PATCH") return "Update";
  if (method === "DELETE") return "Delete";
  return "Action";
}

function toModule(pathname, method) {
  if (pathname.startsWith("/user-settings/roles")) return "Role Settings";
  if (pathname.startsWith("/user-settings/branches")) return "Branch Settings";
  if (pathname.startsWith("/user-settings/warehouses")) return "Warehouse Settings";
  if (pathname.startsWith('/brands')) return 'Brand Settings';
  if (pathname.startsWith('/categories')) return 'Category Settings';
  if (pathname.startsWith('/suppliers/types')) return 'Supplier Type Settings';
  if (pathname.startsWith('/settings/')) {
    const labels = {operations:'Business Operations',profile:'Company Profile',logo:'Company Logo',tax:'Tax',receipt:'Receipt',system:'System'};
    return `${labels[pathname.split('/')[2]] || 'General'} Settings`;
  }
  if (pathname.startsWith("/auth")) return "Authentication";
  if (pathname.startsWith("/dashboard")) return "Dashboard — Activity Timeline";

  if (pathname.startsWith("/inventory/stock-in")) return "Inventory — Stock In";
  if (pathname.startsWith("/inventory/stock-out")) return "Inventory — Stock Out";
  if (pathname.startsWith("/inventory/transfer")) return "Inventory — Transfer";
  if (pathname.startsWith("/inventory/import")) return "Inventory — Inventory Import";
  if (pathname.startsWith("/inventory/adjust")) return "Inventory — Stock Adjustment";
  if (pathname.startsWith("/inventory/transactions")) return "Inventory — Inventory Transactions";
  if (pathname.startsWith("/inventory") || pathname.startsWith("/warehouses")) return "Inventory — Inventory Management";

  if (pathname.startsWith("/products") || pathname.startsWith("/brands") || pathname.startsWith("/categories")) {
    return "Products — Product Management";
  }

  if (pathname.startsWith("/sales/import")) return "Sales — Sales Import";
  if (pathname.startsWith("/sales")) return "Sales — Sales Records";

  if (pathname.startsWith("/restocking")) return "Restocking — Restocking Assistant";
  if (pathname.startsWith("/purchase-orders")) return "Restocking — Purchase Order History";

  if (pathname.startsWith("/customers")) return "Order and Delivery — Customer Management";
  if (pathname.startsWith("/deliveries")) return "Order and Delivery — Delivery Management";
  if (pathname.startsWith("/orders")) return "Order and Delivery — Order Management";

  if (pathname.startsWith("/suppliers")) return "Suppliers — Supplier Management";

  if (pathname.startsWith("/reports")) {
    return method === "POST"
      ? "Report and Compliance — Report Generation"
      : "Report and Compliance — Report Management";
  }

  if (pathname.startsWith("/data/import")) return "Data — Data Import";
  if (pathname.startsWith("/data/export")) return "Data — Data Export";
  if (pathname.startsWith("/data")) return "Data — Data Module";

  if (pathname.startsWith("/users/activity-log")) return "Users — Activity Log";
  if (pathname.startsWith("/users") || pathname.startsWith("/roles")) return "Users — User Management";

  if (pathname.startsWith("/settings")) return "Settings — User Preferences";

  if (pathname.startsWith("/payments")) return "POS Terminal — Checkout";

  return "System";
}

function toAction(pathname, method) {
  if (method === 'GET') return /document/.test(pathname) ? 'Preview' : /export/.test(pathname) ? 'Export' : 'View';
  const last = pathname.split('/').filter(Boolean).at(-1);
  const actions = { 'document-preview':'Preview', export:'Export', import:'Import', confirm:'Approve',
    reject:'Reject', dispatch:'Dispatch', complete:'Complete', fail:'Failed Attempt', settle:'Settle',
    cancel:'Cancel', receive:'Receive', refund:'Refund', 'pickup-claim':'Claim', 'pickup-settlement':'Settle',
    generate:'Generate', send:'Send', 'send-payment':'Send Payment', logout:'Logout',
    'stock-in':'Stock In', 'stock-out':'Stock Out', transfer:'Transfer', adjust:'Adjustment', adjustment:'Adjustment' };
  return actions[last] || toActivityType(method);
}

function allowedModules(req, pathname) {
  const base = pathname.split('/').filter(Boolean)[0];
  const write = req.method !== 'GET';
  const map = {
    users:['users'], 'user-settings':['users'], roles:['users'], dashboard:['dashboard'],
    inventory: write ? ['inventory'] : ['inventory','pos','orders','restocking'],
    warehouses:['inventory','pos','orders','restocking','users','sales','products'],
    products: write ? ['products'] : ['products','pos','inventory','orders','restocking','sales'],
    brands: write ? ['products'] : ['products','inventory','pos','restocking','report','data'],
    categories: write ? ['products'] : ['products','inventory','pos','restocking'],
    sales: write ? (pathname === '/sales' ? ['pos'] : ['sales']) : ['sales','pos','orders','report'],
    payments:['pos','orders','restocking'], customers:['orders','pos'], 'delivery-fee':['pos','orders'],
    orders: write ? ['orders','pos'] : ['orders','pos','sales'], deliveries: pathname === '/deliveries/drivers' && !write ? ['orders','pos'] : ['orders'],
    suppliers: write ? ['suppliers'] : ['suppliers','products','restocking'],
    restocking:['restocking'], 'purchase-orders':['restocking'], reports:['report'], data:['data'],
    settings: write ? ['settings'] : ['settings','pos','orders','restocking','inventory','report'],
  };
  return map[base] || [];
}

function inferRecordId(pathname) {
  const segments = String(pathname || '').split('?')[0].split('/').filter(Boolean);
  return segments.reverse().find(segment => /^[A-Z][A-Z0-9]*-[A-Za-z0-9]+$/.test(segment) || /^\d+$/.test(segment)) || null;
}

async function authenticate(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return next(new ApiError(401, "Missing or invalid authorization token"));

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const [actors] = await require('../config/db').query(`SELECT u.UserID AS userId,u.CompanyID AS companyId,u.RoleID AS roleId,r.RoleName AS roleName,u.Email AS email,u.Status AS status,u.ModuleAccess AS moduleAccess FROM User u JOIN Role r ON r.RoleID=u.RoleID WHERE u.UserID=:id`, {id:payload.userId});
    if (!actors[0] || actors[0].status !== 'Active') return next(new ApiError(401, 'Account is inactive or unavailable'));
    req.user = actors[0];
    payload.roleName = req.user.roleName;
    if (["driver", "drivers"].includes(String(payload.roleName).trim().toLowerCase()) && req.baseUrl !== "/deliveries" && req.baseUrl !== "/auth") {
      return next(new ApiError(403, "Drivers may only access their assigned delivery queue."));
    }

    const pathname = String(req.originalUrl || "").split("?")[0];
    const method = String(req.method || "GET").toUpperCase();

    const permissions = normalizeModuleAccess(req.user.moduleAccess);
    req.user.moduleAccess = permissions;
    const required = allowedModules(req, pathname);
    if (required.length && !required.some(key => permissions[key])) {
      return next(new ApiError(403, 'Module access is disabled for this account.'));
    }

    const context = { userId:req.user.userId, module:toModule(pathname, method),
      action:toAction(pathname, method), recordId:inferRecordId(pathname),
      resource:resourceFor(pathname), description:describeAction(toAction(pathname, method),resourceFor(pathname)), records:0 };
    const originalJson = res.json;
    res.json = function(body) {
      context.recordId ||= body?.id || body?.saleId || body?.orderId || body?.purchaseOrderId || body?.deliveryId || null;
      return originalJson.call(this,body);
    };
    // Only committed database changes produce activity entries.
    auditContext.run(context, next);
  } catch (error) {
    if (["JsonWebTokenError", "TokenExpiredError", "NotBeforeError"].includes(error.name)) return next(new ApiError(401, "Invalid or expired token"));
    next(error);
  }
}

function canonicalRole(role) {
  const raw = String(role || "").trim().toLowerCase();
  if (!raw) return "";

  if (raw === "admin" || raw === "administrator") return "administrator";
  if (raw === "manager" || raw === "operations supervisor") return "operations supervisor";

  return raw;
}

function authorize(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) return next(new ApiError(401, "Not authenticated"));

    const userRole = canonicalRole(req.user.roleName);
    const allowed = new Set(allowedRoles.map(canonicalRole));

    if (allowedRoles.length && !allowed.has(userRole)) {
      return next(new ApiError(403, "You do not have permission to perform this action"));
    }
    next();
  };
}

module.exports = { authenticate, authorize };
