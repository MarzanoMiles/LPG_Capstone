ALTER TABLE RestockRecommendation
  ADD COLUMN Confidence DECIMAL(5,2) NULL AFTER RecommendedQuantity;