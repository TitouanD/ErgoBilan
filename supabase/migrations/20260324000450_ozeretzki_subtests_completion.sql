-- =============================================================================
-- Migration: Ozeretzki (decoupage) subtests completion
-- Date: 2026-03-24
-- Source basis: cotation decoupage de cercle (temps + qualite)
-- Scope:
--   1) Normaliser les composantes existantes
--   2) Ajouter le temps main non dominante
--   3) Uniformiser labels FR, abreviations et ordre
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
    'ozeretzki__decoupage-cercle',
    'ozeretzki',
    'Temps de découpage - main dominante (secondes)',
    'TMD',
    'none',
    'NONE',
    'numeric_4mode',
    'auto',
    jsonb_build_object(
      'groupKey', 'ozeretzki_01_scores',
      'groupHeaderLabel', 'Scores Découpage d''Ozeretzki',
      'groupOrder', 1,
      'orderIndex', 1
    ),
    1,
    1,
    null
  ),
  (
    'ozeretzki__temps-main-non-dominante',
    'ozeretzki',
    'Temps de découpage - main non dominante (secondes)',
    'TMND',
    'none',
    'NONE',
    'numeric_4mode',
    'auto',
    jsonb_build_object(
      'groupKey', 'ozeretzki_01_scores',
      'groupHeaderLabel', 'Scores Découpage d''Ozeretzki',
      'groupOrder', 1,
      'orderIndex', 2
    ),
    1,
    2,
    null
  ),
  (
    'ozeretzki__decoupage-qualite',
    'ozeretzki',
    'Qualité de découpage',
    'QLT',
    'none',
    'NONE',
    'numeric_4mode',
    'auto',
    jsonb_build_object(
      'groupKey', 'ozeretzki_01_scores',
      'groupHeaderLabel', 'Scores Découpage d''Ozeretzki',
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