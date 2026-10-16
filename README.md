# GasTrack

React/Vite frontend, Node/Express backend, MySQL database, and a Python/Flask
restocking ML service. These instructions use **Windows PowerShell**.

## Start again after setup

Open the project folder in VS Code. Open **three terminals at the project root**
(the folder containing this README and `package.json`). Each terminal starts
independently at the root; keep all three running.

**Terminal 1 — backend**

```powershell
cd Backend
npm.cmd run dev
```

Wait for `GasTrack API listening on port 4000`.

**Terminal 2 — ML** (start at the project root, not inside Backend)

```powershell
cd ML
.\venv\Scripts\python.exe serve.py
```

Wait for Flask to report that it is running on port 5001. If it reports a
missing model, complete the one-time ML training step below.

**Terminal 3 — frontend** (start at the project root)

```powershell
npm.cmd run dev
```

Wait for Vite to print `http://localhost:5173/`. These commands keep running;
use another terminal for checks instead of stopping a service to run them.

For this checkout, the root is `C:\Users\user\LPG_Capstone_jfsalivio`. Other users
should use their own clone folder. You can return to it in any terminal with
`cd C:\Users\user\LPG_Capstone_jfsalivio` (adjust for your machine).

Open **http://localhost:5173/** in Chrome. Inside VS Code, press Ctrl+Shift+P,
choose **Simple Browser: Show**, and enter that address. You can also use
http://127.0.0.1:5173/.

The Vite configuration fixes port 5173, listens on IPv4/IPv6 through `::`, and
fails if the port is occupied. Stop servers with Ctrl+C before starting another
copy. Do not reinstall, reimport the schema, reseed, or retrain on every launch.

Your saved database and login remain after a restart. In the current configured
database, account `U-001` uses `jose.villanueva.admin@gmail.com`; use its existing
password. This account is not automatically present in someone else's new
database. Products `P-001` through `P-006` have been removed from this database's
catalog and stock, with archived order details preserved. Restarting the app
does not recreate them. All legacy demo seed entry points are retired and
create no data, including when invoked directly with Node.

## First clone: prerequisites

- Git.
- Node.js with npm. Node 24 is the version used for local verification. Vite
  requires Node `^20.19.0` or `>=22.12.0`.
- Python with pip and virtual environment support. This checkout's ML service
  was verified with Python 3.14.8; use 64-bit Python.
- MySQL 8 with a database account allowed to create tables and triggers. The
  current Node database configuration always requests TLS, so the MySQL server
  must support TLS. A hosted MySQL database also works with its host and port.
- MySQL command-line client on PATH for the database setup commands below.

Check installed tools in a new PowerShell terminal:

```powershell
git --version
node --version
npm.cmd --version
python --version
mysql --version
```

Use `npm.cmd`, because PowerShell may block `npm.ps1`. Run the virtual
environment's Python directly; there is no need to activate it or change the
PowerShell execution policy.

### 1. Clone and install JavaScript dependencies

```powershell
git clone --branch experiment-test-v2 https://github.com/jfsalivio/LPG_Capstone.git
cd LPG_Capstone
npm.cmd ci
npm.cmd --prefix Backend ci
```

The branch and repository above match this checkout. If using another branch,
replace the branch name. Stop and resolve any failed command before continuing.
`npm ci` uses each committed lockfile; install dependencies again after a pull
that changes a lockfile.

### 2. Create the three environment files

Run from the project root. These commands preserve existing files:

```powershell
if (!(Test-Path .env)) {
  [IO.File]::WriteAllText((Join-Path (Get-Location) '.env'), "VITE_API_BASE_URL=http://localhost:4000`r`n", (New-Object System.Text.UTF8Encoding($false)))
}
if (!(Test-Path Backend/.env)) { Copy-Item Backend/.env.example Backend/.env }
if (!(Test-Path ML/.env)) { Copy-Item ML/.env.example ML/.env }
```

Save the root `.env` as **UTF-8 without BOM**. In VS Code, click the encoding in
its status bar, choose **Save with Encoding**, then **UTF-8**. Windows PowerShell
5's `Out-File -Encoding utf8` and `Set-Content -Encoding utf8` write a BOM; that
prevented this project's Vite version from reading the API URL during diagnosis.
The root file must contain:

```dotenv
VITE_API_BASE_URL=http://localhost:4000
```

Edit `Backend/.env`:

```dotenv
PORT=4000
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_database_password
DB_NAME=gastrack
JWT_SECRET=replace_with_a_long_random_secret
JWT_EXPIRES_IN=8h
CORS_ORIGIN=http://localhost:5173,http://127.0.0.1:5173
FRONTEND_URL=http://localhost:5173
FRONTEND_BASE_PATH=/
ML_SERVICE_URL=http://localhost:5001
```

Replace the example credentials and secret. For hosted MySQL, use the provider's
host, port, username, and database name. Keep the SMTP fields from the example
and enter real SMTP settings if using password-reset emails.

Edit `ML/.env` with the **same DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, and DB_NAME**
as the backend, plus `ML_SERVICE_PORT=5001`. These files are separate; editing
one does not update the others. Never commit `.env` files. Restart the affected
service after changing configuration.

### 3. Prepare a NEW database

**Skip schema import for an existing/shared database.** `schema.sql` drops
application tables. Use it only for a verified empty database. Back up existing
data before intentional migrations. The current `seed` command no longer resets
tables or inserts sample business data; see the seed policy below.

For a new local database only, run from `Backend`:

```powershell
cd Backend
mysql -u root -p -e "CREATE DATABASE gastrack CHARACTER SET utf8mb4"
mysql -u root -p gastrack -e "source db/schema.sql"
mysql -u root -p gastrack -e "source db/patch_password_reset.sql"
npm.cmd run seed
npm.cmd run migrate:supplier-history
npm.cmd run migrate:product-history
npm.cmd run migrate:users-audit
npm.cmd run migrate:user-history
npm.cmd run migrate:business-operations
npm.cmd run migrate:financial-rules
npm.cmd run migrate:pickup
npm.cmd run migrate:po-workflow
```

The `mysql` commands above use a **local root connection**, independently of
`Backend/.env`. For a remote or different account, add its `-h HOST -P PORT -u USER`
connection options and use its database name. If the database already exists,
verify that it is empty before importing; do not import over existing data.
PowerShell does not support `< file.sql`; use the `source` syntax shown above.

The current schema already includes fields from several older patches. Do not
blindly apply every SQL file: some add duplicate columns, transform IDs, or
remove inventory. `migrate:supplier-history` and `migrate:product-history` create the history
tables required by supplier and product operations. The other commands prepare
user IDs, audit logging, settings, pickup and purchase-order workflows. `seed`
initializes only the system roles on a fresh installation, enabling registration.
The schema alone does not create roles or login accounts.

Check the configured backend database connection:

```powershell
node test-db.js
cd ..
```

Expect `Connection successful!` and query result `2`. This check alone does not
validate every table. Once the services are started, use **Register LPG Company**
on the frontend to create your company and administrator, then sign in with
that account. A fresh database has no default login. Add suppliers, categories,
brands, products, and stock through the app as needed.

### Database seeds for the current system

The only applicable seed is `npm.cmd run seed` (run inside `Backend`). It creates
10 required system roles only when no application or catalog history records
exist. `SetupSeedHistory` records the first run. Subsequent runs preserve edited
and deleted roles. On an existing installation it records setup and leaves all
business records unchanged. It does not import the schema or apply migrations.
Do not delete `SetupSeedHistory` to force reseeding.

| Data | Current source / behavior |
| --- | --- |
| System roles | One-time fresh-install seed; subsequent changes through Role Settings. |
| Company, branches, warehouses, users | Registration and the app's user/settings workflows. No demo accounts or password resets. |
| Brands, categories, suppliers | App-managed catalog and supplier records. Deleted entries are not reseeded. |
| Products and unit values | App-managed product catalog. No old names, prices, variants or deleted products are restored. |
| Inventory, movements, transfers, restock recommendations | App stock and restocking workflows. No fixed stock or random inventory seeds. |
| Customers, orders, order details, sales | App customer and sales workflows. No old customer or sales fixtures. |
| Purchase orders, items, payments, deliveries | App transaction workflows. No synthetic transactions or deliveries. |
| Reports | Existing reports and app report workflows. No fixed-date sample report seed. |
| Settings, audit records and history | App defaults and operational writes; retained by migrations, not replaced with demo history. |
| Supplier type options | Fresh schema includes defaults. Manage changes in the app; do not reimport the schema to restore options. |

Legacy `seed:products`, `seed:reports`, `seed:demo:jose` and
`seed:dashboard:history` commands remain harmless compatibility entry points.
They print a retirement message without connecting to MySQL. Their old fixtures
are no longer executed, including through `node db/seed*.js`.

### Existing database: intentional maintenance only

For the current configured database, normal startup needs **no seed, schema
import or migration**. Do not run every migration on every restart. When updating
an older installation, review the relevant migration and back up first. Run
only the required commands with application writers stopped:

| Change needed | Command inside `Backend` |
| --- | --- |
| Normalize legacy prefixed IDs and linked references | `npm.cmd run migrate:entity-ids` |
| Remove measurement suffixes from legacy Unit Value strings | `npm.cmd run migrate:unit-values` |
| Add missing supplier history support | `npm.cmd run migrate:supplier-history` |
| Add missing product history support | `npm.cmd run migrate:product-history` |
| Archive user identities without passwords and preserve transactions when deleting accounts | `npm.cmd run migrate:user-history` (after `migrate:users-audit`) |
| Add user numbering, branch assignments and audit support | `npm.cmd run migrate:users-audit` |
| Add supplier type tables to an older schema | `npm.cmd run migrate:supplier-types` |
| Add business operating settings | `npm.cmd run migrate:business-operations` |
| Add refund settings and ledger | `npm.cmd run migrate:financial-rules` |
| Add pickup stages, settlement and claims | `npm.cmd run migrate:pickup` |
| Add purchase-order receiving and payment fields | `npm.cmd run migrate:po-workflow` |

Do not use one-off inventory randomizers, stock movers, password-reset utilities,
verification scripts that write data, or raw SQL patches as seeds. These are
maintenance tools with specific effects. `schema.sql` remains a destructive
fresh-database definition; importing it over saved data will reset tables even
though the Node seed commands are now safe.

### 4. Install ML dependencies and train once

From the project root:

```powershell
cd ML
python -m venv venv
.\venv\Scripts\python.exe -m pip install --upgrade pip
.\venv\Scripts\python.exe -m pip install -r requirements.txt
.\venv\Scripts\python.exe -m pip check
.\venv\Scripts\python.exe train_model.py
cd ..
```

Training must create `ML/restock_model.pkl`. It is ignored by Git, so a fresh
clone needs training. Training can bootstrap with synthetic data if no usable
sales history is available; successful training alone does not prove database
connectivity. Reuse the model for daily startup and retrain intentionally when
needed. Virtual environments are machine-specific: create your own after cloning.

Now follow **Start again after setup** at the top of this file.

## Verify the running installation

Run in a fourth terminal:

```powershell
Invoke-RestMethod http://localhost:4000/health
Invoke-RestMethod http://localhost:5001/health
Invoke-WebRequest http://localhost:5173/ -UseBasicParsing | Select-Object StatusCode
$body = @{ items = @(@{ productId = 1; current_stock = 5; reorder_level = 10; sales_7d = 14; sales_30d = 60; sales_90d = 180; lead_time_days = 3; days_since_last_restock = 12 }) } | ConvertTo-Json -Depth 4
Invoke-RestMethod http://localhost:5001/predict -Method Post -ContentType application/json -Body $body | ConvertTo-Json -Depth 4
```

Expect backend `status: ok`, ML `status: ok` and `model_loaded: true`, frontend
HTTP 200, and a prediction containing `confidence` and `recommendedQuantity`.
The backend health endpoint does not query MySQL; run `node test-db.js` from
`Backend` as well. Confirm the login screen is visible in a browser and test
login with your own account. The backend has an ML heuristic fallback, so a
working restocking screen alone does not prove that ML is running.

To confirm Vite loaded the backend address, run this from the project root:

```powershell
@'
import { loadEnv } from 'vite';
console.log('API URL:', loadEnv('development', process.cwd()).VITE_API_BASE_URL);
'@ | node --input-type=module
```

Expect `API URL: http://localhost:4000`. If it prints `undefined`, fix the root
`.env` contents/encoding and restart the frontend before attempting login.

Optional frontend validation from the project root:

```powershell
npm.cmd run build
npm.cmd run lint
```

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| `npm.ps1 cannot be loaded` | Use `npm.cmd` instead of `npm`. |
| `Activate.ps1` is blocked | Use `.\venv\Scripts\python.exe` from `ML`; activation is unnecessary. |
| `EADDRINUSE` or port 5173 occupied | Stop the existing server in its terminal with Ctrl+C. Check other VS Code windows and project copies. |
| Different results on localhost and 127.0.0.1 | Another checkout may occupy one address. Stop the other copy and restart this checkout with the committed Vite configuration. |
| Login says `Request failed` | Check root `.env` has the API URL and is UTF-8 without BOM. Restart Vite. In F12 > Network, login must POST to `http://localhost:4000/auth/login`, not port 5173. |
| `Invalid email or password` | Use an account in the configured database. A fresh installation needs registration first. |
| Database access, TLS, or unknown-table error | Check DB credentials, server TLS support, and whether the correct schema/migrations were applied to that database. |
| ML model missing | Run `train_model.py` using the virtual environment, then restart ML. |
| ML import error | Install requirements using the virtual environment's `python.exe -m pip`, not global pip. |
| Browser or VS Code preview is blank | Try a fresh Chrome profile or InPrivate window and `http://127.0.0.1:5173/`. Close and reopen VS Code's Simple Browser. Check F12 > Console and Network for errors. |

To see which process owns a port (do not terminate an unidentified process):

```powershell
Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -in 4000,5001,5173 } | Select-Object LocalAddress,LocalPort,OwningProcess
```

## Existing database maintenance

Existing databases need migrations appropriate to their current schema, rather
than a schema reimport. Review the migration documentation under `Backend/db`,
including `CUSTOMER_HISTORY.md`, `DELIVERY_LIFECYCLE.md`, `FINANCIAL_RULES.md`, and
`PRODUCT_HISTORY.md`. Back up data and stop the app before schema maintenance.

Unit Value is numeric (for example, `11`) and Unit is separate (`kg`). For an
older database containing strings such as `11 kg`, use the reviewed
`migrate:unit-values` command in the maintenance table above. Do not reimport
sample products to correct measurements.

Legacy inventory cleanup is not part of setup. This database already had its
legacy catalog cleanup; deleted products must remain deleted. SQL files in Git
are not applied automatically to anyone's database.

## Verification scope

On the current Windows checkout, Node 24 and Python 3.14.8 were used to verify
frontend build and visible login rendering, backend database access, ML health
and prediction, and the backend's ML client. Fresh-database instructions were
checked against the schema and scripts; a complete clean-machine install and
all business workflows have not been exercised. Dependencies and database
permissions must still be available on each new user's machine.
