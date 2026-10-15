
SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS DeliveryAction, PickupClaim, PickupSettlement, UserActivity, DataActivityLog, Delivery, Payment, Sales,
  OrderDetails, `Order`, Customer, TransferDetail, Transfer, InventoryTransaction,
  RefundLedger, Inventory, PurchaseOrderItem, PurchaseOrder, RestockRecommendation, CompanySettings,
  User, Warehouse, Branch, Product, Supplier, Brand, Category, Role, Company;

CREATE TABLE Company (
  CompanyID      VARCHAR(20) PRIMARY KEY,               -- C-001
  CompanyName    VARCHAR(150) NOT NULL UNIQUE,
  DTIRegNo       VARCHAR(50)  NOT NULL UNIQUE,
  DOENo          VARCHAR(50)  NULL,
  PrimaryBranch  VARCHAR(100) NULL,
  Address        VARCHAR(255) NOT NULL
);

CREATE TABLE Role (
  RoleID    VARCHAR(20) PRIMARY KEY,                    -- RL-001
  RoleName  VARCHAR(50) NOT NULL UNIQUE
);

CREATE TABLE Category (
  CategoryID  VARCHAR(20) PRIMARY KEY,                  -- CTGRY-001
  Category    VARCHAR(100) NOT NULL UNIQUE
);

CREATE TABLE Brand (
  BrandID  VARCHAR(20) PRIMARY KEY,                     -- BD-001
  Brand    VARCHAR(100) NOT NULL UNIQUE
);

CREATE TABLE Supplier (
  SupplierID     VARCHAR(20) PRIMARY KEY,               -- SP-001
  SupplierName   VARCHAR(150) NOT NULL,
  ContactPerson  VARCHAR(100) NULL,
  Email          VARCHAR(150) NULL,
  Address        VARCHAR(255) NULL,
  Contact        VARCHAR(30)  NULL,
  LeadTimeDays   INT NOT NULL DEFAULT 0,
  Status         VARCHAR(20) NOT NULL DEFAULT 'Active',
  CreatedAt      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE Product (
  ProductID     VARCHAR(20) PRIMARY KEY,                -- P-001
  ProductName   VARCHAR(150) NOT NULL,
  CategoryID    VARCHAR(20) NOT NULL,
  BrandID       VARCHAR(20) NOT NULL,
  SupplierID    VARCHAR(20) NOT NULL,
  Unit          VARCHAR(30) NOT NULL,
  UnitValue      VARCHAR(50) NULL,
  UnitPrice     DECIMAL(12,2) NOT NULL CHECK (UnitPrice >= 0),
  CostPrice     DECIMAL(12,2) NOT NULL CHECK (CostPrice >= 0),
  ReorderLevel  INT NOT NULL CHECK (ReorderLevel >= 0),
  ImageURL      VARCHAR(500) NULL,
  ARModelURL    VARCHAR(500) NULL,
  Status        VARCHAR(20) NOT NULL DEFAULT 'Active',
  CreatedAt     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (CategoryID) REFERENCES Category(CategoryID),
  FOREIGN KEY (BrandID)    REFERENCES Brand(BrandID),
  FOREIGN KEY (SupplierID) REFERENCES Supplier(SupplierID)
);

CREATE TABLE Branch (
  BranchID   VARCHAR(20) PRIMARY KEY,                   -- BRH-001
  CompanyID  VARCHAR(20) NOT NULL,
  BranchName VARCHAR(100) NOT NULL,
  Address    VARCHAR(255) NOT NULL,
  ContactNo  VARCHAR(30) NULL,
  Status     VARCHAR(20) NOT NULL DEFAULT 'Active',
  FOREIGN KEY (CompanyID) REFERENCES Company(CompanyID)
);

CREATE TABLE Warehouse (
  WarehouseID    VARCHAR(20) PRIMARY KEY,               -- WH-001
  CompanyID      VARCHAR(20) NOT NULL,
  WarehouseName  VARCHAR(100) NOT NULL,
  Location       VARCHAR(255) NOT NULL,
  Status         VARCHAR(20) NOT NULL DEFAULT 'Active',
  CreatedAt      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (CompanyID) REFERENCES Company(CompanyID)
);

CREATE TABLE User (
  UserID        VARCHAR(20) PRIMARY KEY,                -- U-001
  CompanyID     VARCHAR(20) NOT NULL,
  RoleID        VARCHAR(20) NOT NULL,
  WarehouseID   VARCHAR(20) NULL,
  FirstName     VARCHAR(50) NOT NULL,
  LastName      VARCHAR(50) NOT NULL,
  Email         VARCHAR(150) NOT NULL UNIQUE,
  PasswordHash  VARCHAR(255) NOT NULL,
  Status        VARCHAR(20) NOT NULL DEFAULT 'Active',
  ModuleAccess  JSON NULL,
  CreatedAt     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (CompanyID)   REFERENCES Company(CompanyID),
  FOREIGN KEY (RoleID)      REFERENCES Role(RoleID),
  FOREIGN KEY (WarehouseID) REFERENCES Warehouse(WarehouseID)
);

CREATE TABLE Inventory (
  InventoryID   VARCHAR(20) PRIMARY KEY,                -- INT-001
  WarehouseID   VARCHAR(20) NOT NULL,
  ProductID     VARCHAR(20) NOT NULL,
  StockOnHand   INT NOT NULL DEFAULT 0 CHECK (StockOnHand >= 0),
  LastUpdated   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_warehouse_product (WarehouseID, ProductID),
  FOREIGN KEY (WarehouseID) REFERENCES Warehouse(WarehouseID),
  FOREIGN KEY (ProductID)   REFERENCES Product(ProductID)
);

CREATE TABLE InventoryTransaction (
  TransactionID    VARCHAR(20) PRIMARY KEY,             -- T-001
  InventoryID      VARCHAR(20) NOT NULL,
  UserID           VARCHAR(20) NOT NULL,
  TransactionType  VARCHAR(20) NOT NULL,                -- 'Stock In' | 'Stock Out'
  Quantity         INT NOT NULL CHECK (Quantity > 0),
  Reason           VARCHAR(30) NOT NULL,                -- Purchase, Sale, Transfer, Damaged, Lost, Adjustment
  ReferenceNo      VARCHAR(50) NULL,                    -- PONo / SaleNo / TransferID / count ref
  TransactionDate  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  Remarks          VARCHAR(255) NULL,
  FOREIGN KEY (InventoryID) REFERENCES Inventory(InventoryID),
  FOREIGN KEY (UserID)      REFERENCES User(UserID)
);

CREATE TABLE Transfer (
  TransferID       VARCHAR(20) PRIMARY KEY,             -- TF-001
  FromWarehouseID  VARCHAR(20) NOT NULL,
  ToWarehouseID    VARCHAR(20) NOT NULL,
  UserID           VARCHAR(20) NOT NULL,
  TransferDate     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  Status           VARCHAR(20) NOT NULL,
  Remarks          VARCHAR(255) NULL,
  FOREIGN KEY (FromWarehouseID) REFERENCES Warehouse(WarehouseID),
  FOREIGN KEY (ToWarehouseID)   REFERENCES Warehouse(WarehouseID),
  FOREIGN KEY (UserID)          REFERENCES User(UserID)
);

CREATE TABLE TransferDetail (
  TransferDetailID  VARCHAR(20) PRIMARY KEY,            -- TD-001
  TransferID        VARCHAR(20) NOT NULL,
  ProductID         VARCHAR(20) NOT NULL,
  Quantity          INT NOT NULL CHECK (Quantity > 0),
  FOREIGN KEY (TransferID) REFERENCES Transfer(TransferID),
  FOREIGN KEY (ProductID)  REFERENCES Product(ProductID)
);

CREATE TABLE Customer (
  CustomerID    VARCHAR(20) PRIMARY KEY,                -- CUST-001
  UserID        VARCHAR(20) NULL,
  CustomerType  VARCHAR(20) NOT NULL,                   -- Commercial | Residential
  FirstName     VARCHAR(75) NULL,
  LastName      VARCHAR(75) NULL,
  CompanyName   VARCHAR(150) NULL,
  CustomerName  VARCHAR(150) NOT NULL DEFAULT '',
  ContactNo     VARCHAR(30) NOT NULL,
  Address       VARCHAR(255) NOT NULL,
  Status        VARCHAR(20) NOT NULL DEFAULT 'Active',
  CreatedAt     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UpdatedAt     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT customer_type_valid CHECK (CustomerType IN ('Residential','Commercial')),
  FOREIGN KEY (UserID) REFERENCES User(UserID)
);

CREATE TABLE `Order` (
  historical_customer_id VARCHAR(20) NULL,
  customer_name VARCHAR(150) NULL,
  contact_number VARCHAR(30) NULL,
  address VARCHAR(255) NULL,
  customer_type VARCHAR(20) NULL,
  OrderID      VARCHAR(20) PRIMARY KEY,                 -- ORD-001
  CustomerID   VARCHAR(20) NULL,
  OrderNo      VARCHAR(50) NOT NULL UNIQUE,
  OrderDate    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  OrderType    VARCHAR(20) NOT NULL,                    -- Walk-in, Pickup, Delivery
  OrderStatus  VARCHAR(30) NOT NULL,
  PickupStatus VARCHAR(30) NULL,
  PickupScheduledAt DATETIME NULL,
  PickupSettlementPending TINYINT(1) NOT NULL DEFAULT 0,
  TotalAmount  DECIMAL(12,2) NOT NULL CHECK (TotalAmount >= 0),   -- items + delivery charge
  Remarks      VARCHAR(255) NULL,
  FOREIGN KEY (CustomerID) REFERENCES Customer(CustomerID)
);

CREATE TABLE OrderDetails (
  OrderDetailID  VARCHAR(20) PRIMARY KEY,               -- OD-001
  OrderID        VARCHAR(20) NOT NULL,
  ProductID      VARCHAR(20) NOT NULL,
  Quantity       INT NOT NULL CHECK (Quantity > 0),
  UnitPrice      DECIMAL(12,2) NOT NULL CHECK (UnitPrice >= 0),
  Subtotal       DECIMAL(12,2) NOT NULL CHECK (Subtotal >= 0),
  FOREIGN KEY (OrderID)   REFERENCES `Order`(OrderID),
  FOREIGN KEY (ProductID) REFERENCES Product(ProductID)
);

CREATE TABLE Sales (
  historical_customer_id VARCHAR(20) NULL,
  customer_name VARCHAR(150) NULL,
  contact_number VARCHAR(30) NULL,
  address VARCHAR(255) NULL,
  customer_type VARCHAR(20) NULL,
  SaleID         VARCHAR(20) PRIMARY KEY,               -- S-001
  OrderID        VARCHAR(20) NULL,
  CustomerID     VARCHAR(20) NULL,
  UserID         VARCHAR(20) NOT NULL,
  SaleNo         VARCHAR(50) NOT NULL UNIQUE,
  SaleDate       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  SalesDiscount  DECIMAL(12,2) NOT NULL DEFAULT 0 CHECK (SalesDiscount >= 0),
  TotalAmount    DECIMAL(12,2) NOT NULL CHECK (TotalAmount >= 0), -- Order total - discount (amount payable)
  Remarks        VARCHAR(255) NULL,
  FOREIGN KEY (OrderID)    REFERENCES `Order`(OrderID),
  FOREIGN KEY (CustomerID) REFERENCES Customer(CustomerID),
  FOREIGN KEY (UserID)     REFERENCES User(UserID)
);

CREATE TABLE RestockRecommendation (
  RestockID            VARCHAR(20) PRIMARY KEY,         -- R-001
  ProductID            VARCHAR(20) NOT NULL,
  SupplierID           VARCHAR(20) NOT NULL,
  StockOnHand          INT NOT NULL DEFAULT 0 CHECK (StockOnHand >= 0),
  PredictedDemand      INT NOT NULL CHECK (PredictedDemand >= 0),
  RecommendedQuantity  INT NOT NULL CHECK (RecommendedQuantity >= 0),
  Confidence           DECIMAL(5,2) NULL,
  ForecastDate         DATE NOT NULL,
  Status               VARCHAR(20) NOT NULL,
  CreatedAt            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (ProductID)  REFERENCES Product(ProductID),
  FOREIGN KEY (SupplierID) REFERENCES Supplier(SupplierID)
);

CREATE TABLE PurchaseOrder (
  PurchaseOrderID       VARCHAR(20) PRIMARY KEY,        -- PO-001
  SupplierID            VARCHAR(20) NOT NULL,
  RestockID             VARCHAR(20) NULL,
  CreatedByUserID       VARCHAR(20) NOT NULL,
  PONo                  VARCHAR(50) NOT NULL UNIQUE,
  OrderDate             DATETIME NOT NULL,
  ExpectedDeliveryDate  DATE NULL,
  Status                VARCHAR(30) NOT NULL,
  TotalAmount           DECIMAL(12,2) NOT NULL CHECK (TotalAmount >= 0),
  Remarks               VARCHAR(255) NULL,
  CreatedAt             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (SupplierID)      REFERENCES Supplier(SupplierID),
  FOREIGN KEY (RestockID)       REFERENCES RestockRecommendation(RestockID),
  FOREIGN KEY (CreatedByUserID) REFERENCES User(UserID)
);

CREATE TABLE PurchaseOrderItem (
  PurchaseOrderItemID  VARCHAR(20) PRIMARY KEY,         -- POI-001
  PurchaseOrderID      VARCHAR(20) NOT NULL,
  ProductID            VARCHAR(20) NOT NULL,
  Quantity             INT NOT NULL CHECK (Quantity > 0),
  UnitCost             DECIMAL(12,2) NOT NULL CHECK (UnitCost >= 0),
  Subtotal             DECIMAL(12,2) NOT NULL CHECK (Subtotal >= 0),
  FOREIGN KEY (PurchaseOrderID) REFERENCES PurchaseOrder(PurchaseOrderID),
  FOREIGN KEY (ProductID)       REFERENCES Product(ProductID)
);

CREATE TABLE Payment (
  historical_customer_id VARCHAR(20) NULL,
  customer_name VARCHAR(150) NULL,
  contact_number VARCHAR(30) NULL,
  address VARCHAR(255) NULL,
  customer_type VARCHAR(20) NULL,
  PaymentID        VARCHAR(20) PRIMARY KEY,             -- PAY-001
  PaymentType      VARCHAR(20) NOT NULL,                -- Sale | Purchase
  SaleID           VARCHAR(20) NULL,
  PurchaseOrderID  VARCHAR(20) NULL,
  PaymentMethod    VARCHAR(30) NOT NULL,                -- Cash, Gcash, Card, QRph
  AmountPaid       DECIMAL(12,2) NOT NULL CHECK (AmountPaid > 0),
  PaymentDate      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ReferenceNo      VARCHAR(50) NULL,
  Remarks          VARCHAR(255) NULL,
  FOREIGN KEY (SaleID)          REFERENCES Sales(SaleID),
  FOREIGN KEY (PurchaseOrderID) REFERENCES PurchaseOrder(PurchaseOrderID)
);

CREATE TABLE Delivery (
  historical_customer_id VARCHAR(20) NULL,
  customer_name VARCHAR(150) NULL,
  contact_number VARCHAR(30) NULL,
  address VARCHAR(255) NULL,
  customer_type VARCHAR(20) NULL,
  DeliveryID         VARCHAR(20) PRIMARY KEY,           -- D-001
  SaleID             VARCHAR(20) NOT NULL UNIQUE,
  DRNo               VARCHAR(50) NOT NULL UNIQUE,
  DeliveryDate       DATETIME NULL,
  DeliveredByUserID  VARCHAR(20) NULL,
  DeliveryCharge     DECIMAL(12,2) NOT NULL DEFAULT 0 CHECK (DeliveryCharge >= 0),
  DeliveryAddress    VARCHAR(255) NOT NULL,
  DeliveryStatus     VARCHAR(30) NOT NULL,
  PaymentMethod      VARCHAR(30) NULL,
  AttemptCount       INT UNSIGNED NOT NULL DEFAULT 0,
  NextAttemptAt      DATETIME NULL,
  RestockedAt        DATETIME NULL,
  SettledAt          DATETIME NULL,
  Remarks            VARCHAR(255) NULL,
  FOREIGN KEY (SaleID)            REFERENCES Sales(SaleID),
  FOREIGN KEY (DeliveredByUserID) REFERENCES User(UserID)
);

CREATE TABLE DeliveryAction (
  DeliveryID VARCHAR(20) NOT NULL,
  RequestID VARCHAR(64) NOT NULL,
  RequestHash CHAR(64) NOT NULL,
  UserID VARCHAR(20) NOT NULL,
  Action VARCHAR(30) NOT NULL,
  Details JSON NOT NULL,
  CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (DeliveryID, RequestID),
  FOREIGN KEY (DeliveryID) REFERENCES Delivery(DeliveryID)
);

CREATE TABLE DataActivityLog (
  DataActivityID  VARCHAR(20) PRIMARY KEY,              -- DA-001
  UserID          VARCHAR(20) NOT NULL,
  ActivityType    VARCHAR(30) NOT NULL,                 -- Import, Export, Generate Report
  DataType        VARCHAR(50) NOT NULL,
  FileName        VARCHAR(255) NOT NULL,
  FileFormat      VARCHAR(20) NOT NULL,
  DateFrom        DATE NULL,
  DateTo          DATE NULL,
  Status          VARCHAR(20) NOT NULL,
  ActivityDate    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (UserID) REFERENCES User(UserID)
);

CREATE TABLE UserActivity (
  UserActivityID  VARCHAR(20) PRIMARY KEY,              -- UA-001
  UserID          VARCHAR(20) NOT NULL,
  ActivityType    VARCHAR(30) NOT NULL,                 -- Login, Create, Update, Delete, Approve
  Module          VARCHAR(50) NOT NULL,
  RecordID        VARCHAR(20) NULL,
  Description     VARCHAR(500) NULL,
  ActivityDate    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (UserID) REFERENCES User(UserID)
);

CREATE TABLE CompanySettings (
  CompanyID          VARCHAR(20) PRIMARY KEY,
  FullName           VARCHAR(150) NULL,
  Address            VARCHAR(255) NULL,
  ContactEmail       VARCHAR(150) NULL,
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
  AllowIssueRefund TINYINT(1) NOT NULL DEFAULT 0,
  EnableCancellationFee TINYINT(1) NOT NULL DEFAULT 0,
  CancellationFeeType VARCHAR(10) NOT NULL DEFAULT 'Fixed',
  CancellationFeeValue DECIMAL(12,2) NOT NULL DEFAULT 0,
  TaxRate            DECIMAL(5,2) NOT NULL DEFAULT 12.00,
  TaxEnabled         TINYINT(1) NOT NULL DEFAULT 1,
  Currency           VARCHAR(10) NOT NULL DEFAULT 'PHP',
  RoundUp            TINYINT(1) NOT NULL DEFAULT 0,
  RoundDown          TINYINT(1) NOT NULL DEFAULT 0,
  TwoDecimalStandard TINYINT(1) NOT NULL DEFAULT 1,
  ReceiptHeader      TEXT NULL,
  ShowLogoOnReceipt  TINYINT(1) NOT NULL DEFAULT 1,
  ShowTaxBreakdown   TINYINT(1) NOT NULL DEFAULT 1,
  FooterMessage      VARCHAR(255) NULL,
  PrintSize          VARCHAR(10) NOT NULL DEFAULT '80mm',
  AutoLogoutMinutes  INT NOT NULL DEFAULT 30,
  SystemTimezone     VARCHAR(50) NOT NULL DEFAULT 'Asia/Manila',
  DateFormat         VARCHAR(20) NOT NULL DEFAULT 'MM/DD/YYYY',
  Language           VARCHAR(10) NOT NULL DEFAULT 'en',
  Theme              VARCHAR(10) NOT NULL DEFAULT 'light',
  UpdatedAt          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (CompanyID) REFERENCES Company(CompanyID)
);

CREATE TABLE IF NOT EXISTS RefundLedger (
 RefundID BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 CompanyID VARCHAR(20) NOT NULL,
 OrderID VARCHAR(20) NOT NULL,
 UserID VARCHAR(20) NOT NULL,
 Reason VARCHAR(30) NOT NULL,
 EligibleAmount DECIMAL(12,2) NOT NULL,
 FeeType VARCHAR(10) NOT NULL,
 FeeValue DECIMAL(12,2) NOT NULL,
 CancellationFee DECIMAL(12,2) NOT NULL,
 RefundAmount DECIMAL(12,2) NOT NULL,
 CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY OneRefundPerOrder (OrderID),
 FOREIGN KEY (CompanyID) REFERENCES Company(CompanyID),
 FOREIGN KEY (UserID) REFERENCES User(UserID),
 CHECK (EligibleAmount > 0 AND CancellationFee >= 0 AND CancellationFee <= EligibleAmount),
 CHECK (RefundAmount = EligibleAmount - CancellationFee)
);

CREATE TABLE IF NOT EXISTS PickupSettlement (
  OrderID VARCHAR(20) PRIMARY KEY,
  CompanyID VARCHAR(20) NOT NULL,
  OrderNo VARCHAR(50) NOT NULL,
  UserID VARCHAR(20) NOT NULL,
  ResolvedStatus VARCHAR(30) NOT NULL,
  OriginalPaidAmount DECIMAL(12,2) NOT NULL,
  CancellationFee DECIMAL(12,2) NOT NULL,
  NetRefundAmount DECIMAL(12,2) NOT NULL,
  FeeEnabled TINYINT(1) NOT NULL,
  FeeType VARCHAR(10) NOT NULL,
  FeeValue DECIMAL(12,2) NOT NULL,
  RefundMethod VARCHAR(20) NOT NULL,
  AccountName VARCHAR(150) NOT NULL,
  AccountNumber VARCHAR(34) NOT NULL,
  PayoutReferenceNo VARCHAR(50) NULL,
  CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (OrderID) REFERENCES `Order`(OrderID),
  FOREIGN KEY (CompanyID) REFERENCES Company(CompanyID),
  FOREIGN KEY (UserID) REFERENCES User(UserID),
  CHECK (ResolvedStatus IN ('Unclaimed','Cancelled')),
  CHECK (OriginalPaidAmount > 0 AND CancellationFee >= 0 AND CancellationFee <= OriginalPaidAmount),
  CHECK (NetRefundAmount = OriginalPaidAmount - CancellationFee),
  CHECK (RefundMethod IN ('GCash','Card','Bank Transfer'))
);

CREATE TABLE IF NOT EXISTS PickupClaim (
  OrderID VARCHAR(20) PRIMARY KEY,
  SaleID VARCHAR(20) NOT NULL UNIQUE,
  UserID VARCHAR(20) NOT NULL,
  WarehouseID VARCHAR(20) NULL,
  EmptyCylinderReturned TINYINT(1) NOT NULL,
  ReturnReferenceNo VARCHAR(50) NULL,
  RequestHash CHAR(64) NOT NULL,
  CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (OrderID) REFERENCES `Order`(OrderID),
  FOREIGN KEY (SaleID) REFERENCES Sales(SaleID),
  FOREIGN KEY (UserID) REFERENCES User(UserID),
  FOREIGN KEY (WarehouseID) REFERENCES Warehouse(WarehouseID)
);

SET FOREIGN_KEY_CHECKS = 1;



-- Capture customer details once, including POS and imported transactions.
DELIMITER $$
CREATE TRIGGER customer_snapshot_order BEFORE INSERT ON `Order` FOR EACH ROW BEGIN
  SET NEW.historical_customer_id=COALESCE(NEW.historical_customer_id,(SELECT CustomerID FROM Customer WHERE CustomerID=NEW.CustomerID));
  SET NEW.customer_name=COALESCE(NEW.customer_name,(SELECT CustomerName FROM Customer WHERE CustomerID=NEW.CustomerID));
  SET NEW.contact_number=COALESCE(NEW.contact_number,(SELECT ContactNo FROM Customer WHERE CustomerID=NEW.CustomerID));
  SET NEW.address=COALESCE(NEW.address,(SELECT Address FROM Customer WHERE CustomerID=NEW.CustomerID));
  SET NEW.customer_type=COALESCE(NEW.customer_type,(SELECT CustomerType FROM Customer WHERE CustomerID=NEW.CustomerID));
END$$
CREATE TRIGGER customer_snapshot_sales BEFORE INSERT ON `Sales` FOR EACH ROW BEGIN
  SET NEW.historical_customer_id=COALESCE(NEW.historical_customer_id,(SELECT historical_customer_id FROM `Order` WHERE OrderID=NEW.OrderID));
  SET NEW.customer_name=COALESCE(NEW.customer_name,(SELECT customer_name FROM `Order` WHERE OrderID=NEW.OrderID));
  SET NEW.contact_number=COALESCE(NEW.contact_number,(SELECT contact_number FROM `Order` WHERE OrderID=NEW.OrderID));
  SET NEW.address=COALESCE(NEW.address,(SELECT address FROM `Order` WHERE OrderID=NEW.OrderID));
  SET NEW.customer_type=COALESCE(NEW.customer_type,(SELECT customer_type FROM `Order` WHERE OrderID=NEW.OrderID));
  SET NEW.historical_customer_id=COALESCE(NEW.historical_customer_id,(SELECT CustomerID FROM Customer WHERE CustomerID=NEW.CustomerID));
  SET NEW.customer_name=COALESCE(NEW.customer_name,(SELECT CustomerName FROM Customer WHERE CustomerID=NEW.CustomerID));
  SET NEW.contact_number=COALESCE(NEW.contact_number,(SELECT ContactNo FROM Customer WHERE CustomerID=NEW.CustomerID));
  SET NEW.address=COALESCE(NEW.address,(SELECT Address FROM Customer WHERE CustomerID=NEW.CustomerID));
  SET NEW.customer_type=COALESCE(NEW.customer_type,(SELECT CustomerType FROM Customer WHERE CustomerID=NEW.CustomerID));
END$$
CREATE TRIGGER customer_snapshot_payment BEFORE INSERT ON `Payment` FOR EACH ROW BEGIN
  SET NEW.historical_customer_id=COALESCE(NEW.historical_customer_id,(SELECT historical_customer_id FROM Sales WHERE SaleID=NEW.SaleID));
  SET NEW.customer_name=COALESCE(NEW.customer_name,(SELECT customer_name FROM Sales WHERE SaleID=NEW.SaleID));
  SET NEW.contact_number=COALESCE(NEW.contact_number,(SELECT contact_number FROM Sales WHERE SaleID=NEW.SaleID));
  SET NEW.address=COALESCE(NEW.address,(SELECT address FROM Sales WHERE SaleID=NEW.SaleID));
  SET NEW.customer_type=COALESCE(NEW.customer_type,(SELECT customer_type FROM Sales WHERE SaleID=NEW.SaleID));
END$$
CREATE TRIGGER customer_snapshot_delivery BEFORE INSERT ON `Delivery` FOR EACH ROW BEGIN
  SET NEW.historical_customer_id=COALESCE(NEW.historical_customer_id,(SELECT historical_customer_id FROM Sales WHERE SaleID=NEW.SaleID));
  SET NEW.customer_name=COALESCE(NEW.customer_name,(SELECT customer_name FROM Sales WHERE SaleID=NEW.SaleID));
  SET NEW.contact_number=COALESCE(NEW.contact_number,(SELECT contact_number FROM Sales WHERE SaleID=NEW.SaleID));
  SET NEW.address=COALESCE(NEW.address,(SELECT address FROM Sales WHERE SaleID=NEW.SaleID));
  SET NEW.customer_type=COALESCE(NEW.customer_type,(SELECT customer_type FROM Sales WHERE SaleID=NEW.SaleID));
END$$
DELIMITER ;
