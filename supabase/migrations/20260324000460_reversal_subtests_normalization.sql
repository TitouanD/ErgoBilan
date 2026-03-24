-- =============================================================================
-- Migration: Reversal Test subtests normalization
-- Date: 2026-03-24
-- Source basis: Reversal test scoring (reponses correctes et inversions/erreurs)
-- Scope:
--   1) Conserver les 2 scores principaux
--   2) Normaliser libelles FR et abreviations
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
    'reversal__nombre-de-r-ponses-correctes',
    'reversal',
    'Nombre de réponses correctes',
    'CORR',
    'none',
    'NONE',
    'numeric_4mode',
    'auto',
    jsonb_build_object(
      'groupKey', 'reversal_01_scores',
      'groupHeaderLabel', 'Scores Reversal Test',
      'groupOrder', 1,
      'orderIndex', 1
    ),
    1,
    1,
    null
  ),
  (
    'reversal__nombre-d-inversions',
    'reversal',
    'Nombre d’inversions',
    'INV',
    'none',
    'NONE',
    'numeric_4mode',
    'auto',
    jsonb_build_object(
      'groupKey', 'reversal_01_scores',
      'groupHeaderLabel', 'Scores Reversal Test',
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