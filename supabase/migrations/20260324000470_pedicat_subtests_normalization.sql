-- =============================================================================
-- Migration: PEDI-CAT subtests normalization
-- Date: 2026-03-24
-- Source basis: PEDI-CAT (4 domaines: daily activities, mobility, social/cognitive, responsibility)
-- Scope:
--   1) Conserver les 4 domaines canoniques
--   2) Normaliser labels FR d'affichage et abreviations
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
    'pedi-cat__daily-activities',
    'pedi-cat',
    'Activités quotidiennes (Daily Activities)',
    'AQ',
    'none',
    'NONE',
    'numeric_4mode',
    'auto',
    jsonb_build_object(
      'groupKey', 'pedicat_01_domains',
      'groupHeaderLabel', 'Domaines PEDI-CAT',
      'groupOrder', 1,
      'orderIndex', 1
    ),
    1,
    1,
    null
  ),
  (
    'pedi-cat__mobility',
    'pedi-cat',
    'Mobilité (Mobility)',
    'MOB',
    'none',
    'NONE',
    'numeric_4mode',
    'auto',
    jsonb_build_object(
      'groupKey', 'pedicat_01_domains',
      'groupHeaderLabel', 'Domaines PEDI-CAT',
      'groupOrder', 1,
      'orderIndex', 2
    ),
    1,
    2,
    null
  ),
  (
    'pedi-cat__social-cognitive',
    'pedi-cat',
    'Social/Cognitif (Social/Cognitive)',
    'SOC',
    'none',
    'NONE',
    'numeric_4mode',
    'auto',
    jsonb_build_object(
      'groupKey', 'pedicat_01_domains',
      'groupHeaderLabel', 'Domaines PEDI-CAT',
      'groupOrder', 1,
      'orderIndex', 3
    ),
    1,
    3,
    null
  ),
  (
    'pedi-cat__responsibility',
    'pedi-cat',
    'Responsabilités (Responsibility)',
    'RESP',
    'none',
    'NONE',
    'numeric_4mode',
    'auto',
    jsonb_build_object(
      'groupKey', 'pedicat_01_domains',
      'groupHeaderLabel', 'Domaines PEDI-CAT',
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