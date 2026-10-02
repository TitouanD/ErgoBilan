-- =============================================================================
-- Migration: COPM subtests normalization
-- Date: 2026-03-24
-- Source basis: COPM structure (Performance, Satisfaction)
-- Scope:
--   1) Keep canonical two COPM scores
--   2) Normalize French labels, abbreviations, and ordering metadata
-- =============================================================================

begin;
insert into public.official_subtests (
  id,
  test_id,
  name,
  abbreviation,
  score_type,
  computation_mode,
  input_model,
  raw_direction,
  input_config,
  display_group_order,
  display_order,
  organization_id
)
values
  (
    'copm__performance',
    'copm',
    'Performance perçue (moy. 1-10)',
    'PERF',
    'none',
    'NONE',
    'numeric_4mode',
    'auto',
    jsonb_build_object(
      'groupKey', 'copm_01_scores',
      'groupHeaderLabel', 'Scores COPM',
      'groupOrder', 1,
      'orderIndex', 1
    ),
    1,
    1,
    null
  ),
  (
    'copm__satisfaction',
    'copm',
    'Satisfaction perçue (moy. 1-10)',
    'SAT',
    'none',
    'NONE',
    'numeric_4mode',
    'auto',
    jsonb_build_object(
      'groupKey', 'copm_01_scores',
      'groupHeaderLabel', 'Scores COPM',
      'groupOrder', 1,
      'orderIndex', 2
    ),
    1,
    2,
    null
  )
on conflict (id) do update
set
  test_id = excluded.test_id,
  name = excluded.name,
  abbreviation = excluded.abbreviation,
  score_type = excluded.score_type,
  computation_mode = excluded.computation_mode,
  input_model = excluded.input_model,
  raw_direction = excluded.raw_direction,
  input_config = excluded.input_config,
  display_group_order = excluded.display_group_order,
  display_order = excluded.display_order,
  organization_id = excluded.organization_id;
commit;
