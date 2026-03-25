-- Add metadata JSONB column to extraction_log for confidence calibration data
ALTER TABLE extraction_log
  ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT NULL;

COMMENT ON COLUMN extraction_log.metadata IS 'Calibration data: confidence_score, verified, inventory_column_count, missing_columns_count, uncertainty_flags';
