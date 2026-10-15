const jwt = require("jsonwebtoken");
const ApiError = require("../utils/apiError");
const { logUserActivity } = require("../utils/activityLogger");

function toActivityType(method) {
  if (method === "POST") return "Create";
  if (method === "PUT" || method === "PATCH") return "Update";
  if (method === "DELETE") return "Delete";
  return "Action";
}

function toModule(pathname, method) {
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

function shouldSkipAutoLog(pathname, method) {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(method)) return true;

  // These routes already write explicit activity records.
  if (pathname.startsWith("/users")) return true;
  if (pathname.startsWith("/products")) return true;
  if (pathname.startsWith("/auth")) return true;

  // Keep existing explicit Inventory force-delete audit behavior as the source of truth.
  if (method === "DELETE" && /^\/inventory\/[^/]+$/.test(pathname)) return true;

  return false;
}

function inferRecordId(pathname) {
  const actionSegments = new Set(["confirm", "cancel", "receive", "import", "export", "generate", "rescore", "quick"]);
  const segments = String(pathname || "").split("?")[0].split("/").filter(Boolean);
  if (!segments.length) return null;

  const last = segments[segments.length - 1];
  if (actionSegments.has(last) && segments.length >= 2) {
    return segments[segments.length - 2] || null;
  }

  if (/^[A-Za-z]+-\d+$/i.test(last) || /^\d+$/.test(last)) {
    return last;
  }

  return null;
}

function buildDescription(method, pathname) {
  if (method === "POST" && pathname.includes("/import")) return "Imported records";
  if (method === "POST" && pathname.includes("/export")) return "Exported records";
  if (method === "PUT" && pathname.includes("/confirm")) return "Confirmed a record";
  if (method === "PUT" && pathname.includes("/cancel")) return "Cancelled a record";
  if (method === "PUT" && pathname.includes("/receive")) return "Marked a record as received";
  return `${method} ${pathname}`;
}

function authenticate(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return next(new ApiError(401, "Missing or invalid authorization token"));

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload; // { userId, companyId, roleId, roleName, email }
    if (["driver", "drivers"].includes(String(payload.roleName).trim().toLowerCase()) && req.baseUrl !== "/deliveries" && req.baseUrl !== "/auth") {
      return next(new ApiError(403, "Drivers may only access their assigned delivery queue."));
    }

    const pathname = String(req.path || "");
    const method = String(req.method || "GET").toUpperCase();

    if (!shouldSkipAutoLog(pathname, method)) {
      res.on("finish", () => {
        if (res.statusCode >= 400) return;
        logUserActivity({
          userId: req.user.userId,
          activityType: toActivityType(method),
          module: toModule(pathname, method),
          recordId: inferRecordId(pathname),
          description: buildDescription(method, pathname),
        }).catch(() => {
          // Best-effort audit logging; do not break request lifecycle.
        });
      });
    }

    next();
  } catch {
    next(new ApiError(401, "Invalid or expired token"));
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
