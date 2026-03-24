-- =============================================================================
-- Migration: Beery VMI subtests normalization
-- Date: 2026-03-24
-- Source basis: Beery VMI (VMI principal + 2 sous-tests supplementaires)
-- Scope:
--   1) Conserver les 3 composantes canoniques
--   2) Normaliser labels FR, abreviations et ordre canonique
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
    'beery-vmi__vmi',
    'beery-vmi',
    'Intégration visuo-motrice',
    'VMI',
    'none',
    'NONE',
    'numeric_4mode',
    'auto',
    jsonb_build_object(
      'groupKey', 'beeryvmi_01_scores',
      'groupHeaderLabel', 'Scores Beery VMI',
      'groupOrder', 1,
      'orderIndex', 1
    ),
    1,
    1,
    null
  ),
  (
    'beery-vmi__visual-perception',
    'beery-vmi',
    'Perception visuelle',
    'VP',
    'none',
    'NONE',
    'numeric_4mode',
    'auto',
    jsonb_build_object(
      'groupKey', 'beeryvmi_01_scores',
      'groupHeaderLabel', 'Scores Beery VMI',
      'groupOrder', 1,
      'orderIndex', 2
    ),
    1,
    2,
    null
  ),
  (
    'beery-vmi__motor-coordination',
    'beery-vmi',
    'Coordination motrice',
    'CM',
    'none',
    'NONE',
    'numeric_4mode',
    'auto',
    jsonb_build_object(
      'groupKey', 'beeryvmi_01_scores',
      'groupHeaderLabel', 'Scores Beery VMI',
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