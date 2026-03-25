-- =============================================================================
-- Migration: DCDQ-FE subscales completion (official French-European form)
-- Date: 2026-03-24
-- Source basis: DCDQ-FE administration/scoring sheet (version fr-Europe)
-- Scope:
--   1) Keep existing total score entry
--   2) Add the 3 official category scores if missing
--   3) Normalize French labels, abbreviations, and deterministic ordering
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
    'dcdq-f__controle-durant-mouvement',
    'dcdq-f',
    'Contrôle durant le mouvement',
    'CDM',
    'none',
    'NONE',
    'numeric_4mode',
    'auto',
    jsonb_build_object(
      'groupKey', 'dcdqfe_01_scores',
      'groupHeaderLabel', 'Scores DCDQ-FE',
      'groupOrder', 1,
      'orderIndex', 1
    ),
    1,
    1,
    null
  ),
  (
    'dcdq-f__motricite-fine-ecriture',
    'dcdq-f',
    'Motricité fine / Écriture',
    'MFE',
    'none',
    'NONE',
    'numeric_4mode',
    'auto',
    jsonb_build_object(
      'groupKey', 'dcdqfe_01_scores',
      'groupHeaderLabel', 'Scores DCDQ-FE',
      'groupOrder', 1,
      'orderIndex', 2
    ),
    1,
    2,
    null
  ),
  (
    'dcdq-f__coordination-globale',
    'dcdq-f',
    'Coordination globale',
    'CG',
    'none',
    'NONE',
    'numeric_4mode',
    'auto',
    jsonb_build_object(
      'groupKey', 'dcdqfe_01_scores',
      'groupHeaderLabel', 'Scores DCDQ-FE',
      'groupOrder', 1,
      'orderIndex', 3
    ),
    1,
    3,
    null
  ),
  (
    'dcdq-f__total',
    'dcdq-f',
    'Score total',
    'TOTAL',
    'none',
    'NONE',
    'numeric_4mode',
    'auto',
    jsonb_build_object(
      'groupKey', 'dcdqfe_01_scores',
      'groupHeaderLabel', 'Scores DCDQ-FE',
      'groupOrder', 1,
      'orderIndex', 4
    ),
    1,
    4,
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