"""
Feature engineering shared by both training (train_model.py) and serving
(serve.py), so the exact same features are computed the same way in both
places — a common source of silent ML bugs is when training and serving
compute a feature slightly differently.
"""

FEATURE_NAMES = [
    "current_stock",
    "reorder_level",
    "stock_to_reorder_ratio",
    "avg_daily_sales_7d",
    "avg_daily_sales_30d",
    "avg_daily_sales_90d",
    "days_of_cover",       # current_stock / avg_daily_sales_30d (capped)
    "lead_time_days",
    "days_since_last_restock",
    "sales_trend",         # avg_daily_sales_7d - avg_daily_sales_30d (accelerating vs slowing)
]


def build_feature_vector(raw):
    """
    raw: dict with keys matching the inputs the caller has readily available:
      current_stock, reorder_level, sales_7d, sales_30d, sales_90d,
      lead_time_days, days_since_last_restock

    Returns a dict with every key in FEATURE_NAMES, in a stable numeric form,
    with sane defaults so a brand-new product with no sales history doesn't
    blow up the model (it'll just get a low-confidence prediction, which is
    the correct behavior when there's no evidence yet).
    """
    current_stock = max(float(raw.get("current_stock", 0)), 0.0)
    reorder_level = max(float(raw.get("reorder_level", 1)), 1.0)  # avoid div-by-zero
    sales_7d_total = max(float(raw.get("sales_7d", 0)), 0.0)
    sales_30d_total = max(float(raw.get("sales_30d", 0)), 0.0)
    sales_90d_total = max(float(raw.get("sales_90d", 0)), 0.0)
    lead_time_days = max(float(raw.get("lead_time_days", 3)), 0.0)
    days_since_last_restock = max(float(raw.get("days_since_last_restock", 30)), 0.0)

    avg_daily_7d = sales_7d_total / 7.0
    avg_daily_30d = sales_30d_total / 30.0
    avg_daily_90d = sales_90d_total / 90.0

    days_of_cover = current_stock / avg_daily_30d if avg_daily_30d > 0.01 else 999.0
    days_of_cover = min(days_of_cover, 999.0)

    return {
        "current_stock": current_stock,
        "reorder_level": reorder_level,
        "stock_to_reorder_ratio": current_stock / reorder_level,
        "avg_daily_sales_7d": avg_daily_7d,
        "avg_daily_sales_30d": avg_daily_30d,
        "avg_daily_sales_90d": avg_daily_90d,
        "days_of_cover": days_of_cover,
        "lead_time_days": lead_time_days,
        "days_since_last_restock": days_since_last_restock,
        "sales_trend": avg_daily_7d - avg_daily_30d,
    }


def vector_to_row(vec):
    """Ordered list matching FEATURE_NAMES, for feeding into the model."""
    return [vec[name] for name in FEATURE_NAMES]