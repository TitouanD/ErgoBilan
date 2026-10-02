-- =============================================================================
-- Migration: QuickDASH subtests normalization
-- Date: 2026-03-24
-- Source basis: QuickDASH scoring (score principal + 2 modules optionnels)
-- Scope:
--   1) Conserver les 3 composantes canoniques
--   2) Normaliser labels FR, abreviations et ordre d'affichage
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
    'quick-dash__total',
    'quick-dash',
    'Score global QuickDASH',
    'QD',
    'none',
    'NONE',
    'numeric_4mode',
    'auto',
    jsonb_build_object(
      'groupKey', 'quickdash_01_scores',
      'groupHeaderLabel', 'Scores QuickDASH',
      'groupOrder', 1,
      'orderIndex', 1
    ),
    1,
    1,
    null
  ),
  (
    'quick-dash__work-module',
    'quick-dash',
    'Module Travail (optionnel)',
    'TRAV',
    'none',
    'NONE',
    'numeric_4mode',
    'auto',
    jsonb_build_object(
      'groupKey', 'quickdash_01_scores',
      'groupHeaderLabel', 'Scores QuickDASH',
      'groupOrder', 1,
      'orderIndex', 2
    ),
    1,
    2,
    null
  ),
  (
    'quick-dash__sport-module',
    'quick-dash',
    'Module Sport/Arts performants (optionnel)',
    'SPORT',
    'none',
    'NONE',
    'numeric_4mode',
    'auto',
    jsonb_build_object(
      'groupKey', 'quickdash_01_scores',
      'groupHeaderLabel', 'Scores QuickDASH',
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
