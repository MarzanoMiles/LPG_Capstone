-- Existing installations: add product weight/size independently of Unit.
SET @unit_value_ddl = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND LOWER(TABLE_NAME) = 'product' AND COLUMN_NAME = 'UnitValue') = 0,
  'ALTER TABLE Product ADD COLUMN UnitValue VARCHAR(50) NULL AFTER Unit',
  'SELECT 1'
);
PREPARE unit_value_statement FROM @unit_value_ddl;
EXECUTE unit_value_statement;
DEALLOCATE PREPARE unit_value_statement;

-- Populate recognizable existing weights without replacing saved values.
UPDATE Product
SET UnitValue = REGEXP_SUBSTR(REGEXP_SUBSTR(ProductName, '[0-9]+([.][0-9]+)?[ ]*[kK][gG]'), '[0-9]+([.][0-9]+)?')
WHERE (UnitValue IS NULL OR UnitValue = '')
  AND ProductName REGEXP '[0-9]+([.][0-9]+)?[ ]*[kK][gG]';
