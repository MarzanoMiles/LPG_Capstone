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
