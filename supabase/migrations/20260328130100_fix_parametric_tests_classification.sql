-- =============================================================================
-- Migration: Fix computation_mode, score_type and raw_direction for
--   Barrage des H, BHK, Test des Cloches
-- Date: 2026-03-28
-- Problem:
--   These 3 tests have norms with only mean/sd columns populated (PARAMETRIC),
--   but computation_mode='NONE' prevents the compute_score RPC from using them.
--   score_type='none' is also wrong — they output standard scores (z-based).
-- Fix:
--   Set computation_mode='PARAMETRIC', score_type='standard', and the correct
--   raw_direction per subtest (clinical logic + matches original publications).
-- =============================================================================

-- ─── Barrage des H ───────────────────────────────────────────────────────────
-- "Nombre de cibles barrées": more targets found = better
UPDATE public.official_subtests
SET computation_mode = 'PARAMETRIC',
    score_type       = 'standard',
    raw_direction    = 'higher_better'
WHERE id = 'barrage-h__cibles';
-- "Temps total (secondes)": faster (lower time) = better
UPDATE public.official_subtests
SET computation_mode = 'PARAMETRIC',
    score_type       = 'standard',
    raw_direction    = 'lower_better'
WHERE id = 'barrage-h__temps';
-- ─── BHK ─────────────────────────────────────────────────────────────────────
-- "Qualité": score is a defect count — fewer defects = better
UPDATE public.official_subtests
SET computation_mode = 'PARAMETRIC',
    score_type       = 'standard',
    raw_direction    = 'lower_better'
WHERE id = 'bhk__quality';
-- "Vitesse": letters written in 5 min — more = better
UPDATE public.official_subtests
SET computation_mode = 'PARAMETRIC',
    score_type       = 'standard',
    raw_direction    = 'higher_better'
WHERE id = 'bhk__speed';
-- ─── Test des Cloches ────────────────────────────────────────────────────────
-- "Nombre de cloches repérées (/35)": more found = better
UPDATE public.official_subtests
SET computation_mode = 'PARAMETRIC',
    score_type       = 'standard',
    raw_direction    = 'higher_better'
WHERE id = 'test-cloches__cibles';
