-- =============================================================================
-- Migration : Align score_type=none with computation_mode=NONE
-- Date : 2026-03-18
-- Scope : COPM, QuickDASH
-- =============================================================================

UPDATE public.official_subtests
SET computation_mode = 'NONE'
WHERE score_type = 'none'
  AND computation_mode <> 'NONE'
  AND test_id IN ('copm', 'quick-dash');
