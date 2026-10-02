-- =============================================================================
-- Migration: AMPS French subtests normalization
-- Date: 2026-03-24
-- Source basis: AMPS structure (2 scales: Motor, Process)
-- Scope:
--   1) Keep canonical 2 AMPS scales
--   2) Normalize French display labels, abbreviations, and ordering metadata
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
    'amps__adl-motor',
    'amps',
    'Habiletés motrices (ADL Motor)',
    'MOT',
    'none',
    'NONE',
    'numeric_4mode',
    'auto',
    jsonb_build_object(
      'groupKey', 'amps_01_scores',
      'groupHeaderLabel', 'Scores AMPS',
      'groupOrder', 1,
      'orderIndex', 1
    ),
    1,
    1,
    null
  ),
  (
    'amps__adl-process',
    'amps',
    'Habiletés opératoires (ADL Process)',
    'PRO',
    'none',
    'NONE',
    'numeric_4mode',
    'auto',
    jsonb_build_object(
      'groupKey', 'amps_01_scores',
      'groupHeaderLabel', 'Scores AMPS',
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
