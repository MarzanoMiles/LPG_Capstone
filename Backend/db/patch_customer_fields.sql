-- The original schema.sql's Customer table has no name field and no UpdatedAt
-- timestamp, both of which the Order & Delivery UI needs. This patch adds them.
ALTER TABLE Customer
  ADD COLUMN CustomerName VARCHAR(150) NOT NULL DEFAULT '' AFTER CustomerType,
  ADD COLUMN UpdatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER CreatedAt;