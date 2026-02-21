-- Enrich extraction_log observability fields for extraction strategy and targeted repairs.
ALTER TABLE extraction_log
  ADD COLUMN IF NOT EXISTS token_estimate integer,
  ADD COLUMN IF NOT EXISTS strategy text,
  ADD COLUMN IF NOT EXISTS api_calls integer,
  ADD COLUMN IF NOT EXISTS repair_mode text,
  ADD COLUMN IF NOT EXISTS repair_targets_count integer;

CREATE INDEX IF NOT EXISTS idx_extraction_log_strategy_created
  ON extraction_log(strategy, created_at DESC);

COMMENT ON COLUMN extraction_log.strategy IS 'Extraction strategy used by edge function (single, chunked-N, repair-focused, etc.).';
COMMENT ON COLUMN extraction_log.api_calls IS 'Number of Gemini calls used for this extraction request.';
COMMENT ON COLUMN extraction_log.repair_mode IS 'Repair mode for this call: targeted or none.';
COMMENT ON COLUMN extraction_log.repair_targets_count IS 'Number of explicitly targeted subtests for repair calls.';
