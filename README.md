```
git clone -b experiment-test-v2 https://github.com/althea000/LPG_Capstone.git
cd LPG_Capstone
npm install
"VITE_API_BASE_URL=http://localhost:4000" | Out-File -Encoding utf8 .env

cd Backend
npm install
Copy-Item .env.example .env
# edit Backend\.env (DB_PASSWORD, JWT_SECRET, SMTP_* if needed)

mysql -u root -p -e "CREATE DATABASE IF NOT EXISTS gastrack"
mysql -u root -p gastrack < db/schema.sql
mysql -u root -p gastrack < db/patch_customer_fields.sql
mysql -u root -p gastrack < db/patch_compliance_reports.sql
mysql -u root -p gastrack < db/patch_user_fields.sql
mysql -u root -p gastrack < db/patch_company_settings.sql
mysql -u root -p gastrack < db/patch_password_reset.sql
mysql -u root -p gastrack < db/patch_restock_confidence.sql
mysql -u root -p gastrack < db/patch_product_sku.sql

npm run seed
npm run seed:products
npm run seed:reports
npm run seed:demo:jose
mysql -u root -p gastrack -e "source db/patch_product_unit_value.sql"
npm run dev
```

**Second terminal (ML service)**

```
cd LPG_Capstone\ML
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
python train_model.py
python serve.py
```

**Third terminal (frontend)**

```
cd LPG_Capstone
npm run dev
```
For an existing database, apply `Backend/db/patch_product_unit_value.sql` to
add Product.UnitValue and populate recognizable LPG/cylinder weights. The patch
can be run again without replacing saved values. Enter or edit Unit Value
(e.g. `11 kg`) in Products; returned-cylinder Weight uses this saved value.
