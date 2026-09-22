
# from project root
npm install
# next is create ".env" file at root of the project put this inside:
VITE_API_BASE_URL=http://localhost:4000

# in a separate terminal
cd backend

npm install

cp .env.example .env      # fill in DB credentials

mysql -u root -p -e "CREATE DATABASE gastrack"

mysql -u root -p gastrack < db/schema.sql

mysql -u root -p gastrack < backend/db/patch_customer_fields.sql

mysql -u root -p gastrack < backend/db/patch_compliance_reports.sql

mysql -u root -p gastrack < backend/db/patch_user_fields.sql

mysql -u root -p gastrack < backend/db/patch_company_settings.sql

npm run seed    

npm run seed:products

npm run seed:reports

#Credentials
admin@gastrack.com / Admin@123


