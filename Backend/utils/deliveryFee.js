const jwt = require("jsonwebtoken");
const ApiError = require("./apiError");

const PURPOSE = "delivery-fee-estimate";
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// Keep identical to src/utils/deliveryFee.js
function calculateDeliveryFee(rate, distanceKm, orderTotal) {
  if (!rate || !Number.isFinite(Number(distanceKm))) return 0;
  const freeAt = Number(rate.freeDeliverySubtotal) || 0;
  if (freeAt > 0 && Number(orderTotal) >= freeAt) return 0;
  return round2(Number(rate.baseRate) + Number(rate.perKmRate) * Number(distanceKm));
}

async function findVehicleRate(conn, companyId, name) {
  const [rows] = await conn.query(
    "SELECT VehicleRates FROM CompanySettings WHERE CompanyID=:companyId",
    { companyId }
  );
  const raw = rows[0]?.VehicleRates;
  const rates = typeof raw === "string" ? JSON.parse(raw) : raw || [];
  const wanted = String(name || "").trim().toLowerCase();
  const rate = rates.find((r) => String(r.name).trim().toLowerCase() === wanted);
  if (!rate) throw new ApiError(400, "Select a configured delivery vehicle.");
  return rate;
}

function signEstimate({ companyId, address, vehicleType, distanceKm }) {
  return jwt.sign({ purpose: PURPOSE, companyId, address, vehicleType, distanceKm }, process.env.JWT_SECRET, {
    expiresIn: "4h",
  });
}

function verifyEstimate(token, expected) {
  if (typeof token !== "string" || !token) {
    throw new ApiError(400, "Calculate the delivery distance and fee before checkout.");
  }
  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    throw new ApiError(400, "The delivery fee estimate expired. Re-open Delivery Details and recalculate.");
  }
  if (
    payload.purpose !== PURPOSE ||
    payload.companyId !== expected.companyId ||
    payload.address !== expected.address ||
    String(payload.vehicleType).toLowerCase() !== String(expected.vehicleType || "").trim().toLowerCase() ||
    !Number.isFinite(Number(payload.distanceKm))
  ) {
    throw new ApiError(400, "Delivery details changed after the fee was calculated. Recalculate the fee.");
  }
  return { distanceKm: Number(payload.distanceKm) };
}

module.exports = { round2, calculateDeliveryFee, findVehicleRate, signEstimate, verifyEstimate };