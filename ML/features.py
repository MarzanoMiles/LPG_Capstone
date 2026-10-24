"""
Feature engineering + restocking maths shared by training (train_model.py) and
serving (serve.py).

Demand is aggregated into 7-day buckets measured BACKWARDS from the snapshot date
d (the snapshot day itself is excluded, so there is no look-ahead):
  sales_7d  = units sold in days [d-7,  d)
  lag_1wk   = units sold in days [d-14, d-7)
  lag_2wk   = units sold in days [d-21, d-14)
  lag_4wk   = units sold in days [d-35, d-28)
Backend/routes/restockRoutes.js computes the same windows in SQL.
"""
import math
from datetime import date

SERVICE_LEVEL_Z = 1.65  # ~95% service level

FEATURE_NAMES = [
    "month",
    "week_of_year",
    "quarter",
    "roll_avg_7d",   # average units per week over the last 7 days
    "roll_avg_30d",  # average units per week over the last 30 days
    "roll_avg_90d",  # average units per week over the last 90 days
    "lag_1wk",
    "lag_2wk",
    "lag_4wk",
    "demand_trend",  # roll_avg_7d - roll_avg_30d
    "lead_time_days",
    "days_since_last_restock",
]


def _num(raw, key, default=0.0, floor=0.0):
    try:
        return max(float(raw.get(key, default)), floor)
    except (TypeError, ValueError):
        return default


def build_feature_vector(raw, as_of=None):
    as_of = as_of or date.today()
    iso = as_of.isocalendar()
    s7, s30, s90 = _num(raw, "sales_7d"), _num(raw, "sales_30d"), _num(raw, "sales_90d")
    roll7 = s7
    roll30 = s30 * 7.0 / 30.0
    roll90 = s90 * 7.0 / 90.0
    return {
        "month": as_of.month,
        "week_of_year": int(iso[1]),
        "quarter": (as_of.month - 1) // 3 + 1,
        "roll_avg_7d": roll7,
        "roll_avg_30d": roll30,
        "roll_avg_90d": roll90,
        "lag_1wk": _num(raw, "lag_1wk"),
        "lag_2wk": _num(raw, "lag_2wk"),
        "lag_4wk": _num(raw, "lag_4wk"),
        "demand_trend": roll7 - roll30,
        "lead_time_days": _num(raw, "lead_time_days", 3.0, 1.0),
        "days_since_last_restock": _num(raw, "days_since_last_restock", 30.0),
    }


def vector_to_row(vec):
    return [vec[name] for name in FEATURE_NAMES]


def normal_cdf(z):
    return 0.5 * (1.0 + math.erf(z / math.sqrt(2.0)))


def finish_prediction(raw, predicted_demand):
    """
    SafetyStock = z * sqrt(L * sigma_d^2 + d^2 * sigma_L^2)
    RecommendedQuantity = max(PredictedDemand + SafetyStock - StockOnHand, MinOrderQuantity)
    Confidence = P(demand during lead time > stock on hand), 0-100.
    (Keep identical to finishPrediction in Backend/utils/mlClient.js.)
    """
    lead = _num(raw, "lead_time_days", 3.0, 1.0)
    daily_demand = predicted_demand / lead
    sigma_daily = _num(raw, "daily_demand_std")
    sigma_lead = _num(raw, "lead_time_std_days")
    sigma = math.sqrt(lead * sigma_daily ** 2 + (daily_demand ** 2) * sigma_lead ** 2)
    safety_stock = int(math.ceil(SERVICE_LEVEL_Z * sigma))
    stock = _num(raw, "current_stock")
    moq = max(int(round(_num(raw, "min_order_quantity", 1.0, 1.0))), 1)
    recommended = max(int(round(predicted_demand + safety_stock - stock)), moq)
    if predicted_demand < 0.05:
        confidence = 0.0
    else:
        confidence = (1.0 - normal_cdf((stock - predicted_demand) / max(sigma, 0.5))) * 100.0
    return {
        "productId": raw.get("productId"),
        "predictedDemand": round(predicted_demand, 1),
        "safetyStock": safety_stock,
        "recommendedQuantity": recommended,
        "confidence": round(confidence, 1),
    }