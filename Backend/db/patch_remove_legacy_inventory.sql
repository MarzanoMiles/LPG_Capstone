-- Apply to gastrack after taking a database backup.
-- Removes the six legacy products' stock and linked inventory transactions.
-- Product and sales records remain; inactive products are not auto-restocked.
-- Run while the app is stopped. Safe to reapply.
USE gastrack;
START TRANSACTION;

UPDATE Product SET Status = 'Inactive'
WHERE ProductID IN ('P-001', 'P-002', 'P-003', 'P-004', 'P-005', 'P-006');

DELETE t FROM InventoryTransaction t
JOIN Inventory i ON i.InventoryID = t.InventoryID
WHERE i.ProductID IN ('P-001', 'P-002', 'P-003', 'P-004', 'P-005', 'P-006');

DELETE FROM Inventory
WHERE ProductID IN ('P-001', 'P-002', 'P-003', 'P-004', 'P-005', 'P-006');

COMMIT;
