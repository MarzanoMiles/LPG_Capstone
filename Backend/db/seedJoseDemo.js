require("dotenv").config();
const bcrypt = require("bcryptjs");
const pool = require("../config/db");
const { nextSequence } = require("../utils/generateNumbers");

const TARGET_EMAIL = "jose.villanueva.admin@gmail.com";
const DEMO_TAG = "DEMO-JOSE-2026";

async function nextId(conn, table, column, prefix, pad = 3) {
  const [rows] = await conn.query(
    `SELECT ${column} AS id FROM ${table} WHERE ${column} LIKE :pattern ORDER BY ${column} DESC LIMIT 500`,
    { pattern: `${prefix}-%` }
  );
  let max = 0;
  for (const row of rows) {
    const match = String(row.id || "").match(new RegExp(`^${prefix}-(\\d+)$`));
    if (!match) continue;
    const num = Number(match[1]);
    if (Number.isInteger(num) && num > max) max = num;
  }
  return `${prefix}-${String(max + 1).padStart(pad, "0")}`;
}

function randomProductCode(length = 8) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < length; i++) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

async function nextProductId(conn, maxAttempts = 20) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const candidate = `P-${randomProductCode(8)}`;
    const [rows] = await conn.query(
      `SELECT ProductID FROM Product WHERE ProductID = :id LIMIT 1`,
      { id: candidate }
    );
    if (!rows[0]) return candidate;
  }
  throw new Error("Could not generate a unique Product ID.");
}

function daysAgo(n, hour = 10) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(hour, 15, 0, 0);
  return d;
}

async function ensureSupplier(conn, data) {
  const [existing] = await conn.query(`SELECT SupplierID FROM Supplier WHERE SupplierName = :name LIMIT 1`, {
    name: data.supplierName,
  });
  if (existing[0]) return existing[0].SupplierID;

  const supplierId = await nextId(conn, "Supplier", "SupplierID", "SP");
  await conn.query(
    `INSERT INTO Supplier (SupplierID, SupplierName, ContactPerson, Email, Address, Contact, LeadTimeDays, Status)
     VALUES (:supplierId, :supplierName, :contactPerson, :email, :address, :contact, :leadTimeDays, 'Active')`,
    { supplierId, ...data }
  );
  return supplierId;
}

async function ensureCustomer(conn, data) {
  const [existing] = await conn.query(`SELECT CustomerID FROM Customer WHERE ContactNo = :contactNo LIMIT 1`, {
    contactNo: data.contactNo,
  });
  if (existing[0]) return existing[0].CustomerID;

  const customerId = await nextId(conn, "Customer", "CustomerID", "CUST");
  await conn.query(
    `INSERT INTO Customer (CustomerID, CustomerType, CustomerName, ContactNo, Address, Status)
     VALUES (:customerId, :customerType, :customerName, :contactNo, :address, 'Active')`,
    { customerId, ...data }
  );
  return customerId;
}

async function ensureSchema(conn) {
  const [tableRows] = await conn.query(
    `SELECT TABLE_NAME
     FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'ComplianceReport'
     LIMIT 1`
  );

  if (tableRows.length) {
    const [reportIdRows] = await conn.query(
      `SELECT DATA_TYPE, EXTRA
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'ComplianceReport'
         AND COLUMN_NAME = 'ReportID'
       LIMIT 1`
    );

    if (reportIdRows.length) {
      const dataType = String(reportIdRows[0].DATA_TYPE || "").toLowerCase();
      const extra = String(reportIdRows[0].EXTRA || "").toLowerCase();
      const isIntegerType = ["tinyint", "smallint", "mediumint", "int", "bigint"].includes(dataType);
      const isAutoIncrement = extra.includes("auto_increment");

      if (isIntegerType || isAutoIncrement) {
        await conn.query(`DROP TABLE IF EXISTS ComplianceReport`);
      }
    }
  }

  await conn.query(`
    CREATE TABLE IF NOT EXISTS ComplianceReport (
      ReportID VARCHAR(50) NOT NULL PRIMARY KEY,
      ReportName VARCHAR(255) NOT NULL,
      ReportType VARCHAR(100) NULL,
      PeriodLabel VARCHAR(100) NULL,
      PeriodStart DATE NULL,
      PeriodEnd DATE NULL,
      DueDate DATE NULL,
      Status VARCHAR(50) NOT NULL DEFAULT 'Upcoming',
      SubmittedAt DATETIME NULL,
      SubmittedByUserID VARCHAR(50) NULL,
      FileName VARCHAR(255) NULL,
      FilePath VARCHAR(500) NULL,
      FileSize VARCHAR(50) NULL,
      CreatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      UpdatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  const [submittedByRows] = await conn.query(
    `SELECT DATA_TYPE
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'ComplianceReport'
       AND COLUMN_NAME = 'SubmittedByUserID'
     LIMIT 1`
  );

  if (submittedByRows.length) {
    const submittedByType = String(submittedByRows[0].DATA_TYPE || "").toLowerCase();
    const numericTypes = ["tinyint", "smallint", "mediumint", "int", "bigint", "decimal", "numeric"];
    if (numericTypes.includes(submittedByType)) {
      await conn.query(`ALTER TABLE ComplianceReport MODIFY COLUMN SubmittedByUserID VARCHAR(50) NULL`);
    }
  }
  const expectedColumns = [
    { name: "SubmittedByUserID", definition: "VARCHAR(50) NULL" },
    { name: "SubmittedAt", definition: "DATETIME NULL" },
    { name: "FileName", definition: "VARCHAR(255) NULL" },
    { name: "FilePath", definition: "VARCHAR(500) NULL" },
    { name: "FileSize", definition: "VARCHAR(50) NULL" },
  ];

  for (const col of expectedColumns) {
    const [columnRows] = await conn.query(
      `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'ComplianceReport'
         AND COLUMN_NAME = :columnName
       LIMIT 1`,
      { columnName: col.name }
    );

    if (!columnRows.length) {
      await conn.query(`ALTER TABLE ComplianceReport ADD COLUMN ${col.name} ${col.definition}`);
    }
  }

  const [preflightSchemaRows] = await conn.query(
    `SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, EXTRA
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'ComplianceReport'
       AND COLUMN_NAME IN ('ReportID', 'SubmittedByUserID')
     ORDER BY FIELD(COLUMN_NAME, 'ReportID', 'SubmittedByUserID')`
  );

  const preflightSummary = preflightSchemaRows
    .map((row) => `${row.COLUMN_NAME}=${row.COLUMN_TYPE}${row.EXTRA ? ` (${row.EXTRA})` : ""}`)
    .join(", ");

  console.log(`[Preflight] ComplianceReport schema: ${preflightSummary || "columns not found"}`);
}

async function main() {
  console.log("Seeding realistic demo data for Jose's company...");
  const conn = await pool.getConnection();
  let txStarted = false;

  try {
    // Step 0: Guarantee required table schemas & columns exist
    await ensureSchema(conn);

    // Keep operations auto-committed to avoid long-running transaction locks
    // while generating large demo datasets.

    const [userRows] = await conn.query(
      `SELECT u.UserID, u.CompanyID, u.RoleID, r.RoleName
       FROM User u JOIN Role r ON r.RoleID = u.RoleID
       WHERE u.Email = :email LIMIT 1`,
      { email: TARGET_EMAIL }
    );
    const jose = userRows[0];
    if (!jose) {
      throw new Error(`Target account not found: ${TARGET_EMAIL}`);
    }

    const [roleRows] = await conn.query(`SELECT RoleID, RoleName FROM Role`);
    const roleMap = new Map(roleRows.map((r) => [r.RoleName, r.RoleID]));

    const [warehouseRows] = await conn.query(
      `SELECT WarehouseID, WarehouseName FROM Warehouse WHERE CompanyID = :companyId ORDER BY WarehouseID`,
      { companyId: jose.CompanyID }
    );
    if (!warehouseRows.length) {
      throw new Error("No warehouses found for Jose's company.");
    }
    const primaryWarehouseId = warehouseRows[0].WarehouseID;

    const [categoryRows] = await conn.query(`SELECT CategoryID, Category FROM Category ORDER BY CategoryID`);
    const [brandRows] = await conn.query(`SELECT BrandID, Brand FROM Brand ORDER BY BrandID`);
    if (!categoryRows.length || !brandRows.length) {
      throw new Error("Category/Brand master data is missing.");
    }
    const lpgCategoryId = categoryRows.find((c) => c.Category === "Gasul LPG")?.CategoryID || categoryRows[0].CategoryID;
    const cylinderCategoryId = categoryRows.find((c) => c.Category === "Cylinder")?.CategoryID || lpgCategoryId;
    const accessoriesCategoryId = categoryRows.find((c) => c.Category === "Accessories")?.CategoryID || lpgCategoryId;
    const defaultBrandId = brandRows.find((b) => b.Brand === "Petron")?.BrandID || brandRows[0].BrandID;

    const supplierA = await ensureSupplier(conn, {
      supplierName: "South Metro LPG Trading",
      contactPerson: "Ramon Dela Cruz",
      email: "procurement@southmetrolpg.ph",
      address: "42 M. Almeda St., Pateros, Metro Manila",
      contact: "09178901234",
      leadTimeDays: 2,
    });
    const supplierB = await ensureSupplier(conn, {
      supplierName: "Luzon Cylinder & Accessories Inc.",
      contactPerson: "Elaine Santos",
      email: "sales@luzoncylinder.ph",
      address: "15 JP Rizal Ave., Marikina City",
      contact: "09261234567",
      leadTimeDays: 4,
    });

    const [existingProducts] = await conn.query(
      `SELECT ProductID, ProductName, UnitPrice, CostPrice, ReorderLevel FROM Product ORDER BY ProductID`
    );

    const demoProductsToCreate = [
      { name: "Cylinder 2.7 kg", categoryId: cylinderCategoryId, supplierId: supplierA, unit: "kg", unitPrice: 243, costPrice: 200, reorderLevel: 30 },
      { name: "Cylinder LPG 7 kg", categoryId: cylinderCategoryId, supplierId: supplierA, unit: "kg", unitPrice: 603, costPrice: 560, reorderLevel: 20 },
      { name: "Cylinder 11 kg Elite", categoryId: cylinderCategoryId, supplierId: supplierA, unit: "kg", unitPrice: 907, costPrice: 850, reorderLevel: 40 },
      { name: "Cylinder 11 kg", categoryId: cylinderCategoryId, supplierId: supplierA, unit: "kg", unitPrice: 921, costPrice: 870, reorderLevel: 50 },
      { name: "Cylinder 22 kg", categoryId: cylinderCategoryId, supplierId: supplierA, unit: "kg", unitPrice: 1726, costPrice: 1680, reorderLevel: 15 },
      { name: "Cylinder 50 kg", categoryId: cylinderCategoryId, supplierId: supplierA, unit: "kg", unitPrice: 3964, costPrice: 3890, reorderLevel: 10 },
      { name: "LPG Hose Clamp", categoryId: accessoriesCategoryId, supplierId: supplierB, unit: "pcs", unitPrice: 90, costPrice: 65, reorderLevel: 30 },
      { name: "LPG Hose Clamp with 1.5 meter Hose", categoryId: accessoriesCategoryId, supplierId: supplierB, unit: "set", unitPrice: 380, costPrice: 290, reorderLevel: 20 },
      { name: "LPG Hose (Per Meter)", categoryId: accessoriesCategoryId, supplierId: supplierB, unit: "meter", unitPrice: 120, costPrice: 85, reorderLevel: 40 },
      { name: "POL Regulator", categoryId: accessoriesCategoryId, supplierId: supplierB, unit: "pcs", unitPrice: 420, costPrice: 320, reorderLevel: 25 },
      { name: "TPA Regulator", categoryId: accessoriesCategoryId, supplierId: supplierB, unit: "pcs", unitPrice: 450, costPrice: 340, reorderLevel: 25 },
      { name: "Reyna Gas Stove", categoryId: accessoriesCategoryId, supplierId: supplierB, unit: "unit", unitPrice: 1650, costPrice: 1380, reorderLevel: 12 },
    ];

    const productMap = new Map(existingProducts.map((p) => [p.ProductName, p]));

    for (const p of demoProductsToCreate) {
      if (productMap.has(p.name)) continue;
      const productId = await nextProductId(conn);
      await conn.query(
        `INSERT INTO Product (ProductID, ProductName, CategoryID, BrandID, SupplierID, Unit, UnitPrice, CostPrice, ReorderLevel, Status)
         VALUES (:productId, :name, :categoryId, :brandId, :supplierId, :unit, :unitPrice, :costPrice, :reorderLevel, 'Active')`,
        {
          productId,
          name: p.name,
          categoryId: p.categoryId,
          brandId: defaultBrandId,
          supplierId: p.supplierId,
          unit: p.unit,
          unitPrice: p.unitPrice,
          costPrice: p.costPrice,
          reorderLevel: p.reorderLevel,
        }
      );
      productMap.set(p.name, {
        ProductID: productId,
        ProductName: p.name,
        UnitPrice: p.unitPrice,
        CostPrice: p.costPrice,
        ReorderLevel: p.reorderLevel,
      });
    }

    const selectedProducts = [...productMap.values()].slice(0, 6);

    // Intentionally do not auto-seed Inventory rows here.
    // Jose demo transactions are generated in Sales/Order tables only.

    const defaultPasswordHash = await bcrypt.hash("Welcome@123", 10);
    const demoUsers = [
      { firstName: "Carlo", lastName: "Mendoza", email: "carlo.mendoza@gloriouscommercial.ph", role: "Operations Supervisor", warehouseId: primaryWarehouseId },
      { firstName: "Liza", lastName: "Fernandez", email: "liza.fernandez@gloriouscommercial.ph", role: "Store Supervisor", warehouseId: primaryWarehouseId },
      { firstName: "Rico", lastName: "Villamor", email: "rico.villamor@gloriouscommercial.ph", role: "Drivers", warehouseId: primaryWarehouseId },
      { firstName: "Mina", lastName: "Reyes", email: "mina.reyes@gloriouscommercial.ph", role: "Stockman", warehouseId: primaryWarehouseId },
    ];

    const demoUserIds = {};
    for (const u of demoUsers) {
      const [existing] = await conn.query(`SELECT UserID FROM User WHERE Email = :email LIMIT 1`, { email: u.email });
      if (existing[0]) {
        demoUserIds[u.role] = existing[0].UserID;
        continue;
      }
      const roleId = roleMap.get(u.role);
      if (!roleId) continue;
      const userId = await nextId(conn, "User", "UserID", "U");
      await conn.query(
        `INSERT INTO User (UserID, CompanyID, RoleID, WarehouseID, FirstName, LastName, Email, PasswordHash, Status, ModuleAccess)
         VALUES (:userId, :companyId, :roleId, :warehouseId, :firstName, :lastName, :email, :passwordHash, 'Active', :modules)`,
        {
          userId,
          companyId: jose.CompanyID,
          roleId,
          warehouseId: u.warehouseId,
          firstName: u.firstName,
          lastName: u.lastName,
          email: u.email,
          passwordHash: defaultPasswordHash,
          modules: JSON.stringify({ dashboard: true, inventory: true, sales: true, suppliers: true }),
        }
      );
      demoUserIds[u.role] = userId;
    }

    const customerA = await ensureCustomer(conn, {
      customerType: "Residential",
      customerName: "Ana Marie Bautista",
      contactNo: "09181230001",
      address: "24 Luna St., San Juan City",
    });
    const customerB = await ensureCustomer(conn, {
      customerType: "Commercial",
      customerName: "Tomas Hardware Center",
      contactNo: "09181230002",
      address: "89 Shaw Blvd., Mandaluyong City",
    });

    const p1 = selectedProducts[0];
    const p2 = selectedProducts[1] || selectedProducts[0];
    const p3 = selectedProducts[2] || selectedProducts[0];
    const riderId = demoUserIds["Drivers"] || null;

    const ensureSalesForDate = async (saleDateYmd, minimumCount) => {
      const [[existing]] = await conn.query(
        `SELECT COUNT(*) AS count
         FROM Sales
         WHERE UserID = :userId AND DATE(SaleDate) = :saleDate`,
        { userId: jose.UserID, saleDate: saleDateYmd }
      );

      const missing = Math.max(0, minimumCount - Number(existing.count || 0));
      if (!missing) return 0;

      const orderTypes = ["Walk-in", "Delivery", "Pickup"];
      const paymentMethods = ["Cash", "Gcash", "Card"];
      let created = 0;

      for (let i = 0; i < missing; i++) {
        const hour = 8 + (i % 12);
        const minute = (i * 11) % 60;
        const saleDate = new Date(`${saleDateYmd}T00:00:00`);
        saleDate.setHours(hour, minute, 0, 0);

        const useCustomerB = i % 2 === 1;
        const withDelivery = i % 4 === 0;
        const orderType = withDelivery ? "Delivery" : orderTypes[i % orderTypes.length];
        const paymentMethod = paymentMethods[i % paymentMethods.length];
        const discount = i % 7 === 0 ? 50 : 0;

        const itemLines = [
          { product: p1, qty: 1 + (i % 3), unitPrice: Number(p1.UnitPrice) },
          { product: p2, qty: 1 + ((i + 1) % 2), unitPrice: Number(p2.UnitPrice) },
        ];
        if (i % 3 === 0) {
          itemLines.push({ product: p3, qty: 1, unitPrice: Number(p3.UnitPrice) });
        }

        const subtotal = itemLines.reduce((sum, it) => sum + it.qty * it.unitPrice, 0);
        const totalAmount = Math.max(0, subtotal - discount);

        const orderId = await nextId(conn, "`Order`", "OrderID", "ORD");
        const saleId = await nextId(conn, "Sales", "SaleID", "S");
        const orderNo = await nextSequence(conn, "`Order`", "OrderNo", "ORD");
        const saleNo = await nextSequence(conn, "Sales", "SaleNo", "SALE");

        await conn.query(
          `INSERT INTO \`Order\` (OrderID, CustomerID, OrderNo, OrderDate, OrderType, OrderStatus, TotalAmount, Remarks)
           VALUES (:orderId, :customerId, :orderNo, :orderDate, :orderType, :status, :totalAmount, :remarks)`,
          {
            orderId,
            customerId: useCustomerB ? customerB : customerA,
            orderNo,
            orderDate: saleDate,
            orderType,
            status: "Completed",
            totalAmount,
            remarks: `${DEMO_TAG} generated order ${saleDateYmd}`,
          }
        );

        for (const it of itemLines) {
          const orderDetailId = await nextId(conn, "OrderDetails", "OrderDetailID", "OD");
          await conn.query(
            `INSERT INTO OrderDetails (OrderDetailID, OrderID, ProductID, Quantity, UnitPrice, Subtotal)
             VALUES (:orderDetailId, :orderId, :productId, :qty, :unitPrice, :subtotal)`,
            {
              orderDetailId,
              orderId,
              productId: it.product.ProductID,
              qty: it.qty,
              unitPrice: it.unitPrice,
              subtotal: it.qty * it.unitPrice,
            }
          );

          // Intentionally skip InventoryTransaction writes here to keep bulk
          // demo sales generation fast and avoid lock contention.
        }

        await conn.query(
          `INSERT INTO Sales (SaleID, OrderID, CustomerID, UserID, SaleNo, SaleDate, SalesDiscount, TotalAmount, Remarks)
           VALUES (:saleId, :orderId, :customerId, :userId, :saleNo, :saleDate, :discount, :totalAmount, :remarks)`,
          {
            saleId,
            orderId,
            customerId: useCustomerB ? customerB : customerA,
            userId: jose.UserID,
            saleNo,
            saleDate,
            discount,
            totalAmount,
            remarks: `${DEMO_TAG} generated sale ${saleDateYmd}`,
          }
        );

        const paymentId = await nextId(conn, "Payment", "PaymentID", "PAY");
        await conn.query(
          `INSERT INTO Payment (PaymentID, PaymentType, SaleID, PaymentMethod, AmountPaid, PaymentDate, Remarks)
           VALUES (:paymentId, 'Sale', :saleId, :method, :amountPaid, :paymentDate, :remarks)`,
          {
            paymentId,
            saleId,
            method: paymentMethod,
            amountPaid: totalAmount,
            paymentDate: saleDate,
            remarks: `${DEMO_TAG} generated payment`,
          }
        );

        if (withDelivery) {
          const deliveryId = await nextId(conn, "Delivery", "DeliveryID", "D");
          const drNo = await nextSequence(conn, "Delivery", "DRNo", "DR");
          await conn.query(
            `INSERT INTO Delivery (DeliveryID, SaleID, DRNo, DeliveryDate, DeliveredByUserID, DeliveryCharge, DeliveryAddress, DeliveryStatus, Remarks)
             VALUES (:deliveryId, :saleId, :drNo, :deliveryDate, :riderId, :charge, :address, :status, :remarks)`,
            {
              deliveryId,
              saleId,
              drNo,
              deliveryDate: saleDate,
              riderId,
              charge: 60,
              address: "89 Shaw Blvd., Mandaluyong City",
              status: "Delivered",
              remarks: `${DEMO_TAG} generated delivery`,
            }
          );
        }

        created += 1;
      }

      return created;
    };

    const targetCountsByDate = [
      { date: "2026-10-01", minCount: 12 },
      { date: "2026-10-02", minCount: 12 },
      { date: "2026-10-03", minCount: 12 },
      { date: "2026-10-04", minCount: 12 },
      { date: "2026-10-05", minCount: 12 },
      { date: "2026-10-06", minCount: 50 },
      { date: "2026-10-07", minCount: 50 },
    ];

    let generatedSalesCount = 0;
    for (const target of targetCountsByDate) {
      generatedSalesCount += await ensureSalesForDate(target.date, target.minCount);
    }

    console.log(`Generated ${generatedSalesCount} sales transaction(s) for ${TARGET_EMAIL}.`);

    const [complianceTable] = await conn.query(
      `SELECT COUNT(*) AS count
       FROM information_schema.tables
       WHERE table_schema = DATABASE() AND table_name = 'ComplianceReport'`
    );

    if (complianceTable[0].count > 0) {
      const [existingReports] = await conn.query(
        `SELECT COUNT(*) AS count FROM ComplianceReport WHERE ReportName LIKE :tag`,
        { tag: `${DEMO_TAG}%` }
      );

      if (!existingReports[0].count) {
        const reports = [
          {
            name: `${DEMO_TAG} LPG Sales Summary`,
            type: "Sales Summary",
            period: "September 2026",
            start: "2026-09-01",
            end: "2026-09-30",
            due: "2026-10-10",
            status: "Due Soon",
            submittedAt: null,
          },
          {
            name: `${DEMO_TAG} Warehouse Inventory Audit`,
            type: "Inventory Audit",
            period: "Q3 2026",
            start: "2026-07-01",
            end: "2026-09-30",
            due: "2026-09-20",
            status: "Overdue",
            submittedAt: null,
          },
          {
            name: `${DEMO_TAG} Restocking Logs`,
            type: "Restocking Logs",
            period: "September 2026",
            start: "2026-09-01",
            end: "2026-09-30",
            due: "2026-11-05",
            status: "Upcoming",
            submittedAt: null,
          },
          {
            name: `${DEMO_TAG} Monthly Operations Report`,
            type: "Sales Summary",
            period: "August 2026",
            start: "2026-08-01",
            end: "2026-08-31",
            due: "2026-09-05",
            status: "Submitted",
            submittedAt: "2026-09-03 14:20:00",
          },
        ];

        for (const r of reports) {
          const reportId = await nextId(conn, "ComplianceReport", "ReportID", "REP");
          await conn.query(
            `INSERT INTO ComplianceReport
             (ReportID, ReportName, ReportType, PeriodLabel, PeriodStart, PeriodEnd, DueDate, Status, SubmittedAt, SubmittedByUserID, FileName)
             VALUES
             (:reportId, :name, :type, :period, :start, :end, :due, :status, :submittedAt, :submittedByUserID, :fileName)`,
            {
              reportId,
              name: r.name,
              type: r.type,
              period: r.period,
              start: r.start,
              end: r.end,
              due: r.due,
              status: r.status,
              submittedAt: r.submittedAt,
              submittedByUserID: r.status === "Submitted" ? jose.UserID : null,
              fileName: r.status === "Submitted" ? `${r.name.replace(/\s+/g, "_")}.csv` : null,
            }
          );
        }
      }
    }

    const [existingDataLog] = await conn.query(
      `SELECT COUNT(*) AS count FROM DataActivityLog WHERE FileName LIKE :tag`,
      { tag: `%${DEMO_TAG}%` }
    );
    if (!existingDataLog[0].count) {
      const dataLogs = [
        { activityType: "Import", dataType: "Inventory Data", fileName: `${DEMO_TAG}_inventory_adjustments.csv`, fileFormat: "CSV", dateFrom: "2026-09-01", dateTo: "2026-09-30", status: "Successful", activityDate: "2026-09-28 09:10:00" },
        { activityType: "Generate Report", dataType: "Sales Summary", fileName: `${DEMO_TAG}_sales_summary_sep2026.csv`, fileFormat: "CSV", dateFrom: "2026-09-01", dateTo: "2026-09-30", status: "Successful", activityDate: "2026-09-29 16:35:00" },
      ];

      for (const d of dataLogs) {
        const dataActivityId = await nextId(conn, "DataActivityLog", "DataActivityID", "DA");
        await conn.query(
          `INSERT INTO DataActivityLog (DataActivityID, UserID, ActivityType, DataType, FileName, FileFormat, DateFrom, DateTo, Status, ActivityDate)
           VALUES (:dataActivityId, :userId, :activityType, :dataType, :fileName, :fileFormat, :dateFrom, :dateTo, :status, :activityDate)`,
          {
            dataActivityId,
            userId: jose.UserID,
            ...d,
          }
        );
      }
    }

    const [existingUserLog] = await conn.query(
      `SELECT COUNT(*) AS count FROM UserActivity WHERE Description LIKE :tag`,
      { tag: `%${DEMO_TAG}%` }
    );
    if (!existingUserLog[0].count) {
      const activities = [
        { module: "Users", action: "Create", description: `${DEMO_TAG}: Added team accounts for operations and delivery`, date: "2026-09-26 10:20:00" },
        { module: "Suppliers", action: "Create", description: `${DEMO_TAG}: Added two accredited suppliers`, date: "2026-09-26 11:05:00" },
        { module: "Inventory", action: "Update", description: `${DEMO_TAG}: Uploaded opening stock balances`, date: "2026-09-27 08:40:00" },
        { module: "Sales", action: "Create", description: `${DEMO_TAG}: Recorded sample retail and delivery sales`, date: "2026-09-29 14:15:00" },
      ];

      for (const a of activities) {
        const userActivityId = await nextId(conn, "UserActivity", "UserActivityID", "UA");
        await conn.query(
          `INSERT INTO UserActivity (UserActivityID, UserID, ActivityType, Module, RecordID, Description, ActivityDate)
           VALUES (:userActivityId, :userId, :activityType, :module, :recordId, :description, :activityDate)`,
          {
            userActivityId,
            userId: jose.UserID,
            activityType: a.action,
            module: a.module,
            recordId: null,
            description: a.description,
            activityDate: a.date,
          }
        );
      }
    }

    if (txStarted) await conn.commit();
    console.log("Demo data seeded successfully for:", TARGET_EMAIL);
  } catch (err) {
    if (txStarted) await conn.rollback();
    console.error("Demo seed failed:", err.message);
    process.exitCode = 1;
  } finally {
    conn.release();
    await pool.end();
  }
}

main();


