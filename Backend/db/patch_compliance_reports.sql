-- No compliance/reporting table exists in the original schema. This adds one
-- to track recurring/ad-hoc compliance reports, their due dates, and submission status.
CREATE TABLE IF NOT EXISTS ComplianceReport (
  ReportID INT AUTO_INCREMENT PRIMARY KEY,
  ReportName VARCHAR(150) NOT NULL,
  ReportType VARCHAR(50) NOT NULL, -- e.g. 'Sales Summary', 'Inventory Audit', 'Tax Filing'
  PeriodLabel VARCHAR(50) NOT NULL, -- e.g. 'June 2026'
  PeriodStart DATE NOT NULL,
  PeriodEnd DATE NOT NULL,
  DueDate DATE NOT NULL,
  Status VARCHAR(20) NOT NULL DEFAULT 'Upcoming', -- Upcoming | Due Soon | Overdue | Submitted
  SubmittedAt DATETIME NULL,
  SubmittedByUserID INT NULL,
  FileName VARCHAR(255) NULL,
  CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (SubmittedByUserID) REFERENCES User(UserID)
);