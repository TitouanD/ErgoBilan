-- =============================================================================
-- Migration: Test des Cloches subtests completion
-- Date: 2026-03-24
-- Source basis: cotation clinique Test des Cloches (cibles, temps, omissions)
-- Scope:
--   1) Conserver le score de cibles detectees
--   2) Ajouter les dimensions de cotation usuelles (temps + omissions hemi-champ)
--   3) Normaliser labels FR, abreviations et ordre
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
    'test-cloches__cibles',
    'test-cloches',
    'Nombre de cloches reperees (/35)',
    'CIB',
    'none',
    'NONE',
    'numeric_4mode',
    'auto',
    jsonb_build_object(
      'groupKey', 'cloches_01_scores',
      'groupHeaderLabel', 'Scores Test des Cloches',
      'groupOrder', 1,
      'orderIndex', 1
    ),
    1,
    1,
    null
  ),
  (
    'test-cloches__temps-total-secondes',
    'test-cloches',
    'Temps total (secondes)',
    'TSEC',
    'none',
    'NONE',
    'numeric_4mode',
    'auto',
    jsonb_build_object(
      'groupKey', 'cloches_01_scores',
      'groupHeaderLabel', 'Scores Test des Cloches',
      'groupOrder', 1,
      'orderIndex', 2
    ),
    1,
    2,
    null
  ),
  (
    'test-cloches__omissions-gauche',
    'test-cloches',
    'Omissions hémichamp gauche',
    'OMG',
    'none',
    'NONE',
    'numeric_4mode',
    'auto',
    jsonb_build_object(
      'groupKey', 'cloches_01_scores',
      'groupHeaderLabel', 'Scores Test des Cloches',
      'groupOrder', 1,
      'orderIndex', 3
    ),
    1,
    3,
    null
  ),
  (
    'test-cloches__omissions-droite',
    'test-cloches',
    'Omissions hémichamp droit',
    'OMD',
    'none',
    'NONE',
    'numeric_4mode',
    'auto',
    jsonb_build_object(
      'groupKey', 'cloches_01_scores',
      'groupHeaderLabel', 'Scores Test des Cloches',
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
