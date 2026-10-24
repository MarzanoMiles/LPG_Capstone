"""
Flask microservice around the trained XGBoost demand regressor.
Run: python serve.py   (listens on http://localhost:5001)
"""
import os
from datetime import date

import joblib
import numpy as np
from dotenv import load_dotenv
from flask import Flask, request, jsonify

from features import build_feature_vector, vector_to_row, finish_prediction

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"), encoding="utf-8-sig")

MODEL_PATH = os.path.join(os.path.dirname(__file__), "restock_model.pkl")
app = Flask(__name__)
model = None


def load_model():
    global model
    if not os.path.exists(MODEL_PATH):
        raise FileNotFoundError(f"No trained model at {MODEL_PATH}. Run `python train_model.py` first.")
    loaded = joblib.load(MODEL_PATH)
    if hasattr(loaded, "predict_proba"):
        raise RuntimeError("restock_model.pkl is the old classifier. Delete it and run `python train_model.py`.")
    model = loaded


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "model_loaded": model is not None, "model_type": "XGBRegressor"})


@app.route("/predict", methods=["POST"])
def predict():
    """
    Body: { "items": [ { productId, current_stock, lead_time_days, lead_time_std_days,
                         daily_demand_std, min_order_quantity, sales_7d, sales_30d, sales_90d,
                         lag_1wk, lag_2wk, lag_4wk, days_since_last_restock, as_of? } ] }
    Returns: { "results": [ { productId, predictedDemand, safetyStock,
                              recommendedQuantity, confidence } ] }
    """
    items = request.get_json(force=True).get("items", [])
    if not items:
        return jsonify({"error": "items array is required"}), 400
    results = []
    for item in items:
        as_of = date.fromisoformat(item["as_of"]) if item.get("as_of") else None
        row = np.array([vector_to_row(build_feature_vector(item, as_of))])
        predicted = max(float(model.predict(row)[0]), 0.0)
        results.append(finish_prediction(item, predicted))
    return jsonify({"results": results})


if __name__ == "__main__":
    load_model()
    app.run(host="0.0.0.0", port=int(os.getenv("ML_SERVICE_PORT", 5001)))