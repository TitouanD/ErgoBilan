-- =============================================================================
-- Migration: Catalog Reliability & Field Sanity
-- Date: 2026-03-02
--
-- Goals:
--   1. Promote EVIC to an official public test (clean IDs, org_id IS NULL)
--   2. Rename all priv_XXXX subtest IDs to semantic clean IDs
--   3. Fix raw_direction for all 310 official subtests (none were set)
--   4. Set always_show_raw + raw_display_decimals for appropriate subtests
--   5. Remove dead rawDirectionHint from input_config
--   6. Set defaultMetric='raw' for score_type='none' subtests
--   7. Fix unit on barrage-h temps subtest (pts → sec)
--   8. Replace compute_score_core with auto-detect from norm content
--      (computation_mode becomes a documentation hint, not a hard contract)
-- =============================================================================

BEGIN;

-- ============================================================
-- PART 0: EVIC official test
-- (needs to exist before we update EVIC subtests' test_id FK)
-- ============================================================

INSERT INTO public.official_tests (id, name, category_id, version, author, organization_id)
VALUES ('evic', 'EVIC (Évaluation de l''Écriture Infantile et Cursive)', 'ecriture', '1.0', 'Lurçat & Veispour', NULL)
ON CONFLICT (id) DO UPDATE SET
  name          = EXCLUDED.name,
  category_id   = EXCLUDED.category_id,
  organization_id = NULL;

-- ============================================================
-- PART 1: Drop the FK on official_norms.subtest_id so we can
--         safely rename official_subtests.id values
-- ============================================================

ALTER TABLE public.official_norms
  DROP CONSTRAINT IF EXISTS official_norms_subtest_id_fkey;

-- ============================================================
-- PART 2: EVIC subtests — rename IDs, make public, fix names
-- ============================================================

-- Copie
UPDATE public.official_subtests SET
  id              = 'evic__copie',
  test_id         = 'evic',
  name            = 'Copie',
  organization_id = NULL,
  score_type      = 'standard',
  raw_direction   = 'lower_better',   -- fewer errors = better
  always_show_raw = true,
  computation_mode = 'PARAMETRIC'
WHERE id = 'priv_9ad49003_e836396c_evic_copie_evic_co';

UPDATE public.official_norms SET
  subtest_id      = 'evic__copie',
  organization_id = NULL
WHERE subtest_id = 'priv_9ad49003_e836396c_evic_copie_evic_co';

-- Dictée
UPDATE public.official_subtests SET
  id              = 'evic__dictee',
  test_id         = 'evic',
  name            = 'Dictée',
  organization_id = NULL,
  score_type      = 'standard',
  raw_direction   = 'lower_better',
  always_show_raw = true,
  computation_mode = 'PARAMETRIC'
WHERE id = 'priv_9ad49003_e836396c_evic_dict_e_evic_di';

UPDATE public.official_norms SET
  subtest_id      = 'evic__dictee',
  organization_id = NULL
WHERE subtest_id = 'priv_9ad49003_e836396c_evic_dict_e_evic_di';

-- Répétition
UPDATE public.official_subtests SET
  id              = 'evic__repetition',
  test_id         = 'evic',
  name            = 'Répétition',
  organization_id = NULL,
  score_type      = 'standard',
  raw_direction   = 'lower_better',
  always_show_raw = true,
  computation_mode = 'PARAMETRIC'
WHERE id = 'priv_9ad49003_e836396c_evic_r_p_tition_evic_re';

UPDATE public.official_norms SET
  subtest_id      = 'evic__repetition',
  organization_id = NULL
WHERE subtest_id = 'priv_9ad49003_e836396c_evic_r_p_tition_evic_re';

-- Automatisation de la frappe
UPDATE public.official_subtests SET
  id              = 'evic__automatisation',
  test_id         = 'evic',
  name            = 'Automatisation de la frappe',
  organization_id = NULL,
  score_type      = 'standard',
  raw_direction   = 'higher_better',
  always_show_raw = true,
  computation_mode = 'PARAMETRIC'
WHERE id = 'priv_9ad49003_e836396c_automatisation_frappe';

UPDATE public.official_norms SET
  subtest_id      = 'evic__automatisation',
  organization_id = NULL
WHERE subtest_id = 'priv_9ad49003_e836396c_automatisation_frappe';

-- ============================================================
-- PART 3: Barrage-H — rename priv_ IDs
-- ============================================================

-- Nombre de cibles barrées
UPDATE public.official_subtests SET id = 'barrage-h__cibles'
  WHERE id = 'priv_d1456119_1770494873578_nombre_de_cibles_barr_es';
UPDATE public.official_norms SET subtest_id = 'barrage-h__cibles'
  WHERE subtest_id = 'priv_d1456119_1770494873578_nombre_de_cibles_barr_es';

-- Temps (also fix unit: pts → sec)
UPDATE public.official_subtests SET
  id   = 'barrage-h__temps',
  unit = 'sec',
  name = 'Temps à terminer (s)'
WHERE id = 'priv_d1456119_1770494873578_temps_auquel_l_enfant_estime_avoir_fini_secondes_';
UPDATE public.official_norms SET subtest_id = 'barrage-h__temps'
  WHERE subtest_id = 'priv_d1456119_1770494873578_temps_auquel_l_enfant_estime_avoir_fini_secondes_';

-- ============================================================
-- PART 4: MABC-2 — rename 21 priv_ IDs
-- ============================================================

UPDATE public.official_subtests SET id = 'mabc-2__catch-one-hand'
  WHERE id = 'priv_4359d797_f841cdf0_m_abc_2_attraper_avec_1_main_meilleure_main';
UPDATE public.official_norms SET subtest_id = 'mabc-2__catch-one-hand'
  WHERE subtest_id = 'priv_4359d797_f841cdf0_m_abc_2_attraper_avec_1_main_meilleure_main';

UPDATE public.official_subtests SET id = 'mabc-2__catch-two-hands'
  WHERE id = 'priv_4359d797_f841cdf0_attraper_avec_2_mains_catching_2_hands_';
UPDATE public.official_norms SET subtest_id = 'mabc-2__catch-two-hands'
  WHERE subtest_id = 'priv_4359d797_f841cdf0_attraper_avec_2_mains_catching_2_hands_';

UPDATE public.official_subtests SET id = 'mabc-2__catch-bag'
  WHERE id = 'priv_d1456119_1770505047727_attraper_sac';
UPDATE public.official_norms SET subtest_id = 'mabc-2__catch-bag'
  WHERE subtest_id = 'priv_d1456119_1770505047727_attraper_sac';

UPDATE public.official_subtests SET id = 'mabc-2__pegs-preferred'
  WHERE id = 'priv_4359d797_f841cdf0_chevilles_main_pr_f_r_e_pegboard_preferred_hand_';
UPDATE public.official_norms SET subtest_id = 'mabc-2__pegs-preferred'
  WHERE subtest_id = 'priv_4359d797_f841cdf0_chevilles_main_pr_f_r_e_pegboard_preferred_hand_';

UPDATE public.official_subtests SET id = 'mabc-2__nuts-bolts'
  WHERE id = 'priv_4359d797_f841cdf0_m_abc_2_ecrous_et_boulons';
UPDATE public.official_norms SET subtest_id = 'mabc-2__nuts-bolts'
  WHERE subtest_id = 'priv_4359d797_f841cdf0_m_abc_2_ecrous_et_boulons';

UPDATE public.official_subtests SET id = 'mabc-2__bead-threading'
  WHERE id = 'priv_d1456119_1770505047727_enfiler_cubes';
UPDATE public.official_norms SET subtest_id = 'mabc-2__bead-threading'
  WHERE subtest_id = 'priv_d1456119_1770505047727_enfiler_cubes';

UPDATE public.official_subtests SET id = 'mabc-2__balance-one-leg-other'
  WHERE id = 'priv_d1456119_1770505047727__quilibre_sur_1_jambe_autre_jambe';
UPDATE public.official_norms SET subtest_id = 'mabc-2__balance-one-leg-other'
  WHERE subtest_id = 'priv_d1456119_1770505047727__quilibre_sur_1_jambe_autre_jambe';

UPDATE public.official_subtests SET id = 'mabc-2__balance-one-leg-best'
  WHERE id = 'priv_d1456119_1770505047727__quilibre_sur_1_jambe_meilleure_jambe';
UPDATE public.official_norms SET subtest_id = 'mabc-2__balance-one-leg-best'
  WHERE subtest_id = 'priv_d1456119_1770505047727__quilibre_sur_1_jambe_meilleure_jambe';

UPDATE public.official_subtests SET id = 'mabc-2__balance-two-boards'
  WHERE id = 'priv_4359d797_f841cdf0__quilibre_sur_2_planches';
UPDATE public.official_norms SET subtest_id = 'mabc-2__balance-two-boards'
  WHERE subtest_id = 'priv_4359d797_f841cdf0__quilibre_sur_2_planches';

UPDATE public.official_subtests SET id = 'mabc-2__lacing'
  WHERE id = 'priv_4359d797_f841cdf0_lacet_lacing_';
UPDATE public.official_norms SET subtest_id = 'mabc-2__lacing'
  WHERE subtest_id = 'priv_4359d797_f841cdf0_lacet_lacing_';

UPDATE public.official_subtests SET id = 'mabc-2__throw-bag'
  WHERE id = 'priv_d1456119_1770505047727_lancer_sac';
UPDATE public.official_norms SET subtest_id = 'mabc-2__throw-bag'
  WHERE subtest_id = 'priv_d1456119_1770505047727_lancer_sac';

UPDATE public.official_subtests SET id = 'mabc-2__throw-target'
  WHERE id = 'priv_4359d797_f841cdf0_lancer_sur_cible';
UPDATE public.official_norms SET subtest_id = 'mabc-2__throw-target'
  WHERE subtest_id = 'priv_4359d797_f841cdf0_lancer_sur_cible';

UPDATE public.official_subtests SET id = 'mabc-2__tiptoe-walk'
  WHERE id = 'priv_d1456119_1770505047727_marcher_sur_pointe_des_pieds';
UPDATE public.official_norms SET subtest_id = 'mabc-2__tiptoe-walk'
  WHERE subtest_id = 'priv_d1456119_1770505047727_marcher_sur_pointe_des_pieds';

UPDATE public.official_subtests SET id = 'mabc-2__pegs-flip'
  WHERE id = 'priv_4359d797_f841cdf0_m_abc_2_retourner_chevilles_main_pr_f_r_e';
UPDATE public.official_norms SET subtest_id = 'mabc-2__pegs-flip'
  WHERE subtest_id = 'priv_4359d797_f841cdf0_m_abc_2_retourner_chevilles_main_pr_f_r_e';

UPDATE public.official_subtests SET id = 'mabc-2__mat-jump'
  WHERE id = 'priv_d1456119_1770505047727_sauter_sur_tapis';
UPDATE public.official_norms SET subtest_id = 'mabc-2__mat-jump'
  WHERE subtest_id = 'priv_d1456119_1770505047727_sauter_sur_tapis';

UPDATE public.official_subtests SET id = 'mabc-2__coin-non-pref'
  WHERE id = 'priv_d1456119_1770505047727_tirelire_main_non_pr_f_r_e';
UPDATE public.official_norms SET subtest_id = 'mabc-2__coin-non-pref'
  WHERE subtest_id = 'priv_d1456119_1770505047727_tirelire_main_non_pr_f_r_e';

UPDATE public.official_subtests SET id = 'mabc-2__coin-pref'
  WHERE id = 'priv_d1456119_1770505047727_tirelire_main_pr_f_r_e';
UPDATE public.official_norms SET subtest_id = 'mabc-2__coin-pref'
  WHERE subtest_id = 'priv_d1456119_1770505047727_tirelire_main_pr_f_r_e';

UPDATE public.official_subtests SET id = 'mabc-2__trail-band2'
  WHERE id = 'priv_4359d797_f841cdf0_mabc2_path_2_errors';
UPDATE public.official_norms SET subtest_id = 'mabc-2__trail-band2'
  WHERE subtest_id = 'priv_4359d797_f841cdf0_mabc2_path_2_errors';

UPDATE public.official_subtests SET id = 'mabc-2__trail-band1'
  WHERE id = 'priv_d1456119_1770505047727_trajet_1';
UPDATE public.official_norms SET subtest_id = 'mabc-2__trail-band1'
  WHERE subtest_id = 'priv_d1456119_1770505047727_trajet_1';

UPDATE public.official_subtests SET id = 'mabc-2__trail-band3'
  WHERE id = 'priv_4359d797_f841cdf0_trajet_3';
UPDATE public.official_norms SET subtest_id = 'mabc-2__trail-band3'
  WHERE subtest_id = 'priv_4359d797_f841cdf0_trajet_3';

UPDATE public.official_subtests SET id = 'mabc-2__aiming-catch'
  WHERE id = 'priv_4359d797_f841cdf0_viser_et_attraper';
UPDATE public.official_norms SET subtest_id = 'mabc-2__aiming-catch'
  WHERE subtest_id = 'priv_4359d797_f841cdf0_viser_et_attraper';

-- ============================================================
-- PART 5: Test-Cloches — rename priv_ ID
-- ============================================================

UPDATE public.official_subtests SET id = 'test-cloches__cibles'
  WHERE id = 'priv_d1456119_1770496566120_nombre_de_cloches_barr_es';
UPDATE public.official_norms SET subtest_id = 'test-cloches__cibles'
  WHERE subtest_id = 'priv_d1456119_1770496566120_nombre_de_cloches_barr_es';

-- ============================================================
-- PART 6: Re-add FK (all subtest_id values are now valid)
-- ============================================================

ALTER TABLE public.official_norms
  ADD CONSTRAINT official_norms_subtest_id_fkey
  FOREIGN KEY (subtest_id) REFERENCES public.official_subtests(id);

-- ============================================================
-- PART 7: raw_direction — bulk fix for all official subtests
--
-- Strategy:
--   A) Time-based subtests → lower_better
--   B) Error-count / "moins c'est mieux" → lower_better (explicit list)
--   C) QuickDASH → lower_better (lower disability score = better)
--   D) Everything else with a real score_type → higher_better
--   E) score_type='none' and qualitative → keep 'auto'
-- ============================================================

-- A: Time-based subtests (unit contains 'sec' or ID/name signals time)
UPDATE public.official_subtests
SET raw_direction = 'lower_better'
WHERE organization_id IS NULL
  AND (
    unit ILIKE '%sec%'
    OR id IN (
      'figure-rey__copie-temps',
      'figure-rey__memoire-temps',
      'barrage-h__temps',
      'mabc-2__pegs-preferred',   -- Chevilles = time-based pegboard
      'mabc-2__pegs-flip',         -- Retourner chevilles = time-based  
      'mabc-2__nuts-bolts',        -- Écrous et boulons = time-based
      'mabc-2__lacing',            -- Lacet = time-based
      'mabc-2__bead-threading'     -- Enfiler cubes = time-based
    )
  );

-- B: Error/penalty count subtests (more errors = worse)
UPDATE public.official_subtests
SET raw_direction = 'lower_better'
WHERE organization_id IS NULL
  AND id IN (
    'mabc-2__trail-band1',
    'mabc-2__trail-band2',
    'mabc-2__trail-band3',
    'evic__copie',
    'evic__dictee',
    'evic__repetition',
    'bhk__quality'               -- BHK Qualité: higher defect score = worse handwriting
  );

-- C: QuickDASH and similar disability scales (lower = less disability = better)
UPDATE public.official_subtests
SET raw_direction = 'lower_better'
WHERE organization_id IS NULL
  AND id IN (
    'quick-dash__total',
    'quick-dash__work-module',
    'quick-dash__sport-module'
  );

-- D: BRIEF-2, SPM, Profil Sensoriel 2 — higher T-score means MORE difficulty
--    These are behavioral questionnaires where higher = more problematic
UPDATE public.official_subtests
SET raw_direction = 'lower_better'
WHERE organization_id IS NULL
  AND test_id IN ('brief-2', 'spm', 'profil-sensoriel-2');

-- E: All remaining official subtests that still have raw_direction='auto'
--    and have a real score_type (not 'none') and aren't qualitative → higher_better
UPDATE public.official_subtests
SET raw_direction = 'higher_better'
WHERE organization_id IS NULL
  AND raw_direction = 'auto'
  AND LOWER(COALESCE(score_type, 'none')) <> 'none'
  AND COALESCE(input_model, 'numeric_4mode') <> 'qualitative_category';

-- ============================================================
-- PART 8: always_show_raw + raw_display_decimals
-- ============================================================

-- Tests where the raw value itself is clinically meaningful to report
UPDATE public.official_subtests
SET always_show_raw = true
WHERE organization_id IS NULL
  AND id IN (
    'bhk__quality',
    'bhk__speed',
    'bhk-ado__quality',
    'bhk-ado__speed',
    'espargot_copie_copie_58163a62',
    'espargot_dictee_dictee_58163a62',
    'espargot_repetition_repetit_58163a62',
    'barrage-h__cibles',
    'barrage-h__temps',
    'evic__copie',
    'evic__dictee',
    'evic__repetition',
    'evic__automatisation'
  );

-- BHK Vitesse: raw is characters/5min and shown with 1 decimal
UPDATE public.official_subtests
SET raw_display_decimals = 1
WHERE organization_id IS NULL
  AND id IN ('bhk__speed', 'bhk-ado__speed');

-- ============================================================
-- PART 9: input_config cleanup
--   a) Remove dead rawDirectionHint key (superseded by raw_direction column)
--   b) Set defaultMetric='raw' for score_type='none' subtests
--      (clinician enters raw directly, no standardized conversion)
-- ============================================================

-- a) Remove rawDirectionHint from ALL official subtests
UPDATE public.official_subtests
SET input_config = input_config - 'rawDirectionHint'
WHERE organization_id IS NULL
  AND input_config ? 'rawDirectionHint';

-- b) defaultMetric = 'raw' for score_type='none' (MMSE, MoCA, COPM, QuickDASH, etc.)
UPDATE public.official_subtests
SET input_config = COALESCE(input_config, '{}') || '{"defaultMetric": "raw"}'
WHERE organization_id IS NULL
  AND LOWER(COALESCE(score_type, 'none')) = 'none'
  AND COALESCE(input_model, 'numeric_4mode') <> 'qualitative_category';

-- ============================================================
-- PART 10: Replace compute_score_core with auto-detect version
--
-- Key change: v_method is now inferred from norm content, not solely
-- from the computation_mode column. If both PARAMETRIC (mean+sd) and
-- LOOKUP (raw_min+raw_max) norms exist, computation_mode breaks the tie.
-- This guarantees scoring works even if norms were added in a different
-- format than what computation_mode declares.
-- ============================================================

CREATE OR REPLACE FUNCTION public.compute_score_core(
  p_subtest_id   text,
  p_raw_score    real,
  p_age_months   integer,
  p_gender       text    DEFAULT 'Mixed',
  p_class_level  text    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_caller_org_id      uuid;
  v_effective_subtest_id text;
  v_subtest            record;
  v_norm               record;
  v_floor_norm         record;
  v_has_parametric     boolean := false;
  v_has_lookup         boolean := false;
  v_method             text;
  v_z                  real;
  v_standard           real;
  v_percentile         real;
  v_lowest_raw_min     real;
  v_direction          text;
  v_warnings           text[] := ARRAY[]::text[];
  v_scale_mean         real;
  v_scale_sd           real;
BEGIN
  SELECT om.organization_id INTO v_caller_org_id
  FROM organization_members om
  WHERE om.user_id = auth.uid()
  LIMIT 1;

  v_effective_subtest_id := public.resolve_effective_subtest_id(p_subtest_id, v_caller_org_id);

  SELECT * INTO v_subtest
  FROM public.official_subtests
  WHERE id = v_effective_subtest_id
    AND (organization_id IS NULL OR organization_id = v_caller_org_id)
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'raw', p_raw_score,
      'standard', NULL,
      'percentile', NULL,
      'zScore', NULL,
      'norm_found', false,
      'method', 'NONE',
      'warnings', ARRAY['subtest_not_found']
    );
  END IF;

  IF v_subtest.id <> p_subtest_id AND coalesce(v_subtest.is_override_clone, false) THEN
    v_warnings := array_append(v_warnings, 'direction_override_clone_applied');
  END IF;

  IF lower(coalesce(v_subtest.score_type, 'none')) = 'none' THEN
    v_warnings := array_append(v_warnings, 'score_type_unset');
    RETURN jsonb_build_object(
      'raw', p_raw_score,
      'standard', NULL,
      'percentile', NULL,
      'zScore', NULL,
      'norm_found', false,
      'method', 'NONE',
      'warnings', v_warnings
    );
  END IF;

  -- Resolve direction (used by PARAMETRIC z-flip and LOOKUP tie-breaking)
  v_direction := lower(coalesce(v_subtest.raw_direction, 'auto'));
  IF v_direction NOT IN ('higher_better', 'lower_better') THEN
    v_direction := CASE
      WHEN lower(coalesce(v_subtest.name, '')) ~ '(temps|latence|erreur|fautes|qualite|duree|delai)'
        THEN 'lower_better'
      ELSE 'higher_better'
    END;
    v_warnings := array_append(v_warnings, 'direction_auto_applied');
  END IF;

  -- -------------------------------------------------------
  -- Auto-detect computation method from actual norm content.
  -- This makes computation_mode a documentation hint only:
  -- norms with mean+sd   → PARAMETRIC candidate
  -- norms with raw_min/max → LOOKUP candidate
  -- If both exist → stored computation_mode breaks the tie.
  -- -------------------------------------------------------
  SELECT EXISTS(
    SELECT 1 FROM public.official_norms
    WHERE subtest_id = v_effective_subtest_id
      AND (organization_id IS NULL OR organization_id = v_caller_org_id)
      AND age_min_months <= p_age_months
      AND age_max_months >= p_age_months
      AND (gender = p_gender OR gender = 'Mixed')
      AND mean IS NOT NULL AND sd IS NOT NULL AND sd > 0
  ) INTO v_has_parametric;

  SELECT EXISTS(
    SELECT 1 FROM public.official_norms
    WHERE subtest_id = v_effective_subtest_id
      AND (organization_id IS NULL OR organization_id = v_caller_org_id)
      AND age_min_months <= p_age_months
      AND age_max_months >= p_age_months
      AND (gender = p_gender OR gender = 'Mixed')
      AND raw_min IS NOT NULL AND raw_max IS NOT NULL
  ) INTO v_has_lookup;

  v_method := CASE
    WHEN v_has_parametric AND v_has_lookup
      THEN upper(COALESCE(v_subtest.computation_mode, 'PARAMETRIC'))
    WHEN v_has_parametric THEN 'PARAMETRIC'
    WHEN v_has_lookup     THEN 'LOOKUP'
    ELSE upper(COALESCE(v_subtest.computation_mode, 'LOOKUP'))  -- fallback to stored hint
  END;

  -- -------------------------------------------------------
  -- PARAMETRIC: z = (raw - mean) / sd  with direction flip
  -- -------------------------------------------------------
  IF v_method = 'PARAMETRIC' THEN
    SELECT * INTO v_norm
    FROM public.official_norms
    WHERE subtest_id = v_effective_subtest_id
      AND (organization_id IS NULL OR organization_id = v_caller_org_id)
      AND age_min_months <= p_age_months
      AND age_max_months >= p_age_months
      AND (gender = p_gender OR gender = 'Mixed')
      AND mean IS NOT NULL
      AND sd IS NOT NULL
      AND sd > 0
    ORDER BY
      CASE WHEN organization_id = v_caller_org_id THEN 0 ELSE 1 END,
      CASE WHEN gender = p_gender THEN 0 ELSE 1 END
    LIMIT 1;

    IF NOT FOUND THEN
      RETURN jsonb_build_object(
        'raw', p_raw_score,
        'standard', NULL,
        'percentile', NULL,
        'zScore', NULL,
        'norm_found', false,
        'method', 'PARAMETRIC',
        'warnings', array_append(v_warnings, 'no_norm')
      );
    END IF;

    IF v_direction = 'lower_better' THEN
      v_z := (v_norm.mean - p_raw_score) / v_norm.sd;
    ELSE
      v_z := (p_raw_score - v_norm.mean) / v_norm.sd;
    END IF;

    IF v_subtest.score_type = 'standard' THEN
      v_standard := 100 + (v_z * 15);
    ELSIF v_subtest.score_type = 'scaled' THEN
      v_standard := 10 + (v_z * 3);
    ELSIF v_subtest.score_type = 'sten' THEN
      v_standard := 5.5 + (v_z * 2);
    ELSIF v_subtest.score_type = 'stanine' THEN
      v_standard := 5 + (v_z * 2);
    ELSIF v_subtest.score_type IN ('t_score', 't-score') THEN
      v_standard := 50 + (v_z * 10);
    ELSIF v_subtest.score_type = 'percentile' THEN
      v_standard := NULL;
    ELSE
      v_standard := 100 + (v_z * 15);
    END IF;

    v_percentile := (0.5 * (1.0 + erf(v_z / sqrt(2.0)))) * 100;

    RETURN jsonb_build_object(
      'raw', p_raw_score,
      'standard', CASE WHEN v_standard IS NULL THEN NULL ELSE round(v_standard::numeric, 1) END,
      'percentile', round(v_percentile::numeric, 1),
      'zScore', round(v_z::numeric, 2),
      'norm_found', true,
      'method', 'PARAMETRIC',
      'warnings', v_warnings
    );
  END IF;

  -- -------------------------------------------------------
  -- LOOKUP: find norm row where raw_min <= score <= raw_max
  -- -------------------------------------------------------
  IF v_method = 'LOOKUP' THEN
    SELECT * INTO v_norm
    FROM public.official_norms n
    WHERE n.subtest_id = v_effective_subtest_id
      AND (n.organization_id IS NULL OR n.organization_id = v_caller_org_id)
      AND n.age_min_months <= p_age_months
      AND n.age_max_months >= p_age_months
      AND n.raw_min <= p_raw_score
      AND n.raw_max >= p_raw_score
      AND (n.gender = p_gender OR n.gender = 'Mixed')
    ORDER BY
      CASE WHEN n.organization_id = v_caller_org_id THEN 0 ELSE 1 END,
      CASE WHEN n.gender = p_gender THEN 0 ELSE 1 END,
      CASE WHEN n.raw_min IS NULL OR n.raw_max IS NULL THEN 1 ELSE 0 END,
      CASE
        WHEN n.raw_min IS NOT NULL AND n.raw_max IS NOT NULL THEN (n.raw_max - n.raw_min)
        ELSE NULL
      END ASC NULLS LAST,
      CASE WHEN v_direction = 'lower_better' THEN n.raw_min ELSE NULL END DESC NULLS LAST,
      CASE WHEN v_direction = 'higher_better' THEN n.raw_max ELSE NULL END ASC NULLS LAST,
      n.id ASC
    LIMIT 1;

    IF FOUND THEN
      -- Compute z from standard_score so callers can display percentile
      IF v_norm.standard_score IS NOT NULL AND v_subtest.score_type IS NOT NULL THEN
        IF v_subtest.score_type = 'standard' THEN
          v_scale_mean := 100.0; v_scale_sd := 15.0;
        ELSIF v_subtest.score_type = 'scaled' THEN
          v_scale_mean := 10.0; v_scale_sd := 3.0;
        ELSIF v_subtest.score_type = 'sten' THEN
          v_scale_mean := 5.5; v_scale_sd := 2.0;
        ELSIF v_subtest.score_type = 'stanine' THEN
          v_scale_mean := 5.0; v_scale_sd := 2.0;
        ELSIF v_subtest.score_type IN ('t_score', 't-score') THEN
          v_scale_mean := 50.0; v_scale_sd := 10.0;
        END IF;

        IF v_scale_mean IS NOT NULL AND v_scale_sd IS NOT NULL AND v_scale_sd > 0 THEN
          v_z := (v_norm.standard_score - v_scale_mean) / v_scale_sd;
        END IF;
      END IF;

      RETURN jsonb_build_object(
        'raw', p_raw_score,
        'standard', v_norm.standard_score,
        'percentile', v_norm.percentile,
        'zScore', CASE WHEN v_z IS NULL THEN NULL ELSE round(v_z::numeric, 2) END,
        'norm_found', true,
        'method', 'LOOKUP',
        'warnings', v_warnings
      );
    END IF;

    -- Floor score: if raw is below the lowest norm entry, use a boundary norm
    SELECT min(n.raw_min) INTO v_lowest_raw_min
    FROM public.official_norms n
    WHERE n.subtest_id = v_effective_subtest_id
      AND (n.organization_id IS NULL OR n.organization_id = v_caller_org_id)
      AND n.age_min_months <= p_age_months
      AND n.age_max_months >= p_age_months
      AND (n.gender = p_gender OR n.gender = 'Mixed')
      AND n.raw_min IS NOT NULL;

    IF v_lowest_raw_min IS NOT NULL AND p_raw_score < v_lowest_raw_min THEN
      SELECT * INTO v_floor_norm
      FROM public.official_norms n
      WHERE n.subtest_id = v_effective_subtest_id
        AND (n.organization_id IS NULL OR n.organization_id = v_caller_org_id)
        AND n.age_min_months <= p_age_months
        AND n.age_max_months >= p_age_months
        AND n.raw_min IS NULL
        AND n.raw_max IS NULL
        AND (n.gender = p_gender OR n.gender = 'Mixed')
      ORDER BY
        CASE WHEN n.organization_id = v_caller_org_id THEN 0 ELSE 1 END,
        CASE WHEN v_direction = 'lower_better' THEN n.standard_score ELSE NULL END DESC NULLS LAST,
        CASE WHEN v_direction = 'higher_better' THEN n.standard_score ELSE NULL END ASC NULLS LAST,
        n.id ASC
      LIMIT 1;

      IF FOUND THEN
        IF v_floor_norm.standard_score IS NOT NULL AND v_subtest.score_type IS NOT NULL THEN
          IF v_subtest.score_type = 'standard' THEN
            v_scale_mean := 100.0; v_scale_sd := 15.0;
          ELSIF v_subtest.score_type = 'scaled' THEN
            v_scale_mean := 10.0; v_scale_sd := 3.0;
          ELSIF v_subtest.score_type = 'sten' THEN
            v_scale_mean := 5.5; v_scale_sd := 2.0;
          ELSIF v_subtest.score_type = 'stanine' THEN
            v_scale_mean := 5.0; v_scale_sd := 2.0;
          ELSIF v_subtest.score_type IN ('t_score', 't-score') THEN
            v_scale_mean := 50.0; v_scale_sd := 10.0;
          END IF;

          IF v_scale_mean IS NOT NULL AND v_scale_sd IS NOT NULL AND v_scale_sd > 0 THEN
            v_z := (v_floor_norm.standard_score - v_scale_mean) / v_scale_sd;
          END IF;
        END IF;

        RETURN jsonb_build_object(
          'raw', p_raw_score,
          'standard', v_floor_norm.standard_score,
          'percentile', v_floor_norm.percentile,
          'zScore', CASE WHEN v_z IS NULL THEN NULL ELSE round(v_z::numeric, 2) END,
          'norm_found', true,
          'method', 'LOOKUP',
          'warnings', array_append(v_warnings, 'floor_score')
        );
      END IF;
    END IF;

    RETURN jsonb_build_object(
      'raw', p_raw_score,
      'standard', NULL,
      'percentile', NULL,
      'zScore', NULL,
      'norm_found', false,
      'method', 'LOOKUP',
      'warnings', array_append(v_warnings, 'no_norm')
    );
  END IF;

  -- Fallback: unknown method
  RETURN jsonb_build_object(
    'raw', p_raw_score,
    'standard', NULL,
    'percentile', NULL,
    'zScore', NULL,
    'norm_found', false,
    'method', 'NONE',
    'warnings', array_append(v_warnings, 'unsupported_mode')
  );
END;
$$;

COMMIT;
