
-- ============================================================
-- PHASE 1: Merge code-style named duplicate subtests in MABC-2
-- Move norms from source to target, then delete source subtest
-- ============================================================

-- 1a. "mabc2_catching_2_hands" (13 norms) → "Attraper avec 2 mains" (18 norms)
UPDATE official_norms
SET subtest_id = 'priv_4359d797_f841cdf0_attraper_avec_2_mains_catching_2_hands_'
WHERE subtest_id = 'priv_4359d797_f841cdf0_mabc2_catching_2_hands'
  AND NOT EXISTS (
    SELECT 1 FROM official_norms existing
    WHERE existing.subtest_id = 'priv_4359d797_f841cdf0_attraper_avec_2_mains_catching_2_hands_'
      AND existing.age_min_months IS NOT DISTINCT FROM official_norms.age_min_months
      AND existing.age_max_months IS NOT DISTINCT FROM official_norms.age_max_months
      AND existing.gender IS NOT DISTINCT FROM official_norms.gender
      AND existing.raw_min IS NOT DISTINCT FROM official_norms.raw_min
      AND existing.raw_max IS NOT DISTINCT FROM official_norms.raw_max
      AND existing.mean IS NOT DISTINCT FROM official_norms.mean
      AND existing.sd IS NOT DISTINCT FROM official_norms.sd
      AND existing.standard_score IS NOT DISTINCT FROM official_norms.standard_score
      AND existing.percentile IS NOT DISTINCT FROM official_norms.percentile
  );
-- Delete leftover duplicate norms that couldn't be moved
DELETE FROM official_norms WHERE subtest_id = 'priv_4359d797_f841cdf0_mabc2_catching_2_hands';
-- Delete the source subtest
DELETE FROM official_subtests WHERE id = 'priv_4359d797_f841cdf0_mabc2_catching_2_hands';

-- 1b. "mabc2_pegs_preferred_hand" (28 norms) → "Chevilles main préférée" (27 norms)
UPDATE official_norms
SET subtest_id = 'priv_4359d797_f841cdf0_chevilles_main_pr_f_r_e_pegboard_preferred_hand_'
WHERE subtest_id = 'priv_4359d797_f841cdf0_mabc2_pegs_preferred_hand'
  AND NOT EXISTS (
    SELECT 1 FROM official_norms existing
    WHERE existing.subtest_id = 'priv_4359d797_f841cdf0_chevilles_main_pr_f_r_e_pegboard_preferred_hand_'
      AND existing.age_min_months IS NOT DISTINCT FROM official_norms.age_min_months
      AND existing.age_max_months IS NOT DISTINCT FROM official_norms.age_max_months
      AND existing.gender IS NOT DISTINCT FROM official_norms.gender
      AND existing.raw_min IS NOT DISTINCT FROM official_norms.raw_min
      AND existing.raw_max IS NOT DISTINCT FROM official_norms.raw_max
      AND existing.mean IS NOT DISTINCT FROM official_norms.mean
      AND existing.sd IS NOT DISTINCT FROM official_norms.sd
      AND existing.standard_score IS NOT DISTINCT FROM official_norms.standard_score
      AND existing.percentile IS NOT DISTINCT FROM official_norms.percentile
  );
DELETE FROM official_norms WHERE subtest_id = 'priv_4359d797_f841cdf0_mabc2_pegs_preferred_hand';
DELETE FROM official_subtests WHERE id = 'priv_4359d797_f841cdf0_mabc2_pegs_preferred_hand';

-- ============================================================
-- PHASE 2: Delete 0-norm seed subtests that duplicate norm-bearing subtests
-- ============================================================
DELETE FROM official_subtests WHERE id IN (
  'mabc-2__catching',          -- "Attraper une balle" (0 norms) ≈ "Attraper sac"/"Attraper avec 2 mains"
  'mabc-2__aiming-catching',   -- "Visée et Réception" (0 norms) ≈ "Viser et attraper" (19 norms)
  'mabc-2__jumping',           -- "Sauts sur tapis / cases" (0 norms) ≈ "Sauter sur tapis" (13 norms)
  'mabc-2__threading-lace',    -- "Enfiler une cordelette / jetons" (0 norms) ≈ "Lacet" (26 norms)
  'mabc-2__placing-pegs',      -- "Placer des chevilles" (0 norms) ≈ "Chevilles main préférée" (27 norms)
  'mabc-2__drawing-trail',     -- "Tracé d'un chemin" (0 norms) ≈ "Trajet 1" (25 norms)
  'mabc-2__throwing',          -- "Lancer un sac de grains sur cible" (0 norms) ≈ "Lancer sur cible" (40 norms)
  'mabc-2__balance-one-leg',   -- "Équilibre statique (une jambe)" (0 norms) ≈ "Équilibre sur 1 jambe ..." (23 norms each)
  'mabc-2__heel-to-toe'        -- "Marche talon-pointe" (0 norms) ≈ "Marcher sur pointe des pieds" (22 norms)
);

-- ============================================================
-- PHASE 3: Rename code-style and prefixed subtests to clean French names
-- ============================================================
UPDATE official_subtests SET name = 'Tracé du chemin (Bande 2)'
WHERE id = 'priv_4359d797_f841cdf0_mabc2_path_2_errors';

UPDATE official_subtests SET name = 'Écrous et boulons'
WHERE id = 'priv_4359d797_f841cdf0_m_abc_2_ecrous_et_boulons';

UPDATE official_subtests SET name = 'Retourner chevilles - main préférée'
WHERE id = 'priv_4359d797_f841cdf0_m_abc_2_retourner_chevilles_main_pr_f_r_e';

UPDATE official_subtests SET name = 'Attraper avec 1 main - meilleure main'
WHERE id = 'priv_4359d797_f841cdf0_m_abc_2_attraper_avec_1_main_meilleure_main';

-- ============================================================
-- PHASE 4: Delete seed tests that clearly duplicate real tests
-- (0 subtests, 0 norms, 0 session references)
-- ============================================================
DELETE FROM official_tests WHERE id = 'mabc' AND author = 'seed';     -- superseded by MABC-2
DELETE FROM official_tests WHERE id = 'cloches-test' AND author = 'seed'; -- superseded by Test des Cloches
DELETE FROM official_tests WHERE id = 'h-test' AND author = 'seed';   -- superseded by Barrage des H
DELETE FROM official_tests WHERE id = 'vmi' AND author = 'seed';      -- superseded by Beery VMI (seed, has subtests)
;
