"""
Small Flask microservice wrapping the trained XGBoost model. The Node
backend calls this over HTTP rather than embedding Python in the Node
process, since there's no mature XGBoost binding for Node.

Run:
    python serve.py
Listens on http://localhost:5001 by default.
"""

import os
import joblib
import numpy as np
from flask import Flask, request, jsonify
from dotenv import load_dotenv

from features import FEATURE_NAMES, build_feature_vector, vector_to_row

load_dotenv()

MODEL_PATH = os.path.join(os.path.dirname(__file__), "restock_model.pkl")

app = Flask(__name__)
model = None


def load_model():
    global model
    if not os.path.exists(MODEL_PATH):
        raise FileNotFoundError(
            f"No trained model found at {MODEL_PATH}. Run `python train_model.py` first."
        )
    model = joblib.load(MODEL_PATH)


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "model_loaded": model is not None})


@app.route("/predict", methods=["POST"])
def predict():
    """
    Body: { "items": [ { "productId": 1, "current_stock": 5, "reorder_level": 10,
                          "sales_7d": 14, "sales_30d": 60, "sales_90d": 180,
                          "lead_time_days": 3, "days_since_last_restock": 12 }, ... ] }

    Returns: { "results": [ { "productId": 1, "confidence": 87.3,
                               "recommendedQuantity": 25 }, ... ] }
    """
    payload = request.get_json(force=True)
    items = payload.get("items", [])
    if not items:
        return jsonify({"error": "items array is required"}), 400

    results = []
    for item in items:
        vec = build_feature_vector(item)
        row = np.array([vector_to_row(vec)])
        confidence = float(model.predict_proba(row)[0, 1]) * 100

        # Recommended quantity: enough to cover expected demand through the
        # supplier's lead time plus a safety buffer, topped up to at least
        # the reorder level — a straightforward, explainable formula rather
        # than something the classifier itself outputs (it predicts urgency,
        # not order size).
        avg_daily = vec["avg_daily_sales_30d"]
        lead_time = vec["lead_time_days"]
        safety_buffer_days = 7
        demand_during_lead_time = avg_daily * (lead_time + safety_buffer_days)
        recommended_qty = max(
            demand_during_lead_time - vec["current_stock"] + vec["reorder_level"],
            vec["reorder_level"],
        )

        results.append({
            "productId": item.get("productId"),
            "confidence": round(confidence, 1),
            "recommendedQuantity": int(round(recommended_qty)),
        })

    return jsonify({"results": results})


if __name__ == "__main__":
    load_model()
    port = int(os.getenv("ML_SERVICE_PORT", 5001))
    app.run(host="0.0.0.0", port=port)