require("dotenv").config();
const Openrouteservice = require("openrouteservice-js");
const ApiError = require("./apiError");

const geocodeCache = new Map();

function client(Service) {
  if (!process.env.ORS_API_KEY) {
    throw new ApiError(503, "Distance service is not configured. Set ORS_API_KEY in Backend/.env.");
  }
  return new Service({ api_key: process.env.ORS_API_KEY });
}

// Returns [lng, lat]
async function geocode(text) {
  const key = String(text).trim().toLowerCase();
  if (geocodeCache.has(key)) return geocodeCache.get(key);
  let result;
  try {
    result = await client(Openrouteservice.Geocode).geocode({
      text: String(text).trim(),
      boundary_country: ["PH"],
      size: 1,
    });
  } catch (err) {
    if (err instanceof ApiError) throw err;
    console.error("ORS geocode failed:", err?.message || err);
    throw new ApiError(502, "Distance service is unavailable. Please try again.");
  }
  const feature = result?.features?.[0];
  if (!feature) {
    throw new ApiError(422, `Could not locate "${text}". Add the barangay, city and province, then try again.`);
  }
  const point = feature.geometry.coordinates.slice(0, 2);
  geocodeCache.set(key, point);
  return point;
}

async function storeLocation(address) {
  const lat = Number(process.env.STORE_LAT);
  const lng = Number(process.env.STORE_LNG);
  if (process.env.STORE_LAT && process.env.STORE_LNG && Number.isFinite(lat) && Number.isFinite(lng)) {
    return [lng, lat];
  }
  if (!String(address || "").trim()) {
    throw new ApiError(409, "Set your business address in Settings (or STORE_LAT/STORE_LNG) before estimating delivery.");
  }
  return geocode(address);
}

// Driving distance in km, rounded to 0.01
async function drivingDistanceKm(from, to) {
  let result;
  try {
    result = await client(Openrouteservice.Directions).calculate({
      coordinates: [from, to],
      profile: "driving-car",
      format: "json",
    });
  } catch (err) {
    if (err instanceof ApiError) throw err;
    console.error("ORS directions failed:", err?.message || err);
    throw new ApiError(422, "No driving route found between the store and that address. Check the address and try again.");
  }
  const meters = result?.routes?.[0]?.summary?.distance;
  if (!Number.isFinite(meters)) throw new ApiError(422, "No driving route found for that address.");
  return Math.round(meters / 10) / 100;
}

module.exports = { geocode, storeLocation, drivingDistanceKm };