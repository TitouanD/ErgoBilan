-- =============================================================================
-- Migration: BHK subtests normalization
-- Date: 2026-03-24
-- Source basis: BHK (2 composantes: qualite, vitesse)
-- Scope:
--   1) Conserver les 2 composantes canoniques
--   2) Normaliser abreviations et ordre d'affichage
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
    'bhk__quality',
    'bhk',
    'Qualité',
    'QLT',
    'none',
    'NONE',
    'numeric_4mode',
    'auto',
    jsonb_build_object(
      'groupKey', 'bhk_01_scores',
      'groupHeaderLabel', 'Scores BHK',
      'groupOrder', 1,
      'orderIndex', 1
    ),
    1,
    1,
    null
  ),
  (
    'bhk__speed',
    'bhk',
    'Vitesse',
    'VIT',
    'none',
    'NONE',
    'numeric_4mode',
    'auto',
    jsonb_build_object(
      'groupKey', 'bhk_01_scores',
      'groupHeaderLabel', 'Scores BHK',
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