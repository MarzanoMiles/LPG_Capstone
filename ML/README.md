# GasTrack Restocking ML Service

Predicts a **confidence score (0–100%)** that a product genuinely needs
restocking soon, using an XGBoost classifier trained on stock levels, sales
velocity, and restocking history. Also computes a recommended reorder
quantity based on demand during the supplier's lead time.

## Setup

```bash
cd ML
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt --break-system-packages
cp .env.example .env            # fill in your DB credentials (same as backend/.env)
```

## Train the model

```bash
python train_model.py
```

This pulls your real `InventoryTransaction` history from MySQL (if there's
enough of it) and blends it with a synthetic bootstrap dataset so the model
works well even on a fresh install. It saves `restock_model.pkl` in this
folder. Re-run this periodically (e.g. monthly) as real sales data
accumulates — the more real history you have, the less the model leans on
synthetic data.

## Run the service

```bash
python serve.py
```

Listens on `http://localhost:5001`. Leave this running alongside your Node
backend — `restockRoutes.js` calls it automatically when generating
recommendations, and falls back to a simple heuristic if this service is
unreachable, so the app keeps working even if you haven't started it.

## Verify it's working

```bash
curl http://localhost:5001/health
```

Should return `{"status":"ok","model_loaded":true}`.