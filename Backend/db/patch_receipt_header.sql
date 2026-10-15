-- Allow the complete multiline receipt header. Run once on existing databases.
ALTER TABLE CompanySettings MODIFY COLUMN ReceiptHeader TEXT NULL;
