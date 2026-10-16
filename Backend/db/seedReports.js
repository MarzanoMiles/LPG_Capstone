require("dotenv").config();
const pool = require("../config/db");

async function seedReports() {
  // Ensure the ComplianceReport table exists with all standard columns
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ComplianceReport (
      ReportID VARCHAR(20) PRIMARY KEY,
      ReportName VARCHAR(255) NOT NULL,
      ReportType VARCHAR(100),
      PeriodLabel VARCHAR(100),
      PeriodStart DATE,
      PeriodEnd DATE,
      DueDate DATE,
      SubmittedAt DATETIME NULL,
      FileName VARCHAR(255) NULL,
      FilePath VARCHAR(500) NULL,
      FileSize VARCHAR(50) NULL,
      Status VARCHAR(50) DEFAULT 'Upcoming',
      CreatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      UpdatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    );
  `);

  // Add missing columns if table already existed without them
  const extraColumns = [
    "SubmittedAt DATETIME NULL",
    "FileName VARCHAR(255) NULL",
    "FilePath VARCHAR(500) NULL",
    "FileSize VARCHAR(50) NULL"
  ];

  for (const colDef of extraColumns) {
    const colName = colDef.split(" ")[0];
    try {
      await pool.query(`ALTER TABLE ComplianceReport ADD COLUMN IF NOT EXISTS ${colDef};`);
    } catch (err) {
      try {
        await pool.query(`ALTER TABLE ComplianceReport ADD COLUMN ${colDef};`);
      } catch (e) {
        // Column already exists, safe to ignore
      }
    }
  }

  const today = new Date();
  const inDays = (n) => {
    const d = new Date(today);
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const monthStart = (offset = 0) => {
    const d = new Date(today.getFullYear(), today.getMonth() + offset, 1);
    return d.toISOString().slice(0, 10);
  };
  const monthEnd = (offset = 0) => {
    const d = new Date(today.getFullYear(), today.getMonth() + offset + 1, 0);
    return d.toISOString().slice(0, 10);
  };
  const monthLabel = (offset = 0) => {
    const d = new Date(today.getFullYear(), today.getMonth() + offset, 1);
    return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  };

  const reports = [
    {
      name: "Monthly Sales Summary",
      type: "Sales Summary",
      periodLabel: monthLabel(0),
      periodStart: monthStart(0),
      periodEnd: monthEnd(0),
      dueDate: inDays(3),
    },
    {
      name: "Inventory Audit",
      type: "Inventory Audit",
      periodLabel: monthLabel(-1),
      periodStart: monthStart(-1),
      periodEnd: monthEnd(-1),
      dueDate: inDays(10),
    },
    {
      name: "Restocking History",
      type: "Restocking Logs",
      periodLabel: monthLabel(-1),
      periodStart: monthStart(-1),
      periodEnd: monthEnd(-1),
      dueDate: inDays(-2), // deliberately overdue, to show the status badge working
    },
  ];

  for (const r of reports) {
    const [existing] = await pool.query(
      `SELECT ReportID FROM ComplianceReport WHERE ReportName = :name AND PeriodLabel = :period`,
      { name: r.name, period: r.periodLabel }
    );
    if (existing[0]) continue;
    await pool.query(
      `INSERT INTO ComplianceReport (ReportID, ReportName, ReportType, PeriodLabel, PeriodStart, PeriodEnd, DueDate, Status)
       VALUES (:id, :name, :type, :periodLabel, :periodStart, :periodEnd, :dueDate, 'Upcoming')`,
      { ...r, id: await require("../utils/entityIds").nextEntityId(pool,"ComplianceReport") }
    );
    console.log(`Seeded report: ${r.name} (${r.periodLabel})`);
  }

  console.log("Report seed complete.");
  process.exit(0);
}

seedReports().catch((err) => {
  console.error(err);
  process.exit(1);
});