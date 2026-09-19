const jwt = require("jsonwebtoken");
const ApiError = require("../utils/apiError");

function authenticate(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return next(new ApiError(401, "Missing or invalid authorization token"));

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload; // { userId, companyId, roleId, roleName, email }
    next();
  } catch (err) {
    next(new ApiError(401, "Invalid or expired token"));
  }
}

function authorize(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) return next(new ApiError(401, "Not authenticated"));
    if (allowedRoles.length && !allowedRoles.includes(req.user.roleName)) {
      return next(new ApiError(403, "You do not have permission to perform this action"));
    }
    next();
  };
}

module.exports = { authenticate, authorize };