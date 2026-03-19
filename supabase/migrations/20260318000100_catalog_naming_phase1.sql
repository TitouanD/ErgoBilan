-- =============================================================================
-- Migration : Catalog naming/order corrections (phase 1)
-- Date : 2026-03-18
-- Scope : MABC-2, NEPSY 2, Figure Complexe de Rey, DTVP-A, Lespargot
-- =============================================================================

-- =============================================================================
-- 1) Lespargot — canonical test name + expected 3 subtests
-- =============================================================================
UPDATE public.official_tests
SET name = 'Lespargot'
WHERE id = 'espargot';

UPDATE public.official_subtests
SET name = 'Répétition',
    raw_direction = 'lower_better',
    input_config = coalesce(input_config, '{}'::jsonb) || jsonb_build_object(
      'groupKey', 'lespargot_01_subtests',
      'groupHeaderLabel', 'Sous-tests Lespargot',
      'groupOrder', 1,
      'orderIndex', 1
    )
WHERE id = 'espargot_repetition_repetit_58163a62';

UPDATE public.official_subtests
SET name = 'Dictée',
    raw_direction = 'lower_better',
    input_config = coalesce(input_config, '{}'::jsonb) || jsonb_build_object(
      'groupKey', 'lespargot_01_subtests',
      'groupHeaderLabel', 'Sous-tests Lespargot',
      'groupOrder', 1,
      'orderIndex', 2
    )
WHERE id = 'espargot_dictee_dictee_58163a62';

UPDATE public.official_subtests
SET name = 'Copie',
    raw_direction = 'lower_better',
    input_config = coalesce(input_config, '{}'::jsonb) || jsonb_build_object(
      'groupKey', 'lespargot_01_subtests',
      'groupHeaderLabel', 'Sous-tests Lespargot',
      'groupOrder', 1,
      'orderIndex', 3
    )
WHERE id = 'espargot_copie_copie_58163a62';


-- =============================================================================
-- 2) DTVP-A — numbering-first naming + explicit order
-- =============================================================================
UPDATE public.official_subtests
SET name = 'Subtest 1, Copying (Copie)',
    input_config = coalesce(input_config, '{}'::jsonb) || jsonb_build_object(
      'groupKey', 'dtvpa_01_subtests',
      'groupHeaderLabel', 'Sous-tests DTVP-A',
      'groupOrder', 1,
      'orderIndex', 1
    )
WHERE id = 'dtvp-a__copying';

UPDATE public.official_subtests
SET name = 'Subtest 2, Figure-Ground (Figure-Fond)',
    input_config = coalesce(input_config, '{}'::jsonb) || jsonb_build_object(
      'groupKey', 'dtvpa_01_subtests',
      'groupHeaderLabel', 'Sous-tests DTVP-A',
      'groupOrder', 1,
      'orderIndex', 2
    )
WHERE id = 'dtvp-a__figure-ground';

UPDATE public.official_subtests
SET name = 'Subtest 3, Visual-Motor Search (Recherche visuo-motrice)',
    input_config = coalesce(input_config, '{}'::jsonb) || jsonb_build_object(
      'groupKey', 'dtvpa_01_subtests',
      'groupHeaderLabel', 'Sous-tests DTVP-A',
      'groupOrder', 1,
      'orderIndex', 3
    )
WHERE id = 'dtvp-a__visual-motor-search';

UPDATE public.official_subtests
SET name = 'Subtest 4, Visual Closure (Fermeture Visuelle)',
    input_config = coalesce(input_config, '{}'::jsonb) || jsonb_build_object(
      'groupKey', 'dtvpa_01_subtests',
      'groupHeaderLabel', 'Sous-tests DTVP-A',
      'groupOrder', 1,
      'orderIndex', 4
    )
WHERE id = 'dtvp-a__visual-closure';

UPDATE public.official_subtests
SET name = 'Subtest 5, Visual-Motor Speed (Vitesse visuo-motrice)',
    input_config = coalesce(input_config, '{}'::jsonb) || jsonb_build_object(
      'groupKey', 'dtvpa_01_subtests',
      'groupHeaderLabel', 'Sous-tests DTVP-A',
      'groupOrder', 1,
      'orderIndex', 5
    )
WHERE id = 'dtvp-a__visual-motor-speed';

UPDATE public.official_subtests
SET name = 'Subtest 6, Form Constancy (Constance de la forme)',
    input_config = coalesce(input_config, '{}'::jsonb) || jsonb_build_object(
      'groupKey', 'dtvpa_01_subtests',
      'groupHeaderLabel', 'Sous-tests DTVP-A',
      'groupOrder', 1,
      'orderIndex', 6
    )
WHERE id = 'dtvp-a__form-constancy';


-- =============================================================================
-- 3) NEPSY 2 — add missing Cubes + Flèches (idempotent)
-- =============================================================================
INSERT INTO public.official_subtests (id, test_id, name, score_type, computation_mode, input_model, raw_direction, input_config, organization_id)
VALUES
  ('nepsy-2__cubes', 'nepsy-2', 'Cubes', 'scaled', 'LOOKUP', 'numeric_4mode', 'auto',
   jsonb_build_object('groupKey', 'nepsy2_07_visuospatial', 'groupHeaderLabel', 'Traitements visuospatiaux', 'groupOrder', 7, 'orderIndex', 1), NULL),
  ('nepsy-2__fleches', 'nepsy-2', 'Flèches', 'scaled', 'LOOKUP', 'numeric_4mode', 'auto',
   jsonb_build_object('groupKey', 'nepsy2_07_visuospatial', 'groupHeaderLabel', 'Traitements visuospatiaux', 'groupOrder', 7, 'orderIndex', 2), NULL)
ON CONFLICT (id) DO NOTHING;


-- =============================================================================
-- 4) Figure Complexe de Rey — add ordered subtests (idempotent)
-- =============================================================================
INSERT INTO public.official_subtests (id, test_id, name, score_type, computation_mode, input_model, raw_direction, input_config, organization_id)
VALUES
  ('figure-rey__copie-modele', 'figure-rey', 'Copie du modèle', 'scaled', 'LOOKUP', 'numeric_4mode', 'higher_better',
   jsonb_build_object('groupKey', 'rey_01_copie', 'groupHeaderLabel', 'Copie', 'groupOrder', 1, 'orderIndex', 1), NULL),
  ('figure-rey__type-copie', 'figure-rey', 'Type de copie', 'percentile', 'LOOKUP', 'numeric_4mode', 'higher_better',
   jsonb_build_object('groupKey', 'rey_01_copie', 'groupHeaderLabel', 'Copie', 'groupOrder', 1, 'orderIndex', 2), NULL),
  ('figure-rey__richesse-copie', 'figure-rey', 'Richesse et exactitude de la copie', 'standard', 'PARAMETRIC', 'numeric_4mode', 'higher_better',
   jsonb_build_object('groupKey', 'rey_01_copie', 'groupHeaderLabel', 'Copie', 'groupOrder', 1, 'orderIndex', 3), NULL),
  ('figure-rey__temps-copie', 'figure-rey', 'Temps de copie', 'percentile', 'LOOKUP', 'numeric_4mode', 'lower_better',
   jsonb_build_object('groupKey', 'rey_01_copie', 'groupHeaderLabel', 'Copie', 'groupOrder', 1, 'orderIndex', 4, 'rawValueLabel', 'SEC.'), NULL),
  ('figure-rey__reproduction-memoire', 'figure-rey', 'Reproduction de mémoire', 'scaled', 'LOOKUP', 'numeric_4mode', 'higher_better',
   jsonb_build_object('groupKey', 'rey_02_memoire', 'groupHeaderLabel', 'Mémoire', 'groupOrder', 2, 'orderIndex', 1), NULL),
  ('figure-rey__type-reproduction', 'figure-rey', 'Type de reproduction', 'percentile', 'LOOKUP', 'numeric_4mode', 'higher_better',
   jsonb_build_object('groupKey', 'rey_02_memoire', 'groupHeaderLabel', 'Mémoire', 'groupOrder', 2, 'orderIndex', 2), NULL),
  ('figure-rey__richesse-reproduction', 'figure-rey', 'Richesse et exactitude de la reproduction', 'standard', 'PARAMETRIC', 'numeric_4mode', 'higher_better',
   jsonb_build_object('groupKey', 'rey_02_memoire', 'groupHeaderLabel', 'Mémoire', 'groupOrder', 2, 'orderIndex', 3), NULL)
ON CONFLICT (id) DO NOTHING;


-- =============================================================================
-- 5) MABC-2 — naming alignment + missing non-preferred peg flip + explicit order
-- =============================================================================
UPDATE public.official_subtests
SET name = 'Enfiler les cubes'
WHERE id = 'mabc-2__bead-threading';

UPDATE public.official_subtests
SET name = 'Enfiler le lacet'
WHERE id = 'mabc-2__lacing';

UPDATE public.official_subtests
SET name = 'Attraper le sac'
WHERE id = 'mabc-2__catch-bag';

UPDATE public.official_subtests
SET name = 'Lancer le sac'
WHERE id = 'mabc-2__throw-bag';

UPDATE public.official_subtests
SET name = 'Lancer la balle sur la cible'
WHERE id = 'mabc-2__throw-target';

UPDATE public.official_subtests
SET name = 'Suivre le trajet 1'
WHERE id = 'mabc-2__trail-band1';

UPDATE public.official_subtests
SET name = 'Suivre le trajet 2'
WHERE id = 'mabc-2__trail-band2';

UPDATE public.official_subtests
SET name = 'Suivre le trajet 3'
WHERE id = 'mabc-2__trail-band3';

UPDATE public.official_subtests
SET name = 'Retourner les chevilles main préférée'
WHERE id = 'mabc-2__pegs-flip';

UPDATE public.official_subtests
SET name = 'Triangle avec écrous et boulon'
WHERE id = 'mabc-2__nuts-bolts';

UPDATE public.official_subtests
SET name = 'Équilibre sur une jambe meilleure jambe'
WHERE id = 'mabc-2__balance-one-leg-best';

UPDATE public.official_subtests
SET name = 'Équilibre sur une jambe autre jambe'
WHERE id = 'mabc-2__balance-one-leg-other';

UPDATE public.official_subtests
SET name = 'Équilibre sur deux planches'
WHERE id = 'mabc-2__balance-two-boards';

UPDATE public.official_subtests
SET name = 'Marcher sur pointe'
WHERE id = 'mabc-2__tiptoe-walk';

UPDATE public.official_subtests
SET name = 'Attraper à une main main préférée'
WHERE id = 'mabc-2__catch-one-hand';

UPDATE public.official_subtests
SET name = 'Note totale Équilibre',
    score_type = 'standard'
WHERE id = 'mabc-2__balance-composite';

UPDATE public.official_subtests
SET name = 'Note totale du test',
    score_type = 'standard'
WHERE id = 'mabc-2__total-score';

INSERT INTO public.official_subtests (id, test_id, name, score_type, computation_mode, input_model, raw_direction, input_config, organization_id)
VALUES
  ('mabc-2__pegs-flip-non-pref', 'mabc-2', 'Retourner les chevilles main non préférée', 'scaled', 'LOOKUP', 'numeric_4mode', 'lower_better',
   jsonb_build_object('groupKey', 'mabc2_03_dexterite', 'groupHeaderLabel', 'Groupe d''âge 3 (11 à 16 ans) — Dextérité manuelle', 'groupOrder', 3, 'orderIndex', 2, 'rawValueLabel', 'SEC.'), NULL),
  ('mabc-2__manual-dexterity-total', 'mabc-2', 'Note totale dextérité manuelle', 'standard', 'LOOKUP', 'numeric_4mode', 'auto',
   jsonb_build_object('groupKey', 'mabc2_98_composites', 'groupHeaderLabel', 'Composites', 'groupOrder', 98, 'orderIndex', 1), NULL),
  ('mabc-2__aiming-catching-total', 'mabc-2', 'Note totale viser et attraper', 'standard', 'LOOKUP', 'numeric_4mode', 'auto',
   jsonb_build_object('groupKey', 'mabc2_98_composites', 'groupHeaderLabel', 'Composites', 'groupOrder', 98, 'orderIndex', 2), NULL)
ON CONFLICT (id) DO NOTHING;

-- Apply deterministic ordering metadata for existing rows used in UI ordering.
UPDATE public.official_subtests
SET input_config = coalesce(input_config, '{}'::jsonb) || jsonb_build_object(
  'groupOrder', CASE
    WHEN id IN ('mabc-2__coin-pref','mabc-2__coin-non-pref','mabc-2__bead-threading','mabc-2__trail-band1') THEN 1
    WHEN id IN ('mabc-2__catch-bag','mabc-2__throw-bag') THEN 2
    WHEN id IN ('mabc-2__balance-one-leg-best','mabc-2__balance-one-leg-other','mabc-2__tiptoe-walk','mabc-2__mat-jump') THEN 3
    WHEN id IN ('mabc-2__pegs-preferred','mabc-2__lacing','mabc-2__trail-band2','mabc-2__catch-two-hands') THEN 4
    WHEN id IN ('mabc-2__pegs-flip','mabc-2__pegs-flip-non-pref','mabc-2__nuts-bolts','mabc-2__trail-band3','mabc-2__catch-one-hand','mabc-2__throw-target','mabc-2__balance-two-boards') THEN 5
    WHEN id IN ('mabc-2__manual-dexterity-total','mabc-2__aiming-catching-total','mabc-2__balance-composite','mabc-2__total-score') THEN 98
    ELSE 99
  END,
  'orderIndex', CASE
    WHEN id = 'mabc-2__coin-pref' THEN 1
    WHEN id = 'mabc-2__coin-non-pref' THEN 2
    WHEN id = 'mabc-2__bead-threading' THEN 3
    WHEN id = 'mabc-2__trail-band1' THEN 4
    WHEN id = 'mabc-2__manual-dexterity-total' THEN 1
    WHEN id = 'mabc-2__catch-bag' THEN 1
    WHEN id = 'mabc-2__throw-bag' THEN 2
    WHEN id = 'mabc-2__aiming-catching-total' THEN 2
    WHEN id = 'mabc-2__balance-one-leg-best' THEN 1
    WHEN id = 'mabc-2__balance-one-leg-other' THEN 2
    WHEN id = 'mabc-2__tiptoe-walk' THEN 3
    WHEN id = 'mabc-2__mat-jump' THEN 4
    WHEN id = 'mabc-2__balance-composite' THEN 3
    WHEN id = 'mabc-2__pegs-preferred' THEN 1
    WHEN id = 'mabc-2__lacing' THEN 2
    WHEN id = 'mabc-2__trail-band2' THEN 3
    WHEN id = 'mabc-2__catch-two-hands' THEN 1
    WHEN id = 'mabc-2__pegs-flip' THEN 1
    WHEN id = 'mabc-2__pegs-flip-non-pref' THEN 2
    WHEN id = 'mabc-2__nuts-bolts' THEN 3
    WHEN id = 'mabc-2__trail-band3' THEN 4
    WHEN id = 'mabc-2__catch-one-hand' THEN 1
    WHEN id = 'mabc-2__throw-target' THEN 3
    WHEN id = 'mabc-2__balance-two-boards' THEN 2
    WHEN id = 'mabc-2__total-score' THEN 4
    ELSE coalesce((input_config->>'orderIndex')::int, 999)
  END,
  'groupHeaderLabel', CASE
    WHEN id IN ('mabc-2__coin-pref','mabc-2__coin-non-pref','mabc-2__bead-threading','mabc-2__trail-band1') THEN 'Groupe d''âge 1 (3 à 6 ans) — Dextérité manuelle'
    WHEN id IN ('mabc-2__catch-bag','mabc-2__throw-bag') THEN 'Groupe d''âge 1 (3 à 6 ans) — Viser et attraper'
    WHEN id IN ('mabc-2__balance-one-leg-best','mabc-2__balance-one-leg-other','mabc-2__tiptoe-walk','mabc-2__mat-jump') THEN 'Groupe d''âge 1 (3 à 6 ans) — Équilibre'
    WHEN id IN ('mabc-2__pegs-preferred','mabc-2__lacing','mabc-2__trail-band2') THEN 'Groupe d''âge 2 (7 à 10 ans) — Dextérité manuelle'
    WHEN id IN ('mabc-2__catch-two-hands') THEN 'Groupe d''âge 2 (7 à 10 ans) — Viser et attraper'
    WHEN id IN ('mabc-2__pegs-flip','mabc-2__pegs-flip-non-pref','mabc-2__nuts-bolts','mabc-2__trail-band3') THEN 'Groupe d''âge 3 (11 à 16 ans) — Dextérité manuelle'
    WHEN id IN ('mabc-2__catch-one-hand','mabc-2__throw-target') THEN 'Groupe d''âge 3 (11 à 16 ans) — Viser et attraper'
    WHEN id IN ('mabc-2__balance-two-boards') THEN 'Groupe d''âge 3 (11 à 16 ans) — Équilibre'
    WHEN id IN ('mabc-2__manual-dexterity-total','mabc-2__aiming-catching-total','mabc-2__balance-composite','mabc-2__total-score') THEN 'Composites'
    ELSE coalesce(input_config->>'groupHeaderLabel', 'MABC-2')
  END,
  'groupKey', CASE
    WHEN id IN ('mabc-2__coin-pref','mabc-2__coin-non-pref','mabc-2__bead-threading','mabc-2__trail-band1') THEN 'mabc2_01_age1_dexterite'
    WHEN id IN ('mabc-2__catch-bag','mabc-2__throw-bag') THEN 'mabc2_01_age1_viser_attraper'
    WHEN id IN ('mabc-2__balance-one-leg-best','mabc-2__balance-one-leg-other','mabc-2__tiptoe-walk','mabc-2__mat-jump') THEN 'mabc2_01_age1_equilibre'
    WHEN id IN ('mabc-2__pegs-preferred','mabc-2__lacing','mabc-2__trail-band2') THEN 'mabc2_02_age2_dexterite'
    WHEN id IN ('mabc-2__catch-two-hands') THEN 'mabc2_02_age2_viser_attraper'
    WHEN id IN ('mabc-2__pegs-flip','mabc-2__pegs-flip-non-pref','mabc-2__nuts-bolts','mabc-2__trail-band3') THEN 'mabc2_03_age3_dexterite'
    WHEN id IN ('mabc-2__catch-one-hand','mabc-2__throw-target') THEN 'mabc2_03_age3_viser_attraper'
    WHEN id IN ('mabc-2__balance-two-boards') THEN 'mabc2_03_age3_equilibre'
    WHEN id IN ('mabc-2__manual-dexterity-total','mabc-2__aiming-catching-total','mabc-2__balance-composite','mabc-2__total-score') THEN 'mabc2_98_composites'
    ELSE coalesce(input_config->>'groupKey', 'mabc2_99_autres')
  END
)
WHERE test_id = 'mabc-2';
