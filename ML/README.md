# GasTrack Restocking ML Service

Predicts a **confidence score (0–100%)** that a product genuinely needs
restocking soon, using an XGBoost classifier trained on stock levels, sales
velocity, and restocking history. Also computes a recommended reorder
quantity based on demand during the supplier's lead time.

## Setup

```bash
cd ML
python -m venv venv
.\venv\Scripts\python.exe -m pip install -r requirements.txt
if (!(Test-Path .env)) { Copy-Item .env.example .env }
```

## Train the model

```bash
.\venv\Scripts\python.exe train_model.py
```

This pulls your real `InventoryTransaction` history from MySQL (if there's
enough of it) and blends it with a synthetic bootstrap dataset so the model
works well even on a fresh install. It saves `restock_model.pkl` in this
folder. Re-run this periodically (e.g. monthly) as real sales data
accumulates — the more real history you have, the less the model leans on
synthetic data.

## Run the service

```bash
.\venv\Scripts\python.exe serve.py
```

Listens on `http://localhost:5001`. Leave this running alongside your Node
backend — `restockRoutes.js` calls it automatically when generating
recommendations, and falls back to a simple heuristic if this service is
unreachable, so the app keeps working even if you haven't started it.

## Verify it's working

```bash
Invoke-RestMethod http://localhost:5001/health
```

Should return `{"status":"ok","model_loaded":true}`.

Set `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, and `DB_NAME` in `ML/.env`
to the same database used by the backend. Set `ML_SERVICE_PORT=5001`. Both
entry points load this file relative to their own directory and accept UTF-8
with or without a byte-order mark. Prediction uses the saved model and does
not require a database query; training uses MySQL history when available.

Checked locally on October 16, 2026: service health, a prediction request,
backend ML client integration, MySQL connectivity, Python compilation, and
`pip check` passed. The saved model was reused; it was not retrained.
See the root README for the prediction smoke test and full system status.
