# GasTrack

Current system: React/Vite frontend (`src`), Express API (`Backend`), MySQL,
and the Flask restocking service (`ML`). Use Windows PowerShell commands below.

## Run the system

Start each service in a separate terminal from the project root.

Backend:

```powershell
cd Backend
npm.cmd run dev
```

ML service:

```powershell
cd ML
.\venv\Scripts\python.exe serve.py
```

Frontend:

```powershell
npm.cmd run dev
```

Open http://localhost:5173. The API uses port 4000 and ML uses port 5001.
Stop each service with Ctrl+C. Use your existing account and password.

Both `npm.cmd run dev` and `npm.cmd start` in `Backend` check the database
before starting. If it already contains tables, seeding is skipped. Restarting
preserves saved records, edits, deletions, accounts, and passwords.

Company registration collects the registered company name, branch name, complete
address, administrator first and last name, email, password, and confirmation.
For an existing database or one restored from an older snapshot, run
`npm.cmd run migrate:company-registration` from `Backend` before using registration.
This removes the legacy DTI/SEC, DOE license, and city/municipality columns
from Company if present, including any values stored in those columns.

Run `npm.cmd run migrate:company-profile` from `Backend` when upgrading an older
database. This renames Business Profile `FullName` to `CompanyName`, preserving
its value, and removes the unused CompanySettings `Branch`, `Warehouse`, and
`Brand` columns. Registration fills the profile company name, address, and email.
The primary branch is created in Manage Branches and assigned to the initial
administrator and default warehouse.

## Current database is the only seed

The configured database was captured on October 16, 2026 in
`Backend/db/snapshots/current.sql`. This snapshot contains the actual schema,
records, indexes, triggers, routines, and events exported by MySQL. There are
no demo products, role-only initialization, random stock, or synthetic sales
added by the active seed command.

The snapshot is private and ignored by Git because it contains business data
and account password hashes. Keep a secure copy with your backups. A fresh
clone must receive this file separately; Git alone cannot restore your data.
Uploaded files under `Backend/uploads` and the ML model are separate assets
and must be copied separately when moving the installation.

To restore on another installation:

1. Install dependencies and configure the environment files below.
2. Create an empty MySQL database and point `Backend/.env` at it.
3. Copy your snapshot to `Backend/db/snapshots/current.sql`.
4. Stop other application instances and run the backend normally, or run:

```powershell
cd Backend
npm.cmd run seed
```

The seed restores only into a database with no tables or views. It never
merges into or overwrites an existing installation. A missing snapshot on an
empty database stops startup instead of falling back to old seeds. Do not
import `Backend/db/schema.sql` first: the snapshot includes the current schema.
If an import fails partway, use a new empty database after resolving the error;
MySQL schema changes cannot be rolled back as one transaction.

To intentionally replace the saved seed with a newer copy of the configured
database, stop application writers and run:

```powershell
cd Backend
npm.cmd run seed:capture
```

This reads the database and replaces the local snapshot only after a successful
export. Normal startup never refreshes the snapshot. Old demo scripts and
historical SQL patches are outside the current startup/setup flow. Apply a
migration only when a future change specifically requires it.

## Install on a new machine

Requirements: Node.js compatible with the committed Vite version
(`^20.19.0` or `>=22.12.0`), Python with virtual environment support, and MySQL
with TLS. Install MySQL 8 command-line tools (`mysql` and `mysqldump`). The
snapshot scripts also detect the standard Windows MySQL Server 8.0 install;
custom locations can be configured with `MYSQL_CLIENT_PATH` and `MYSQLDUMP_PATH`
in `Backend/.env`.

From the project root:

```powershell
npm.cmd ci
npm.cmd --prefix Backend ci
if (!(Test-Path Backend/.env)) { Copy-Item Backend/.env.example Backend/.env }
if (!(Test-Path ML/.env)) { Copy-Item ML/.env.example ML/.env }
```

Create root `.env` with:

```dotenv
VITE_API_BASE_URL=http://localhost:4000
```

Set these values in `Backend/.env` using your actual database credentials:

```dotenv
PORT=4000
DB_HOST=your_mysql_host
DB_PORT=3306
DB_USER=your_mysql_user
DB_PASSWORD=your_mysql_password
DB_NAME=your_database
JWT_SECRET=replace_with_a_long_random_secret
JWT_EXPIRES_IN=8h
CORS_ORIGIN=http://localhost:5173,http://127.0.0.1:5173
FRONTEND_URL=http://localhost:5173
FRONTEND_BASE_PATH=/
ML_SERVICE_URL=http://localhost:5001
```

Configure SMTP fields from the example if using password-reset email.
Set the same database credentials in `ML/.env` and `ML_SERVICE_PORT=5001`.
Keep environment files private. Restart services after configuration changes.

Install and train ML once, from the project root:

```powershell
cd ML
python -m venv venv
.\venv\Scripts\python.exe -m pip install -r requirements.txt
.\venv\Scripts\python.exe train_model.py
.\venv\Scripts\python.exe serve.py
```

Training creates `ML/restock_model.pkl`; reuse it on subsequent launches.
ML training may use synthetic bootstrap samples internally; it does not seed
business records into MySQL. The backend uses a heuristic fallback if ML is
unavailable.

## Check the installation

Latest local check: October 16, 2026 (Asia/Shanghai).

| Component | Verified result |
| --- | --- |
| Frontend | Port 5173 responds; production build passes. Lint exits successfully with 13 warnings. Vite reports a large JavaScript chunk. |
| Backend | Port 4000 health responds; MySQL connection and authenticated Business Profile read pass. Profile company name, address, and email match MySQL. |
| Backend tests | 120 tests pass with all database integration flags enabled and sequential execution. Includes vehicle ID allocation, physical rate deletion, historical vehicle snapshots, pickup, delivery, purchase orders, customers, and user/audit APIs. Integration fixtures roll back their business data. |
| ML | Port 5001 health reports `model_loaded: true`; prediction and backend ML client checks pass. Python compilation, dependency checks, and MySQL connection pass. |
| SQL schema | Vehicle storage, delivery snapshots, and wider audit record IDs are included in migrations/schema. Apply the migrations below after restoring an older SQL snapshot. No snapshot restore was performed during these checks. |

ML reads its own `.env` relative to the script and supports UTF-8 files with or
without a byte-order mark. Restart ML after pulling this environment-loading fix.
Existing immutable audit records, including prior registration test history,
remain part of the current database and snapshot.

```powershell
Invoke-RestMethod http://localhost:4000/health
Invoke-RestMethod http://localhost:5001/health
```

Expect API `status: ok`, and ML `status: ok` with `model_loaded: true`.
To check the actual database connection, run `node test-db.js` from `Backend`.
API health alone does not check MySQL. Sign in and verify your saved records.

Frontend checks from the project root:

```powershell
npm.cmd run build
npm.cmd run lint
```

Backend tests, from `Backend`:

```powershell
node --test tests/*.test.js
```

This suite includes a financial-rules database test that connects to the configured
MySQL database, runs its migration, and cleans up its temporary ledger rows. Other
database integration tests are opt-in. Use a separate test database for repeated
development testing.

ML checks, from `ML`:

```powershell
.\venv\Scripts\python.exe -m pip check
.\venv\Scripts\python.exe -m py_compile serve.py features.py train_model.py
$prediction = @{ items = @(@{ productId = "SMOKE-TEST"; current_stock = 5; reorder_level = 10; sales_7d = 14; sales_30d = 60; sales_90d = 180; lead_time_days = 3; days_since_last_restock = 12 }) } | ConvertTo-Json -Depth 4
Invoke-RestMethod http://localhost:5001/predict -Method Post -ContentType "application/json" -Body $prediction
```

The prediction check computes a response without writing business records.

Use `npm.cmd` if PowerShell blocks `npm.ps1`. If a port is occupied, stop the
existing service before starting another copy. For database errors, check
credentials, TLS support, and the selected database. For a missing ML model,
run training once and restart ML.
# Vehicle rate settings

For an existing database, run `npm run migrate:vehicle-rates`, `npm run migrate:delivery-vehicle-snapshot`, and `npm run migrate:vehicle-ids` from `Backend`. The vehicle-rates migration also widens audit record IDs. Vehicle IDs use `V-001` format. Admin users can manage up to 100 vehicle classes; capacity is entered in kilograms. Apply each vehicle edit, then Save the matrix to persist it. Cancel discards the draft. Saving synchronizes the matrix and the `deliveryvehiclerate` table in one transaction, physically removing deleted configuration rows. New delivery transactions retain an independent copy of their selected vehicle rate; deleting an active configuration does not delete historical vehicle details or fees. Older transactions without a saved vehicle are shown as "Not recorded".
