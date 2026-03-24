-- =============================================================================
-- Migration: Barrage des H subtests normalization
-- Date: 2026-03-24
-- Source basis: Barrage des H (cibles et temps)
-- Scope:
--   1) Conserver les 2 dimensions canoniques
--   2) Normaliser libelles FR, abreviations et ordre
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
    'barrage-h__cibles',
    'barrage-h',
    'Nombre de cibles barrées',
    'CIB',
    'none',
    'NONE',
    'numeric_4mode',
    'auto',
    jsonb_build_object(
      'groupKey', 'barrageh_01_scores',
      'groupHeaderLabel', 'Scores Barrage des H',
      'groupOrder', 1,
      'orderIndex', 1
    ),
    1,
    1,
    null
  ),
  (
    'barrage-h__temps',
    'barrage-h',
    'Temps total (secondes)',
    'TSEC',
    'none',
    'NONE',
    'numeric_4mode',
    'auto',
    jsonb_build_object(
      'groupKey', 'barrageh_01_scores',
      'groupHeaderLabel', 'Scores Barrage des H',
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