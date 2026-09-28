// Calls the Python ML microservice (ML/serve.py) for restock confidence
// scoring. If the service is unreachable (not started, crashed, etc.), every
// function here falls back to a simple heuristic so restocking keeps working
// without the ML layer — it's an enhancement, not a hard dependency.

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || "http://localhost:5001";

function heuristicFallback(items) {
  return items.map((item) => {
    const daysOfCover =
      item.sales_30d > 0 ? (item.current_stock / (item.sales_30d / 30)) : 999;
    const ratio = item.current_stock / Math.max(item.reorder_level, 1);
    const confidence = Math.max(0, Math.min(100, 100 - daysOfCover * 3 - ratio * 10));
    const avgDaily = item.sales_30d / 30;
    const recommendedQuantity = Math.max(
      Math.round(avgDaily * (item.lead_time_days + 7) - item.current_stock + item.reorder_level),
      item.reorder_level
    );
    return {
      productId: item.productId,
      confidence: Math.round(confidence * 10) / 10,
      recommendedQuantity: Math.max(recommendedQuantity, 1),
    };
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
    return data.results;
  } catch (err) {
    console.warn(`ML service unavailable (${err.message}) — using heuristic fallback for restock confidence.`);
    return heuristicFallback(items);
  }
}

module.exports = { getRestockPredictions };