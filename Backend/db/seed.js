require("dotenv").config();
const bcrypt = require("bcryptjs");
const pool = require("../config/db");

async function seed() {
  console.log("Starting GasTrack database schema creation and seeding...");

  // Disable Foreign Key Checks
  await pool.query("SET FOREIGN_KEY_CHECKS = 0");

  // Drop existing tables
  await pool.query(`
    DROP TABLE IF EXISTS 
      UserActivity, 
      DataActivityLog, 
      PurchaseOrderItem, 
      PurchaseOrder,
      RestockRecommendation, 
      DeliveryAction,
      Delivery, 
      Payment, 
      Sales, 
      OrderDetails, 
      \`Order\`, 
      Customer,
      TransferDetail, 
      Transfer, 
      InventoryTransaction, 
      Inventory, 
      Warehouse, 
      Branch, 
      Product,
      Supplier, 
      Brand, 
      Category, 
      CompanySettings, 
      \`User\`, 
      Role, 
      Company
  `);

  // 1. Company Table
  await pool.query(`
    CREATE TABLE Company (
      CompanyID VARCHAR(20) PRIMARY KEY,
      CompanyName VARCHAR(150) NOT NULL UNIQUE,
      DTIRegNo VARCHAR(50) NOT NULL UNIQUE,
      DOENo VARCHAR(50) NULL,
      PrimaryBranch VARCHAR(100) NULL,
      Address VARCHAR(255) NOT NULL
    )
  `);

  // 2. Role Table
  await pool.query(`
    CREATE TABLE Role (
      RoleID VARCHAR(20) PRIMARY KEY,
      RoleName VARCHAR(50) NOT NULL UNIQUE
    )
  `);

  // 3. Category Table
  await pool.query(`
    CREATE TABLE Category (
      CategoryID VARCHAR(20) PRIMARY KEY,
      Category VARCHAR(100) NOT NULL UNIQUE
    )
  `);

  // 4. Brand Table
  await pool.query(`
    CREATE TABLE Brand (
      BrandID VARCHAR(20) PRIMARY KEY,
      Brand VARCHAR(100) NOT NULL UNIQUE
    )
  `);

  // 5. Supplier Table
  await pool.query(`
    CREATE TABLE Supplier (
      SupplierID VARCHAR(20) PRIMARY KEY,
      SupplierName VARCHAR(150) NOT NULL,
      ContactPerson VARCHAR(100) NULL,
      Email VARCHAR(150) NULL,
      Address VARCHAR(255) NULL,
      Contact VARCHAR(30) NULL,
      LeadTimeDays INT NOT NULL DEFAULT 0,
      Status VARCHAR(20) NOT NULL DEFAULT 'Active',
      CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 6. Branch Table
  await pool.query(`
    CREATE TABLE Branch (
      BranchID VARCHAR(20) PRIMARY KEY,
      CompanyID VARCHAR(20) NOT NULL,
      BranchName VARCHAR(100) NOT NULL,
      Address VARCHAR(255) NOT NULL,
      ContactNo VARCHAR(30) NULL,
      Status VARCHAR(20) NOT NULL DEFAULT 'Active',
      FOREIGN KEY (CompanyID) REFERENCES Company(CompanyID)
    )
  `);

  // 7. Warehouse Table
  await pool.query(`
    CREATE TABLE Warehouse (
      WarehouseID VARCHAR(20) PRIMARY KEY,
      CompanyID VARCHAR(20) NOT NULL,
      WarehouseName VARCHAR(100) NOT NULL,
      Location VARCHAR(255) NOT NULL,
      Status VARCHAR(20) NOT NULL DEFAULT 'Active',
      CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (CompanyID) REFERENCES Company(CompanyID)
    )
  `);

  // 8. User Table
  await pool.query(`
    CREATE TABLE \`User\` (
      UserID VARCHAR(20) PRIMARY KEY,
      CompanyID VARCHAR(20) NOT NULL,
      RoleID VARCHAR(20) NOT NULL,
      WarehouseID VARCHAR(20) NULL,
      FirstName VARCHAR(50) NOT NULL,
      LastName VARCHAR(50) NOT NULL,
      Email VARCHAR(150) NOT NULL UNIQUE,
      PasswordHash VARCHAR(255) NOT NULL,
      Status VARCHAR(20) NOT NULL DEFAULT 'Active',
      ModuleAccess JSON NULL,
      CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (CompanyID) REFERENCES Company(CompanyID),
      FOREIGN KEY (RoleID) REFERENCES Role(RoleID),
      CONSTRAINT fk_user_warehouse FOREIGN KEY (WarehouseID) REFERENCES Warehouse(WarehouseID)
    )
  `);

  // 9. Product Table
  await pool.query(`
    CREATE TABLE Product (
      ProductID VARCHAR(20) PRIMARY KEY,
      ProductName VARCHAR(150) NOT NULL,
      CategoryID VARCHAR(20) NOT NULL,
      BrandID VARCHAR(20) NOT NULL,
      SupplierID VARCHAR(20) NOT NULL,
      Unit VARCHAR(30) NOT NULL,
      UnitValue VARCHAR(50) NULL,
      UnitPrice DECIMAL(12,2) NOT NULL CHECK (UnitPrice >= 0),
      CostPrice DECIMAL(12,2) NOT NULL CHECK (CostPrice >= 0),
      ReorderLevel INT NOT NULL CHECK (ReorderLevel >= 0),
      ImageURL VARCHAR(500) NULL,
      ARModelURL VARCHAR(500) NULL,
      Status VARCHAR(20) NOT NULL DEFAULT 'Active',
      CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (CategoryID) REFERENCES Category(CategoryID),
      FOREIGN KEY (BrandID) REFERENCES Brand(BrandID),
      FOREIGN KEY (SupplierID) REFERENCES Supplier(SupplierID)
    )
  `);

  // 10. Inventory Table
  await pool.query(`
    CREATE TABLE Inventory (
      InventoryID VARCHAR(20) PRIMARY KEY,
      WarehouseID VARCHAR(20) NOT NULL,
      ProductID VARCHAR(20) NOT NULL,
      StockOnHand INT NOT NULL DEFAULT 0 CHECK (StockOnHand >= 0),
      LastUpdated DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_warehouse_product (WarehouseID, ProductID),
      FOREIGN KEY (WarehouseID) REFERENCES Warehouse(WarehouseID),
      FOREIGN KEY (ProductID) REFERENCES Product(ProductID)
    )
  `);

  // 11. InventoryTransaction Table
  await pool.query(`
    CREATE TABLE InventoryTransaction (
      TransactionID VARCHAR(20) PRIMARY KEY,
      InventoryID VARCHAR(20) NOT NULL,
      UserID VARCHAR(20) NOT NULL,
      TransactionType VARCHAR(20) NOT NULL,
      Quantity INT NOT NULL CHECK (Quantity > 0),
      Reason VARCHAR(30) NOT NULL,
      ReferenceNo VARCHAR(50) NULL,
      TransactionDate DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      Remarks VARCHAR(255) NULL,
      FOREIGN KEY (InventoryID) REFERENCES Inventory(InventoryID),
      FOREIGN KEY (UserID) REFERENCES \`User\`(UserID)
    )
  `);

  // 12. Transfer Table
  await pool.query(`
    CREATE TABLE Transfer (
      TransferID VARCHAR(20) PRIMARY KEY,
      FromWarehouseID VARCHAR(20) NOT NULL,
      ToWarehouseID VARCHAR(20) NOT NULL,
      UserID VARCHAR(20) NOT NULL,
      TransferDate DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      Status VARCHAR(20) NOT NULL,
      Remarks VARCHAR(255) NULL,
      FOREIGN KEY (FromWarehouseID) REFERENCES Warehouse(WarehouseID),
      FOREIGN KEY (ToWarehouseID) REFERENCES Warehouse(WarehouseID),
      FOREIGN KEY (UserID) REFERENCES \`User\`(UserID)
    )
  `);

  // 13. TransferDetail Table
  await pool.query(`
    CREATE TABLE TransferDetail (
      TransferDetailID VARCHAR(20) PRIMARY KEY,
      TransferID VARCHAR(20) NOT NULL,
      ProductID VARCHAR(20) NOT NULL,
      Quantity INT NOT NULL CHECK (Quantity > 0),
      FOREIGN KEY (TransferID) REFERENCES Transfer(TransferID),
      FOREIGN KEY (ProductID) REFERENCES Product(ProductID)
    )
  `);

  // 14. Customer Table
  await pool.query(`
    CREATE TABLE Customer (
      CustomerID VARCHAR(20) PRIMARY KEY,
      UserID VARCHAR(20) NULL,
      CustomerType VARCHAR(20) NOT NULL,
      CustomerName VARCHAR(150) NOT NULL DEFAULT '',
      ContactNo VARCHAR(30) NOT NULL,
      Address VARCHAR(255) NOT NULL,
      Status VARCHAR(20) NOT NULL DEFAULT 'Active',
      CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UpdatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (UserID) REFERENCES \`User\`(UserID)
    )
  `);

  // 15. Order Table
  await pool.query(`
    CREATE TABLE \`Order\` (
      OrderID VARCHAR(20) PRIMARY KEY,
      CustomerID VARCHAR(20) NOT NULL,
      OrderNo VARCHAR(50) NOT NULL UNIQUE,
      OrderDate DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      OrderType VARCHAR(20) NOT NULL,
      OrderStatus VARCHAR(30) NOT NULL,
      TotalAmount DECIMAL(12,2) NOT NULL CHECK (TotalAmount >= 0),
      Remarks VARCHAR(255) NULL,
      FOREIGN KEY (CustomerID) REFERENCES Customer(CustomerID)
    )
  `);

  // 16. OrderDetails Table
  await pool.query(`
    CREATE TABLE OrderDetails (
      OrderDetailID VARCHAR(20) PRIMARY KEY,
      OrderID VARCHAR(20) NOT NULL,
      ProductID VARCHAR(20) NOT NULL,
      Quantity INT NOT NULL CHECK (Quantity > 0),
      UnitPrice DECIMAL(12,2) NOT NULL CHECK (UnitPrice >= 0),
      Subtotal DECIMAL(12,2) NOT NULL CHECK (Subtotal >= 0),
      FOREIGN KEY (OrderID) REFERENCES \`Order\`(OrderID),
      FOREIGN KEY (ProductID) REFERENCES Product(ProductID)
    )
  `);

  // 17. Sales Table
  await pool.query(`
    CREATE TABLE Sales (
      SaleID VARCHAR(20) PRIMARY KEY,
      OrderID VARCHAR(20) NULL,
      CustomerID VARCHAR(20) NOT NULL,
      UserID VARCHAR(20) NOT NULL,
      SaleNo VARCHAR(50) NOT NULL UNIQUE,
      SaleDate DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      SalesDiscount DECIMAL(12,2) NOT NULL DEFAULT 0 CHECK (SalesDiscount >= 0),
      TotalAmount DECIMAL(12,2) NOT NULL CHECK (TotalAmount >= 0),
      Remarks VARCHAR(255) NULL,
      FOREIGN KEY (OrderID) REFERENCES \`Order\`(OrderID),
      FOREIGN KEY (CustomerID) REFERENCES Customer(CustomerID),
      FOREIGN KEY (UserID) REFERENCES \`User\`(UserID)
    )
  `);

  // 18. RestockRecommendation Table
  await pool.query(`
    CREATE TABLE RestockRecommendation (
      RestockID VARCHAR(20) PRIMARY KEY,
      ProductID VARCHAR(20) NOT NULL,
      SupplierID VARCHAR(20) NOT NULL,
      StockOnHand INT NOT NULL DEFAULT 0 CHECK (StockOnHand >= 0),
      PredictedDemand INT NOT NULL CHECK (PredictedDemand >= 0),
      RecommendedQuantity INT NOT NULL CHECK (RecommendedQuantity >= 0),
      Confidence DECIMAL(5,2) NULL,
      ForecastDate DATE NOT NULL,
      Status VARCHAR(20) NOT NULL,
      CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (ProductID) REFERENCES Product(ProductID),
      FOREIGN KEY (SupplierID) REFERENCES Supplier(SupplierID)
    )
  `);

  // 19. PurchaseOrder Table
  await pool.query(`
    CREATE TABLE PurchaseOrder (
      PurchaseOrderID VARCHAR(20) PRIMARY KEY,
      SupplierID VARCHAR(20) NOT NULL,
      RestockID VARCHAR(20) NULL,
      CreatedByUserID VARCHAR(20) NOT NULL,
      PONo VARCHAR(50) NOT NULL UNIQUE,
      OrderDate DATETIME NOT NULL,
      ExpectedDeliveryDate DATE NULL,
      Status VARCHAR(30) NOT NULL,
      TotalAmount DECIMAL(12,2) NOT NULL CHECK (TotalAmount >= 0),
      Remarks VARCHAR(255) NULL,
      CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (SupplierID) REFERENCES Supplier(SupplierID),
      FOREIGN KEY (RestockID) REFERENCES RestockRecommendation(RestockID),
      FOREIGN KEY (CreatedByUserID) REFERENCES \`User\`(UserID)
    )
  `);

  // 20. PurchaseOrderItem Table
  await pool.query(`
    CREATE TABLE PurchaseOrderItem (
      PurchaseOrderItemID VARCHAR(20) PRIMARY KEY,
      PurchaseOrderID VARCHAR(20) NOT NULL,
      ProductID VARCHAR(20) NOT NULL,
      Quantity INT NOT NULL CHECK (Quantity > 0),
      UnitCost DECIMAL(12,2) NOT NULL CHECK (UnitCost >= 0),
      Subtotal DECIMAL(12,2) NOT NULL CHECK (Subtotal >= 0),
      FOREIGN KEY (PurchaseOrderID) REFERENCES PurchaseOrder(PurchaseOrderID),
      FOREIGN KEY (ProductID) REFERENCES Product(ProductID)
    )
  `);

  // 21. Payment Table
  await pool.query(`
    CREATE TABLE Payment (
      PaymentID VARCHAR(20) PRIMARY KEY,
      PaymentType VARCHAR(20) NOT NULL,
      SaleID VARCHAR(20) NULL,
      PurchaseOrderID VARCHAR(20) NULL,
      PaymentMethod VARCHAR(30) NOT NULL,
      AmountPaid DECIMAL(12,2) NOT NULL CHECK (AmountPaid > 0),
      PaymentDate DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      ReferenceNo VARCHAR(50) NULL,
      Remarks VARCHAR(255) NULL,
      FOREIGN KEY (SaleID) REFERENCES Sales(SaleID),
      FOREIGN KEY (PurchaseOrderID) REFERENCES PurchaseOrder(PurchaseOrderID)
    )
  `);

  // 22. Delivery Table
  await pool.query(`
    CREATE TABLE Delivery (
      DeliveryID VARCHAR(20) PRIMARY KEY,
      SaleID VARCHAR(20) NOT NULL UNIQUE,
      DRNo VARCHAR(50) NOT NULL UNIQUE,
      DeliveryDate DATETIME NULL,
      DeliveredByUserID VARCHAR(20) NULL,
      DeliveryCharge DECIMAL(12,2) NOT NULL DEFAULT 0 CHECK (DeliveryCharge >= 0),
      DeliveryAddress VARCHAR(255) NOT NULL,
      DeliveryStatus VARCHAR(30) NOT NULL,
      Remarks VARCHAR(255) NULL,
      FOREIGN KEY (SaleID) REFERENCES Sales(SaleID),
      FOREIGN KEY (DeliveredByUserID) REFERENCES \`User\`(UserID)
    )
  `);

  await require("./migrate_delivery_lifecycle")();

  // 23. DataActivityLog Table
  await pool.query(`
    CREATE TABLE DataActivityLog (
      DataActivityID VARCHAR(20) PRIMARY KEY,
      UserID VARCHAR(20) NOT NULL,
      ActivityType VARCHAR(30) NOT NULL,
      DataType VARCHAR(50) NOT NULL,
      FileName VARCHAR(255) NOT NULL,
      FileFormat VARCHAR(20) NOT NULL,
      DateFrom DATE NULL,
      DateTo DATE NULL,
      Status VARCHAR(20) NOT NULL,
      ActivityDate DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (UserID) REFERENCES \`User\`(UserID)
    )
  `);

  // 24. UserActivity Table
  await pool.query(`
    CREATE TABLE UserActivity (
      UserActivityID VARCHAR(20) PRIMARY KEY,
      UserID VARCHAR(20) NOT NULL,
      ActivityType VARCHAR(30) NOT NULL,
      Module VARCHAR(50) NOT NULL,
      RecordID VARCHAR(20) NULL,
      Description VARCHAR(500) NULL,
      ActivityDate DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (UserID) REFERENCES \`User\`(UserID)
    )
  `);

  // 25. CompanySettings Table
  await pool.query(`
    CREATE TABLE CompanySettings (
      CompanyID VARCHAR(20) PRIMARY KEY,
      FullName VARCHAR(150) NULL,
      Address VARCHAR(255) NULL,
      ContactEmail VARCHAR(150) NULL,
      Phone              VARCHAR(30) NULL,
  Branch             VARCHAR(150) NULL,
  Warehouse          VARCHAR(150) NULL,
  Brand              VARCHAR(150) NULL,
  LogoDataUrl        LONGTEXT NULL,
      BusinessDays VARCHAR(100) NOT NULL DEFAULT 'Monday,Tuesday,Wednesday,Thursday,Friday,Saturday',
  OpeningTime TIME NOT NULL DEFAULT '08:00:00',
  ClosingTime TIME NOT NULL DEFAULT '17:00:00',
  PickupExpirationDays INT UNSIGNED NOT NULL DEFAULT 3,
  MaxDeliveryAttempts INT UNSIGNED NOT NULL DEFAULT 3,
  TaxRate DECIMAL(5,2) NOT NULL DEFAULT 12.00,
      TaxEnabled TINYINT(1) NOT NULL DEFAULT 1,
      Currency VARCHAR(10) NOT NULL DEFAULT 'PHP',
      RoundUp TINYINT(1) NOT NULL DEFAULT 0,
      RoundDown TINYINT(1) NOT NULL DEFAULT 0,
      TwoDecimalStandard TINYINT(1) NOT NULL DEFAULT 1,
      ReceiptHeader TEXT NULL,
      ShowLogoOnReceipt TINYINT(1) NOT NULL DEFAULT 1,
      ShowTaxBreakdown TINYINT(1) NOT NULL DEFAULT 1,
      FooterMessage VARCHAR(255) NULL,
      PrintSize VARCHAR(10) NOT NULL DEFAULT '80mm',
      AutoLogoutMinutes INT NOT NULL DEFAULT 30,
      SystemTimezone VARCHAR(50) NOT NULL DEFAULT 'Asia/Manila',
      DateFormat VARCHAR(20) NOT NULL DEFAULT 'MM/DD/YYYY',
      Language VARCHAR(10) NOT NULL DEFAULT 'en',
      Theme VARCHAR(10) NOT NULL DEFAULT 'light',
      UpdatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (CompanyID) REFERENCES Company(CompanyID)
    )
  `);

  // Enable Foreign Key Checks back
  await pool.query("SET FOREIGN_KEY_CHECKS = 1");

  console.log("Schema created successfully. Seeding initial data...");

  // Seed Company
  await pool.query(`
    INSERT INTO Company (CompanyID, CompanyName, DTIRegNo, DOENo, PrimaryBranch, Address) 
    VALUES ('C-001', 'Glorious Commercial Exports, Inc.', 'DTI-2026-001234', 'DOE-LPG-2026-000157', 'Glorious Main Branch', '266 F. Blumentritt, Batis, San Juan City, Metro Manila')
  `);

  // Seed Roles
  await pool.query(`
    INSERT INTO Role (RoleID, RoleName) VALUES 
    ('RL-001', 'Administrator'),
    ('RL-002', 'Operations Supervisor'),
    ('RL-003', 'Assistant Operations Supervisor'),
    ('RL-004', 'Store Supervisor'),
    ('RL-005', 'Assistant Store Supervisor'),
    ('RL-006', 'Stockman'),
    ('RL-007', 'Head Maintenance'),
    ('RL-008', 'Drivers'),
    ('RL-009', 'Helpers'),
    ('RL-010', 'Customer')
  `);

  // Seed Categories
  await pool.query(`
    INSERT INTO Category (CategoryID, Category) VALUES 
    ('CTGRY-001', 'Gasul LPG'),
    ('CTGRY-002', 'Cylinder'),
    ('CTGRY-003', 'Accessories')
  `);

  // Seed Brand
  await pool.query(`
    INSERT INTO Brand (BrandID, Brand) VALUES 
    ('BD-001', 'Petron')
  `);

  // Seed Supplier
  await pool.query(`
    INSERT INTO Supplier (SupplierID, SupplierName, ContactPerson, Email, Address, Contact, LeadTimeDays, Status, CreatedAt) 
    VALUES ('SP-001', 'Petron Corporation', 'Marie Ann Palaez', 'marieannpalaez@petron.com', '40 San Miguel Avenue 1550 Mandaluyong City', '09191607111', 3, 'Active', '2023-09-10 09:00:00')
  `);

  // Seed Branch
  await pool.query(`
    INSERT INTO Branch (BranchID, CompanyID, BranchName, Address, ContactNo, Status) 
    VALUES ('BRH-001', 'C-001', 'Glorious Commercial Exports, Inc. - San Juan', '266 F. Blumentritt, Batis, San Juan City, Metro Manila', '09569677956', 'Active')
  `);

  // Seed Warehouses
  await pool.query(`
    INSERT INTO Warehouse (WarehouseID, CompanyID, WarehouseName, Location, Status, CreatedAt) VALUES 
    ('WH-001', 'C-001', 'San Juan Warehouse', '266 F. Blumentritt, Batis, San Juan City, Metro Manila', 'Active', '2023-09-15 09:00:00'),
    ('WH-002', 'C-001', 'Pasig Warehouse', 'Maxville, 6 Luis St., Brgy. San Miguel, Pasig City', 'Active', '2023-09-15 09:30:00')
  `);

  // Seed Key Admin & Operational Users
  const defaultPasswordHash = await bcrypt.hash("Admin@123", 10);

  await pool.query(`
    INSERT INTO \`User\` (UserID, CompanyID, RoleID, WarehouseID, FirstName, LastName, Email, PasswordHash, Status, ModuleAccess, CreatedAt) VALUES 
    ('U-001', 'C-001', 'RL-001', NULL, 'Jose Ramon', 'Villanueva', 'jose.villanueva.admin@gmail.com', '${defaultPasswordHash}', 'Active', '["Users"]', '2023-09-15 09:00:00'),
    ('U-002', 'C-001', 'RL-002', 'WH-001', 'Maria Teresa', 'Santos', 'maria.santos@gloriouscommercial.ph', '${defaultPasswordHash}', 'Active', '["Dashboard", "Inventory", "Products", "Sales", "Suppliers", "Restocking", "Report Generation & Compliance", "Data Module", "Users"]', '2023-09-18 09:30:00'),
    ('U-003', 'C-001', 'RL-003', 'WH-002', 'Antonio', 'Bautista', 'antonio.bautista@gloriouscommercial.ph', '${defaultPasswordHash}', 'Active', '["Dashboard", "Inventory", "Products", "Sales", "Suppliers", "Restocking", "Report Generation & Compliance", "Data Module"]', '2023-09-18 10:00:00')
  `);

  // Seed Products
  await pool.query(`
    INSERT INTO Product (ProductID, ProductName, CategoryID, BrandID, SupplierID, Unit, UnitPrice, CostPrice, ReorderLevel, ImageURL, ARModelURL, Status, CreatedAt) VALUES 
    ('P-D2N7X4KP', 'Gasul LPG 2.7 kg', 'CTGRY-001', 'BD-001', 'SP-001', 'kg', 243.00, 200.00, 30, NULL, NULL, 'Active', '2023-09-20 10:00:00'),
    ('P-BX6T9R4N', 'Gasul LPG 7 kg', 'CTGRY-001', 'BD-001', 'SP-001', 'kg', 603.00, 560.00, 20, NULL, NULL, 'Active', '2023-09-20 10:00:00'),
    ('P-P3N8XK5T', 'Gasul LPG 11 kg Elite', 'CTGRY-001', 'BD-001', 'SP-001', 'kg', 907.00, 850.00, 40, NULL, NULL, 'Active', '2023-09-20 10:00:00'),
    ('P-M7Q2Z9LR', 'Gasul LPG 11 kg', 'CTGRY-001', 'BD-001', 'SP-001', 'kg', 921.00, 870.00, 50, NULL, NULL, 'Active', '2023-09-20 10:00:00'),
    ('P-H4V8TN2W', 'Gasul LPG 22 kg', 'CTGRY-001', 'BD-001', 'SP-001', 'kg', 1726.00, 1680.00, 15, NULL, NULL, 'Active', '2023-09-20 10:00:00'),
    ('P-7KF29M3Q', 'Gasul LPG 50 kg', 'CTGRY-001', 'BD-001', 'SP-001', 'kg', 3964.00, 3890.00, 10, NULL, NULL, 'Active', '2023-09-20 10:00:00')
  `);

  // Seed Inventory
  await pool.query(`
    INSERT INTO Inventory (InventoryID, WarehouseID, ProductID, StockOnHand, LastUpdated) VALUES 
    ('INT-001', 'WH-001', 'P-D2N7X4KP', 11, '2026-09-27 10:32:24'),
    ('INT-002', 'WH-001', 'P-BX6T9R4N', 8, '2026-09-24 10:43:06'),
    ('INT-003', 'WH-001', 'P-P3N8XK5T', 18, '2026-09-26 09:33:00'),
    ('INT-004', 'WH-001', 'P-M7Q2Z9LR', 105, '2026-09-28 10:16:29'),
    ('INT-005', 'WH-001', 'P-H4V8TN2W', 36, '2026-09-28 07:55:00'),
    ('INT-006', 'WH-001', 'P-7KF29M3Q', 7, '2026-09-26 13:04:15')
  `);

  // Seed Default Customer
  await pool.query(`
    INSERT INTO Customer (CustomerID, UserID, CustomerType, CustomerName, ContactNo, Address, Status, CreatedAt, UpdatedAt) 
    VALUES ('CUST-001', NULL, 'Residential', 'Walk-in Customer', 'N/A', 'San Juan City, Metro Manila', 'Active', '2023-09-20 09:00:00', '2023-09-20 09:00:00')
  `);

  await pool.query("UPDATE Product SET UnitValue = LOWER(REGEXP_SUBSTR(ProductName, '[0-9]+([.][0-9]+)?[ ]*[kK][gG]')) WHERE UnitValue IS NULL AND ProductName REGEXP '[0-9]+([.][0-9]+)?[ ]*[kK][gG]'");
  // Keep seeded databases compatible with the customer profile/history APIs.
  await require("./migrate_customer_history")();
  // Pickup queues and claims require all three pickup migration stages.
  await require("./migrate_pickup_claim")();
  console.log("Database schema creation and seeding complete.");
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seeding failed with error:", err);
  process.exit(1);
});



