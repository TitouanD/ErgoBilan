-- =============================================================================
-- Migration: TIHM subtests completion
-- Date: 2026-03-24
-- Source basis: TIHM / in-hand manipulation components (translation, shift, rotations)
-- Scope:
--   1) Normaliser les composantes deja presentes
--   2) Ajouter les composantes manquantes usuelles
--   3) Uniformiser labels FR/EN, abreviations et ordre
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
    'tihm__translation',
    'tihm',
    'Translation doigts vers paume (finger-to-palm)',
    'TFP',
    'none',
    'NONE',
    'numeric_4mode',
    'auto',
    jsonb_build_object(
      'groupKey', 'tihm_01_scores',
      'groupHeaderLabel', 'Scores TIHM',
      'groupOrder', 1,
      'orderIndex', 1
    ),
    1,
    1,
    null
  ),
  (
    'tihm__translation-paume-doigts',
    'tihm',
    'Translation paume vers doigts (palm-to-finger)',
    'TPD',
    'none',
    'NONE',
    'numeric_4mode',
    'auto',
    jsonb_build_object(
      'groupKey', 'tihm_01_scores',
      'groupHeaderLabel', 'Scores TIHM',
      'groupOrder', 1,
      'orderIndex', 2
    ),
    1,
    2,
    null
  ),
  (
    'tihm__shift',
    'tihm',
    'Shift (translation linéaire digitale)',
    'SHF',
    'none',
    'NONE',
    'numeric_4mode',
    'auto',
    jsonb_build_object(
      'groupKey', 'tihm_01_scores',
      'groupHeaderLabel', 'Scores TIHM',
      'groupOrder', 1,
      'orderIndex', 3
    ),
    1,
    3,
    null
  ),
  (
    'tihm__rotation',
    'tihm',
    'Rotation simple',
    'RS',
    'none',
    'NONE',
    'numeric_4mode',
    'auto',
    jsonb_build_object(
      'groupKey', 'tihm_01_scores',
      'groupHeaderLabel', 'Scores TIHM',
      'groupOrder', 1,
      'orderIndex', 4
    ),
    1,
    4,
    null
  ),
  (
    'tihm__rotation-complexe',
    'tihm',
    'Rotation complexe',
    'RC',
    'none',
    'NONE',
    'numeric_4mode',
    'auto',
    jsonb_build_object(
      'groupKey', 'tihm_01_scores',
      'groupHeaderLabel', 'Scores TIHM',
      'groupOrder', 1,
      'orderIndex', 5
    ),
    1,
    5,
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