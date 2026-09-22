-- No settings table exists in the original schema. One row per company holds
-- everything the Settings page edits.
CREATE TABLE IF NOT EXISTS CompanySettings (
  CompanyID INT PRIMARY KEY,
  FullName VARCHAR(150) NULL,
  Address VARCHAR(255) NULL,
  ContactEmail VARCHAR(150) NULL,
  Phone VARCHAR(30) NULL,
  LogoDataUrl LONGTEXT NULL, -- base64 data: URL, simplest option without a file storage service

  TaxRate DECIMAL(5,2) NOT NULL DEFAULT 12.00,
  TaxEnabled TINYINT(1) NOT NULL DEFAULT 1,
  Currency VARCHAR(10) NOT NULL DEFAULT 'PHP',
  RoundUp TINYINT(1) NOT NULL DEFAULT 0,
  RoundDown TINYINT(1) NOT NULL DEFAULT 0,
  TwoDecimalStandard TINYINT(1) NOT NULL DEFAULT 1,

  ReceiptHeader VARCHAR(150) NULL,
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
);