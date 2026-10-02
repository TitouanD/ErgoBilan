-- =============================================================================
-- Migration: Charlop-Atwell subtests normalization
-- Date: 2026-03-24
-- Source basis: documentation Charlop-Atwell (scores objectif, subjectif, total)
-- Scope:
--   1) Normaliser les 3 scores principaux affiches
--   2) Uniformiser abreviations et ordre d'affichage
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
    'charlop-atwell__score-objectif',
    'charlop-atwell',
    'Score objectif',
    'OBJ',
    'none',
    'NONE',
    'numeric_4mode',
    'auto',
    jsonb_build_object(
      'groupKey', 'charlop_01_scores',
      'groupHeaderLabel', 'Scores Charlop-Atwell',
      'groupOrder', 1,
      'orderIndex', 1
    ),
    1,
    1,
    null
  ),
  (
    'charlop-atwell__score-subjectif',
    'charlop-atwell',
    'Score subjectif',
    'SUBJ',
    'none',
    'NONE',
    'numeric_4mode',
    'auto',
    jsonb_build_object(
      'groupKey', 'charlop_01_scores',
      'groupHeaderLabel', 'Scores Charlop-Atwell',
      'groupOrder', 1,
      'orderIndex', 2
    ),
    1,
    2,
    null
  ),
  (
    'charlop-atwell__score-total',
    'charlop-atwell',
    'Score total',
    'TOTAL',
    'none',
    'NONE',
    'numeric_4mode',
    'auto',
    jsonb_build_object(
      'groupKey', 'charlop_01_scores',
      'groupHeaderLabel', 'Scores Charlop-Atwell',
      'groupOrder', 1,
      'orderIndex', 3
    ),
    1,
    3,
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
