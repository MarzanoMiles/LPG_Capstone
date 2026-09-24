require("dotenv").config();
const bcrypt = require("bcryptjs");
const pool = require("../config/db");

async function seed() {
  const [companyResult] = await pool.query(
    `INSERT INTO Company (CompanyName, DTIRegNo, PrimaryBranch, Address)
     VALUES ('GasTrack Demo Co.', 'DTI-0000001', 'Main Branch', 'Manila, Philippines')`
  );
  const companyId = companyResult.insertId;

  const [warehouseResult] = await pool.query(
    `INSERT INTO Warehouse (CompanyID, WarehouseName, Location) VALUES (:cid, 'Pasig Warehouse', 'Pasig City')`,
    { cid: companyId }
  );

  const [[adminRole]] = await pool.query(`SELECT RoleID FROM Role WHERE RoleName = 'Admin'`);
  const passwordHash = await bcrypt.hash("Admin@123", 10);

  await pool.query(
    `INSERT INTO User (CompanyID, RoleID, FirstName, LastName, Email, PasswordHash)
     VALUES (:cid, :rid, 'Juan', 'Dela Cruz', 'admin@gastrack.com', :hash)`,
    { cid: companyId, rid: adminRole.RoleID, hash: passwordHash }
  );

  console.log("Seed complete. Login with admin@gastrack.com / Admin@123");
  process.exit(0);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});