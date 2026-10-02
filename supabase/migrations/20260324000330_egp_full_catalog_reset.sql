-- =============================================================================
-- Migration: EGP full canonical catalog reset (official-source baseline)
-- Date: 2026-03-24
-- Source basis: Hogrefe EGP (Examen Geronto-Psychomoteur), 17 items
-- Scope:
--   1) Reset EGP subtests without norms
--   2) Recreate canonical list of 17 items
--   3) Enforce deterministic ordering and non-null abbreviations
-- Notes:
--   - Catalog-only phase: score_type=none, computation_mode=NONE.
-- =============================================================================

begin;
with canonical(
  id,
  test_id,
  name,
  abbreviation,
  group_key,
  group_label,
  group_order,
  order_index
) as (
  values
    ('egp__equilibre-statique', 'egp', 'Équilibre statique', 'EQS', 'egp_01_items', 'Items EGP', 1, 1),
    ('egp__equilibre-dynamique', 'egp', 'Équilibre dynamique', 'EQD', 'egp_01_items', 'Items EGP', 1, 2),
    ('egp__mobilisations-articulaires-ms', 'egp', 'Mobilisations articulaires membres supérieurs', 'MAMS', 'egp_01_items', 'Items EGP', 1, 3),
    ('egp__mobilisations-articulaires-mi', 'egp', 'Mobilisations articulaires membres inférieurs', 'MAMI', 'egp_01_items', 'Items EGP', 1, 4),
    ('egp__praxies', 'egp', 'Praxies', 'PRX', 'egp_01_items', 'Items EGP', 1, 5),
    ('egp__motricite-fine-ms', 'egp', 'Motricité fine membres supérieurs', 'MFMS', 'egp_01_items', 'Items EGP', 1, 6),
    ('egp__motricite-fine-mi', 'egp', 'Motricité fine membres inférieurs', 'MFMI', 'egp_01_items', 'Items EGP', 1, 7),
    ('egp__connaissance-parties-corps', 'egp', 'Connaissance des parties du corps', 'CPC', 'egp_01_items', 'Items EGP', 1, 8),
    ('egp__vigilance', 'egp', 'Vigilance', 'VIG', 'egp_01_items', 'Items EGP', 1, 9),
    ('egp__perceptions', 'egp', 'Perceptions', 'PER', 'egp_01_items', 'Items EGP', 1, 10),
    ('egp__memoire-verbale', 'egp', 'Mémoire verbale', 'MEV', 'egp_01_items', 'Items EGP', 1, 11),
    ('egp__memoire-perceptive', 'egp', 'Mémoire perceptive', 'MEP', 'egp_01_items', 'Items EGP', 1, 12),
    ('egp__sphere-spatiale', 'egp', 'Sphère spatiale', 'SSP', 'egp_01_items', 'Items EGP', 1, 13),
    ('egp__sphere-temporelle', 'egp', 'Sphère temporelle', 'STE', 'egp_01_items', 'Items EGP', 1, 14),
    ('egp__communication-verbale', 'egp', 'Communication verbale', 'COV', 'egp_01_items', 'Items EGP', 1, 15),
    ('egp__communication-non-verbale', 'egp', 'Communication non verbale', 'CONV', 'egp_01_items', 'Items EGP', 1, 16),
    ('egp__score-global', 'egp', 'Score global', 'SG', 'egp_01_items', 'Items EGP', 1, 17)
),
purged as (
  delete from public.official_subtests s
  where s.test_id = 'egp'
    and not exists (
      select 1
      from public.official_norms n
      where n.subtest_id = s.id
    )
  returning s.id
)
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
select
  c.id,
  c.test_id,
  c.name,
  c.abbreviation,
  'none',
  'NONE',
  'numeric_4mode',
  'auto',
  jsonb_build_object(
    'groupKey', c.group_key,
    'groupHeaderLabel', c.group_label,
    'groupOrder', c.group_order,
    'orderIndex', c.order_index
  ),
  c.group_order,
  c.order_index,
  null
from canonical c
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
