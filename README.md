git clone -b for_test https://github.com/MarzanoMiles/LPG_Capstone.git 

cd GasTrack-CAPSTONE
npm install
echo "VITE_API_BASE_URL=http://localhost:4000" > .env

cd backend
npm install
cp .env.example .env
#edit backend/.env now (DB_PASSWORD, JWT_SECRET)

mysql -u root -p -e "CREATE DATABASE IF NOT EXISTS gastrack"
mysql -u root -p gastrack < db/schema.sql
mysql -u root -p gastrack < db/patch_customer_fields.sql
mysql -u root -p gastrack < db/patch_compliance_reports.sql
mysql -u root -p gastrack < db/patch_user_fields.sql
mysql -u root -p gastrack < db/patch_company_settings.sql
mysql -u root -p gastrack < backend/db/patch_password_reset.sql
mysql -u root -p gastrack < backend/db/patch_restock_confidence.sql

npm run seed
npm run seed:products
npm run seed:reports

npm run dev

#another terminal from root folder, note: if "python -m venv venv" doesn't work, try: py -m venv venv
cd ML
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
python train_model.py
python serve.py