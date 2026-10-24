"""
Trains an XGBoost REGRESSOR that forecasts total units sold per product during
its supplier lead-time window.

Data pipeline fixes:
  * Sales come from OrderDetails JOIN Order with the same status filter that
    Backend/routes/restockRoutes.js uses at inference.
  * days_since_last_restock is evaluated as of each snapshot date (only restocks
    BEFORE the snapshot are visible) and clipped at 0, so there is no leakage.
  * Features for snapshot d use only days < d; the target uses days [d, d+lead).
  * Validation is temporal. Train: windows that end 6+ months ago. Validate: the
    most recent 6 months. Windows straddling the cutoff are dropped.
  * Daily series are turned into cumulative sums, so each snapshot is O(1)
    (no nested date scans).

Run:
    cd ML
    python train_model.py
"""
import math
import os
import random
from datetime import date, timedelta

import joblib
import mysql.connector
import numpy as np
import pandas as pd
from dotenv import load_dotenv
from sklearn.metrics import mean_absolute_error, mean_squared_error
from xgboost import XGBRegressor

from features import FEATURE_NAMES, build_feature_vector

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"), encoding="utf-8-sig")

MODEL_PATH = os.path.join(os.path.dirname(__file__), "restock_model.pkl")
VALIDATION_DAYS = 183
SNAPSHOT_STEP_DAYS = 7
MIN_HISTORY_DAYS = 35
SYNTHETIC_WEIGHT = 0.25


def get_db_connection():
    return mysql.connector.connect(
        host=os.getenv("DB_HOST", "127.0.0.1"),
        port=int(os.getenv("DB_PORT", 3306)),
        user=os.getenv("DB_USER", "root"),
        password=os.getenv("DB_PASSWORD", ""),
        database=os.getenv("DB_NAME", "gastrack"),
    )


def load_real_rows():
    try:
        conn = get_db_connection()
    except Exception as e:
        print(f"Could not connect to MySQL ({e}); skipping real data.")
        return pd.DataFrame()

    cur = conn.cursor(dictionary=True)
    cur.execute("""
        SELECT od.ProductID AS product_id, DATE(o.OrderDate) AS sale_day, SUM(od.Quantity) AS qty
        FROM OrderDetails od JOIN `Order` o ON o.OrderID = od.OrderID
        WHERE o.OrderDate < CURDATE()
          AND o.OrderStatus NOT IN ('Cancelled','Unclaimed','Delivery Failed')
        GROUP BY od.ProductID, DATE(o.OrderDate)
    """)
    sales_rows = cur.fetchall()
    cur.execute("""
        SELECT DISTINCT i.ProductID AS product_id, DATE(t.TransactionDate) AS restock_day
        FROM InventoryTransaction t JOIN Inventory i ON i.InventoryID = t.InventoryID
        WHERE t.TransactionType = 'Stock In' AND t.Reason IN ('Purchase','Supplier Delivery')
          AND t.TransactionDate < CURDATE()
    """)
    restock_rows = cur.fetchall()
    cur.execute("""
        SELECT p.ProductID AS product_id, COALESCE(s.LeadTimeDays, 3) AS lead_days
        FROM Product p LEFT JOIN Supplier s ON s.SupplierID = p.SupplierID
    """)
    lead_by_product = {r["product_id"]: max(int(r["lead_days"] or 3), 1) for r in cur.fetchall()}
    conn.close()

    if not sales_rows:
        print("No sales history found.")
        return pd.DataFrame()

    restocks = {}
    for r in restock_rows:
        restocks.setdefault(r["product_id"], []).append(r["restock_day"])

    sales = pd.DataFrame(sales_rows)
    sales["sale_day"] = pd.to_datetime(sales["sale_day"])
    sales["qty"] = sales["qty"].astype(float)
    last_day = pd.Timestamp(date.today() - timedelta(days=1))
    first_day = sales["sale_day"].min()

    records = []
    for pid, grp in sales.groupby("product_id"):
        idx = pd.date_range(first_day, last_day, freq="D")
        if len(idx) < MIN_HISTORY_DAYS + 2:
            continue
        series = grp.set_index("sale_day")["qty"].reindex(idx, fill_value=0.0).to_numpy()
        lead = lead_by_product.get(pid, 3)
        cs = np.concatenate(([0.0], np.cumsum(series)))  # cs[k] = sum(series[:k])
        n = len(series)
        snapshots = np.arange(MIN_HISTORY_DAYS, n - lead + 1, SNAPSHOT_STEP_DAYS)
        if snapshots.size == 0:
            continue
        restock_days = np.array(sorted(restocks.get(pid, [])), dtype="datetime64[D]")

        for i in snapshots:
            d = idx[i].date()
            if restock_days.size:
                pos = int(np.searchsorted(restock_days, np.datetime64(d), side="left"))
                days_since = max((d - restock_days[pos - 1].astype(object)).days, 0) if pos > 0 else 30
            else:
                days_since = 30
            vec = build_feature_vector({
                "sales_7d": cs[i] - cs[i - 7],
                "lag_1wk": cs[i - 7] - cs[i - 14],
                "lag_2wk": cs[i - 14] - cs[i - 21],
                "lag_4wk": cs[i - 28] - cs[i - 35],
                "sales_30d": cs[i] - cs[max(i - 30, 0)],
                "sales_90d": cs[i] - cs[max(i - 90, 0)],
                "lead_time_days": lead,
                "days_since_last_restock": days_since,
            }, as_of=d)
            vec["target"] = float(cs[i + lead] - cs[i])
            vec["snapshot"] = pd.Timestamp(d)
            vec["target_end"] = pd.Timestamp(d) + pd.Timedelta(days=lead)
            vec["weight"] = 1.0
            records.append(vec)
    return pd.DataFrame(records)


def generate_synthetic_data(n=3000, seed=42):
    """Bootstrap rows so a young database still trains a usable model (train-only, low weight)."""
    rng = random.Random(seed)
    records = []
    for _ in range(n):
        avg_daily = rng.uniform(0.05, 6.0)
        lead = rng.choice([1, 2, 3, 5, 7, 10, 14])
        trend = rng.uniform(-0.4, 0.8)
        as_of = date(2025, 1, 1) + timedelta(days=rng.randint(0, 700))
        season = 1 + 0.15 * math.sin(2 * math.pi * as_of.timetuple().tm_yday / 365)

        def week():
            return max(0.0, avg_daily * 7 * season * rng.uniform(0.7, 1.3))

        vec = build_feature_vector({
            "sales_7d": week() * (1 + 0.3 * trend),
            "lag_1wk": week(), "lag_2wk": week(), "lag_4wk": week(),
            "sales_30d": avg_daily * 30 * rng.uniform(0.85, 1.15),
            "sales_90d": avg_daily * 90 * rng.uniform(0.8, 1.2),
            "lead_time_days": lead,
            "days_since_last_restock": rng.uniform(0, 60),
        }, as_of=as_of)
        expected = avg_daily * lead * season * (1 + 0.2 * trend)
        vec["target"] = max(0.0, rng.gauss(expected, 0.2 * expected + 0.5))
        vec["snapshot"] = pd.Timestamp(as_of)
        vec["target_end"] = pd.Timestamp(as_of) + pd.Timedelta(days=lead)
        vec["weight"] = SYNTHETIC_WEIGHT
        records.append(vec)
    return pd.DataFrame(records)


def main():
    print("Loading real sales history...")
    real = load_real_rows()
    print(f"Real snapshot rows: {len(real)}")
    synthetic = generate_synthetic_data()
    print(f"Synthetic bootstrap rows: {len(synthetic)}")

    valid = pd.DataFrame()
    if real.empty:
        print("WARNING: no usable real history; training on synthetic data only.")
        train = synthetic
    else:
        cutoff = pd.Timestamp(date.today()) - pd.Timedelta(days=VALIDATION_DAYS)
        real_train = real[real["target_end"] <= cutoff]
        valid = real[real["snapshot"] >= cutoff]
        if real_train.empty or valid.empty:
            print("WARNING: under ~7 months of history; no temporal split possible. "
                  "Training on everything without validation.")
            train, valid = pd.concat([real, synthetic], ignore_index=True), pd.DataFrame()
        else:
            train = pd.concat([real_train, synthetic], ignore_index=True)
            print(f"Temporal split at {cutoff.date()}: train={len(train)} "
                  f"(real {len(real_train)}), validation={len(valid)}")

    model = XGBRegressor(
        objective="count:poisson",
        n_estimators=400, max_depth=4, learning_rate=0.05,
        subsample=0.85, colsample_bytree=0.85, random_state=42,
        early_stopping_rounds=30 if len(valid) else None,
    )
    fit_args = {"sample_weight": train["weight"], "verbose": False}
    if len(valid):
        fit_args["eval_set"] = [(valid[FEATURE_NAMES], valid["target"])]
    model.fit(train[FEATURE_NAMES], train["target"], **fit_args)

    if len(valid):
        pred = np.clip(model.predict(valid[FEATURE_NAMES]), 0, None)
        baseline = valid["roll_avg_30d"] / 7.0 * valid["lead_time_days"]
        print(f"Validation MAE:  {mean_absolute_error(valid['target'], pred):.3f} units")
        print(f"Validation RMSE: {math.sqrt(mean_squared_error(valid['target'], pred)):.3f} units")
        print(f"Naive 30d-average baseline MAE: {mean_absolute_error(valid['target'], baseline):.3f} units")

    joblib.dump(model, MODEL_PATH)
    print(f"Model saved to {MODEL_PATH}")


if __name__ == "__main__":
    main()