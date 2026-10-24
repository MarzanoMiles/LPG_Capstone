// Calls the Python ML service (ML/serve.py). If it is unreachable, every function
// here falls back to a heuristic forecast, so restocking keeps working.
// finishPrediction MUST stay identical to finish_prediction in ML/features.py.

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || "http://localhost:5001";
const SERVICE_LEVEL_Z = 1.65;

function erf(x) {
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return sign * y;
}
const normalCdf = (z) => 0.5 * (1 + erf(z / Math.SQRT2));
const round1 = (n) => Math.round(n * 10) / 10;

function finishPrediction(item, predictedDemand) {
  const lead = Math.max(Number(item.lead_time_days) || 1, 1);
  const dailyDemand = predictedDemand / lead;
  const sigmaDaily = Math.max(Number(item.daily_demand_std) || 0, 0);
  const sigmaLead = Math.max(Number(item.lead_time_std_days) || 0, 0);
  const sigma = Math.sqrt(lead * sigmaDaily ** 2 + dailyDemand ** 2 * sigmaLead ** 2);
  const safetyStock = Math.ceil(SERVICE_LEVEL_Z * sigma);
  const stock = Math.max(Number(item.current_stock) || 0, 0);
  const moq = Math.max(Math.round(Number(item.min_order_quantity) || 1), 1);
  const recommendedQuantity = Math.max(Math.round(predictedDemand + safetyStock - stock), moq);
  const confidence = predictedDemand < 0.05 ? 0 : (1 - normalCdf((stock - predictedDemand) / Math.max(sigma, 0.5))) * 100;
  return { productId: item.productId, predictedDemand: round1(predictedDemand), safetyStock, recommendedQuantity, confidence: round1(confidence) };
}

function heuristicFallback(items) {
  return items.map((item) => {
    const lead = Math.max(Number(item.lead_time_days) || 1, 1);
    const dailyRate =
      0.5 * (Number(item.sales_30d) || 0) / 30 +
      0.3 * (Number(item.sales_7d) || 0) / 7 +
      0.2 * (Number(item.sales_90d) || 0) / 90;
    return finishPrediction(item, dailyRate * lead);
  });
}

async function getRestockPredictions(items) {
  if (!items.length) return [];
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(`${ML_SERVICE_URL}/predict`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`ML service returned ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data.results) || data.results.some((r) => r.predictedDemand == null)) {
      throw new Error("ML service returned an unexpected response (retrain the model?)");
    }
    return data.results;
  } catch (err) {
    console.warn(`ML service unavailable (${err.message}), using heuristic forecast.`);
    return heuristicFallback(items);
  }
}

module.exports = { getRestockPredictions, finishPrediction };