-- =============================================================================
-- Migration: Purdue Pegboard subtests completion
-- Date: 2026-03-24
-- Source basis: Purdue Pegboard (main droite, main gauche, deux mains, assemblage, somme R+L+B)
-- Scope:
--   1) Normaliser les 4 sous-tests existants
--   2) Ajouter le score compose droite+gauche+bilateral
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
    'purdue__dominant',
    'purdue-pegboard',
    'Main dominante (30 s)',
    'MD',
    'none',
    'NONE',
    'numeric_4mode',
    'auto',
    jsonb_build_object(
      'groupKey', 'purdue_01_scores',
      'groupHeaderLabel', 'Scores Purdue Pegboard',
      'groupOrder', 1,
      'orderIndex', 1
    ),
    1,
    1,
    null
  ),
  (
    'purdue__non-dominant',
    'purdue-pegboard',
    'Main non dominante (30 s)',
    'MND',
    'none',
    'NONE',
    'numeric_4mode',
    'auto',
    jsonb_build_object(
      'groupKey', 'purdue_01_scores',
      'groupHeaderLabel', 'Scores Purdue Pegboard',
      'groupOrder', 1,
      'orderIndex', 2
    ),
    1,
    2,
    null
  ),
  (
    'purdue__bilateral',
    'purdue-pegboard',
    'Deux mains (30 s)',
    'BI',
    'none',
    'NONE',
    'numeric_4mode',
    'auto',
    jsonb_build_object(
      'groupKey', 'purdue_01_scores',
      'groupHeaderLabel', 'Scores Purdue Pegboard',
      'groupOrder', 1,
      'orderIndex', 3
    ),
    1,
    3,
    null
  ),
  (
    'purdue__assembly',
    'purdue-pegboard',
    'Assemblage (60 s)',
    'ASM',
    'none',
    'NONE',
    'numeric_4mode',
    'auto',
    jsonb_build_object(
      'groupKey', 'purdue_01_scores',
      'groupHeaderLabel', 'Scores Purdue Pegboard',
      'groupOrder', 1,
      'orderIndex', 4
    ),
    1,
    4,
    null
  ),
  (
    'purdue__right-left-both-sum',
    'purdue-pegboard',
    'Somme droite + gauche + deux mains',
    'RLB',
    'none',
    'NONE',
    'numeric_4mode',
    'auto',
    jsonb_build_object(
      'groupKey', 'purdue_01_scores',
      'groupHeaderLabel', 'Scores Purdue Pegboard',
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
