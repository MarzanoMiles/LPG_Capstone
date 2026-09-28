"""
Trains an XGBoost classifier that predicts the CONFIDENCE (0-100%) that a
product genuinely needs restocking now, based on its stock level, sales
velocity, and how long it's been since it was last restocked.

Label definition (used for training): a product-snapshot is labeled "needs
restocking" (1) if, going forward from that snapshot, it actually ran at or
below its reorder level within the next 14 days — i.e., we're training the
model to recognize the pattern that historically preceded a real stockout
risk, not just "is it currently low" (which the existing heuristic already
does fine on its own).

Two data sources, used together:
  1. Real historical data pulled from your MySQL InventoryTransaction ledger,
     if there's enough of it.
  2. A synthetic bootstrap dataset, so the model trains and is genuinely
     useful even on a brand-new install with little sales history yet. As
     real data accumulates, re-running this script will lean more on it.

Run:
    cd ML
    pip install -r requirements.txt --break-system-packages
    python train_model.py
"""

import os
import random
import numpy as np
import pandas as pd
import mysql.connector
from xgboost import XGBClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score, roc_auc_score
import joblib
from dotenv import load_dotenv

from features import FEATURE_NAMES, build_feature_vector, vector_to_row

load_dotenv()

MODEL_PATH = os.path.join(os.path.dirname(__file__), "restock_model.pkl")


def get_db_connection():
    return mysql.connector.connect(
        host=os.getenv("DB_HOST", "127.0.0.1"),
        port=int(os.getenv("DB_PORT", 3306)),
        user=os.getenv("DB_USER", "root"),
        password=os.getenv("DB_PASSWORD", ""),
        database=os.getenv("DB_NAME", "gastrack"),
    )


def load_real_training_data():
    """
    Pulls every InventoryTransaction for every product and reconstructs daily
    stock levels + sales, then builds labeled (features, label) rows: for
    each day, does stock fall to/below reorder level within the next 14 days?
    """
    try:
        conn = get_db_connection()
    except Exception as e:
        print(f"Could not connect to MySQL ({e}); skipping real data.")
        return pd.DataFrame()

    cursor = conn.cursor(dictionary=True)
    cursor.execute("""
        SELECT i.ProductID AS product_id, p.ReorderLevel AS reorder_level,
               t.TransactionType AS type, t.Quantity AS qty, t.Reason AS reason,
               t.TransactionDate AS date
        FROM InventoryTransaction t
        JOIN Inventory i ON i.InventoryID = t.InventoryID
        JOIN Product p ON p.ProductID = i.ProductID
        ORDER BY i.ProductID, t.TransactionDate
    """)
    tx_rows = cursor.fetchall()
    cursor.execute("SELECT ProductID, SupplierID FROM Product")
    product_supplier = {r["ProductID"]: r["SupplierID"] for r in cursor.fetchall()}
    cursor.execute("SELECT SupplierID, LeadTimeDays FROM Supplier")
    supplier_lead_time = {r["SupplierID"]: r["LeadTimeDays"] or 3 for r in cursor.fetchall()}
    conn.close()

    if len(tx_rows) < 30:
        print(f"Only {len(tx_rows)} real transactions found — too little history to train on alone.")
        return pd.DataFrame()

    df = pd.DataFrame(tx_rows)
    df["date"] = pd.to_datetime(df["date"]).dt.date
    df["signed_qty"] = df.apply(lambda r: r["qty"] if r["type"] == "Stock In" else -r["qty"], axis=1)
    df["sale_qty"] = df.apply(lambda r: r["qty"] if r["reason"] == "Sale" else 0, axis=1)
    df["restock_qty"] = df.apply(lambda r: r["qty"] if (r["type"] == "Stock In" and r["reason"] == "Purchase") else 0, axis=1)

    records = []
    for product_id, group in df.groupby("product_id"):
        group = group.sort_values("date")
        reorder_level = group["reorder_level"].iloc[0]
        lead_time = supplier_lead_time.get(product_supplier.get(product_id), 3)

        # Reconstruct a running stock balance ending at the last known transaction (approximate — good enough for training signal)
        running_stock = 0
        daily = {}
        last_restock_date = None
        for _, row in group.iterrows():
            running_stock += row["signed_qty"]
            d = row["date"]
            daily.setdefault(d, {"stock": running_stock, "sale": 0, "restock": 0})
            daily[d]["stock"] = running_stock
            daily[d]["sale"] += row["sale_qty"]
            if row["restock_qty"] > 0:
                last_restock_date = d

        dates_sorted = sorted(daily.keys())
        for idx, d in enumerate(dates_sorted):
            future_dates = [fd for fd in dates_sorted if idx < dates_sorted.index(fd) <= idx + 14] if False else None
            # 14-day-forward label: did stock hit/go below reorder level in the next 14 calendar days?
            future_window = [
                daily[fd]["stock"] for fd in dates_sorted
                if 0 < (fd - d).days <= 14
            ]
            label = 1 if any(s <= reorder_level for s in future_window) else 0

            sales_7d = sum(daily[fd]["sale"] for fd in dates_sorted if 0 <= (d - fd).days < 7)
            sales_30d = sum(daily[fd]["sale"] for fd in dates_sorted if 0 <= (d - fd).days < 30)
            sales_90d = sum(daily[fd]["sale"] for fd in dates_sorted if 0 <= (d - fd).days < 90)
            days_since_restock = (d - last_restock_date).days if last_restock_date else 30

            vec = build_feature_vector({
                "current_stock": daily[d]["stock"],
                "reorder_level": reorder_level,
                "sales_7d": sales_7d,
                "sales_30d": sales_30d,
                "sales_90d": sales_90d,
                "lead_time_days": lead_time,
                "days_since_last_restock": days_since_restock,
            })
            vec["label"] = label
            records.append(vec)

    return pd.DataFrame(records)


def generate_synthetic_data(n=4000, seed=42):
    """
    Bootstraps a plausible training set so the model is useful even before
    real sales history accumulates. Encodes the same intuitive pattern a
    human inventory manager would recognize: low days-of-cover relative to
    lead time + an accelerating sales trend = high confidence restocking is
    needed soon.
    """
    rng = random.Random(seed)
    records = []
    for _ in range(n):
        reorder_level = rng.choice([5, 10, 15, 20, 30])
        avg_daily = rng.uniform(0.1, 5.0)
        days_of_cover_target = rng.uniform(0, 40)
        current_stock = max(0.0, avg_daily * days_of_cover_target + rng.uniform(-3, 3))
        lead_time = rng.choice([1, 2, 3, 5, 7, 10])
        days_since_restock = rng.uniform(0, 60)
        trend_factor = rng.uniform(-0.5, 1.5)  # >1 means accelerating sales

        sales_30d = avg_daily * 30
        sales_7d = avg_daily * 7 * (1 + trend_factor * 0.3)
        sales_90d = avg_daily * 90 * rng.uniform(0.85, 1.15)

        vec = build_feature_vector({
            "current_stock": current_stock,
            "reorder_level": reorder_level,
            "sales_7d": max(sales_7d, 0),
            "sales_30d": max(sales_30d, 0),
            "sales_90d": max(sales_90d, 0),
            "lead_time_days": lead_time,
            "days_since_last_restock": days_since_restock,
        })

        # Ground truth rule the synthetic label follows: will days_of_cover
        # run out before restocking + lead time can realistically save it?
        buffer_days = vec["days_of_cover"] - lead_time
        will_need_restock = buffer_days < 5 or vec["stock_to_reorder_ratio"] < 1.3
        # add some label noise so the model doesn't just memorize a hard rule
        if rng.random() < 0.06:
            will_need_restock = not will_need_restock

        vec["label"] = 1 if will_need_restock else 0
        records.append(vec)

    return pd.DataFrame(records)


def main():
    print("Loading real historical data from MySQL (if available)...")
    real_df = load_real_training_data()
    print(f"Real rows: {len(real_df)}")

    print("Generating synthetic bootstrap data...")
    synthetic_df = generate_synthetic_data(n=4000)
    print(f"Synthetic rows: {len(synthetic_df)}")

    df = pd.concat([real_df, synthetic_df], ignore_index=True) if len(real_df) else synthetic_df
    print(f"Total training rows: {len(df)}")

    X = df[FEATURE_NAMES]
    y = df["label"]

    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42, stratify=y)

    model = XGBClassifier(
        n_estimators=200,
        max_depth=4,
        learning_rate=0.08,
        subsample=0.85,
        colsample_bytree=0.85,
        eval_metric="logloss",
        random_state=42,
    )
    model.fit(X_train, y_train)

    preds = model.predict(X_test)
    probs = model.predict_proba(X_test)[:, 1]
    print(f"Test accuracy: {accuracy_score(y_test, preds):.3f}")
    print(f"Test ROC-AUC:  {roc_auc_score(y_test, probs):.3f}")

    joblib.dump(model, MODEL_PATH)
    print(f"Model saved to {MODEL_PATH}")


if __name__ == "__main__":
    main()