-- =============================================================================
-- Migration: Fix Beery VMI score_type, computation_mode and raw_direction
-- Date: 2026-03-28
-- Problem:
--   Migration 20260324000410 forced score_type='none', computation_mode='NONE'
--   via ON CONFLICT DO UPDATE, overwriting the correct classification that was
--   set when the 2 774 norms were imported. The norms store standard_score
--   (45-155) + percentile which is unambiguously a LOOKUP/standard table.
-- Fix:
--   Restore the correct classification so compute_score RPC can serve norms.
-- =============================================================================

UPDATE public.official_subtests
SET
  score_type       = 'standard',
  computation_mode = 'LOOKUP',
  raw_direction    = 'higher_better'
WHERE id IN (
  'beery-vmi__vmi',
  'beery-vmi__visual-perception',
  'beery-vmi__motor-coordination'
);
