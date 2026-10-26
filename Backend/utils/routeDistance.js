require("dotenv").config();
const ApiError = require("./apiError");

const ORS_BASE = "https://api.openrouteservice.org";
const TIMEOUT_MS = 20000;
const MAX_ATTEMPTS = 3;
const geocodeCache = new Map();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function apiKey() {
  if (!process.env.ORS_API_KEY) {
    throw new ApiError(503, "Distance service is not configured. Set ORS_API_KEY in Backend/.env.");
  }
  return process.env.ORS_API_KEY;
}

function describe(err) {
  if (!err) return "unknown error";
  if (err.name === "AbortError" || /aborted/i.test(err.message || "")) return "the distance service timed out";
  return err.message || String(err);
}

// Calls ORS with our own timeout. Retries timeouts, network errors, 429 and 5xx with a growing pause.
async function orsRequest(label, path, { method = "GET", body, query } = {}) {
  const url = new URL(ORS_BASE + path);
  for (const [k, v] of Object.entries(query || {})) url.searchParams.set(k, v);

  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method,
        headers: {
          Authorization: apiKey(),
          Accept: "application/json",
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (res.ok) return await res.json();

      const text = await res.text().catch(() => "");
      let message = text.slice(0, 300);
      try { message = JSON.parse(text)?.error?.message || JSON.parse(text)?.error || message; } catch { /* keep raw text */ }
      if (typeof message !== "string") message = JSON.stringify(message);
      lastError = Object.assign(new Error(message || `HTTP ${res.status}`), { status: res.status });

      if (res.status === 401 || res.status === 403) {
        throw new ApiError(503, "Distance service rejected the API key. Check ORS_API_KEY.");
      }
      if (res.status !== 429 && res.status < 500) throw lastError; // 4xx like "no route" will not improve on retry
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof ApiError) throw err;
      if (err.status && err.status !== 429 && err.status < 500) throw err;
      lastError = err;
    }
    if (attempt < MAX_ATTEMPTS) {
      console.warn(`ORS ${label} attempt ${attempt} failed (${describe(lastError)}), retrying.`);
      await sleep(attempt * 1500);
    }
  }
  console.error(`ORS ${label} failed after ${MAX_ATTEMPTS} attempts:`, describe(lastError));
  throw lastError;
}

// "Blk 4, Purok 3, Brgy. San Nicolas, San Pablo City, Laguna" -> full text, then shorter versions.
function addressCandidates(text) {
  const parts = String(text).split(",").map((p) => p.trim()).filter(Boolean);
  const out = [];
  for (let i = 0; i < parts.length && parts.length - i >= 2; i++) out.push(parts.slice(i).join(", "));
  if (!out.length) out.push(String(text).trim());
  return out;
}

async function geocodeOne(text) {
  const data = await orsRequest("geocode", "/geocode/search", {
    query: { api_key: apiKey(), text, "boundary.country": "PH", size: 1 },
  });
  const feature = data?.features?.[0];
  return feature ? feature.geometry.coordinates.slice(0, 2) : null; // [lng, lat]
}

async function geocode(text) {
  const key = String(text).trim().toLowerCase();
  if (geocodeCache.has(key)) return geocodeCache.get(key);

  let point = null;
  for (const candidate of addressCandidates(text)) {
    try {
      point = await geocodeOne(candidate);
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw new ApiError(502, `The distance service could not be reached (${describe(err)}). Please try again.`);
    }
    if (point) break;
  }
  if (!point) {
    throw new ApiError(422, `Could not locate "${text}". Include the barangay, city and province, then try again.`);
  }
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

const routeCache = new Map();

// Driving distance in km, rounded to 0.01
async function drivingDistanceKm(from, to) {
  const cacheKey = `${from.join(",")}|${to.join(",")}`;
  if (routeCache.has(cacheKey)) return routeCache.get(cacheKey);

  let data;
  try {
    data = await orsRequest("directions", "/v2/directions/driving-car", {
      method: "POST",
      body: { coordinates: [from, to], radiuses: [-1, -1] },
    });
  } catch (err) {
    if (err instanceof ApiError) throw err;
    const detail = describe(err);
    if (err.status === 429) throw new ApiError(429, "Too many distance requests. Wait a minute and try again.");
    if (err.status && err.status < 500) {
      throw new ApiError(422, `No driving route found between the store and that address (${detail}).`);
    }
    throw new ApiError(502, `The distance service could not be reached (${detail}). Please try again.`);
  }
  const meters = data?.routes?.[0]?.summary?.distance;
  if (!Number.isFinite(meters)) throw new ApiError(422, "No driving route found for that address.");
  const km = Math.round(meters / 10) / 100;
  routeCache.set(cacheKey, km);
  return km;
}

module.exports = { geocode, storeLocation, drivingDistanceKm };