-- Run once against an existing database before deploying the updated Settings API.
ALTER TABLE CompanySettings
  ADD COLUMN BusinessDays VARCHAR(100) NOT NULL DEFAULT 'Monday,Tuesday,Wednesday,Thursday,Friday,Saturday',
  ADD COLUMN OpeningTime TIME NOT NULL DEFAULT '08:00:00',
  ADD COLUMN ClosingTime TIME NOT NULL DEFAULT '17:00:00',
  ADD COLUMN PickupExpirationDays INT UNSIGNED NOT NULL DEFAULT 3,
  ADD COLUMN MaxDeliveryAttempts INT UNSIGNED NOT NULL DEFAULT 3;
