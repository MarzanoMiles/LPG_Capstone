-- The original schema's User table has no branch/warehouse assignment and no
-- module-access tracking, both of which the Users UI needs.
ALTER TABLE User
  ADD COLUMN WarehouseID INT NULL AFTER RoleID,
  ADD COLUMN ModuleAccess JSON NULL AFTER Status,
  ADD CONSTRAINT fk_user_warehouse FOREIGN KEY (WarehouseID) REFERENCES Warehouse(WarehouseID);