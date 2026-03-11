-- =============================================================================
-- Migration : DTVP-A bilingual names + EVIC automatisation de la frappe cleanup
-- Date : 2026-03-06
-- Context :
--   1. DTVP-A (Developmental Test of Visual Perception—Adolescent and Adult)
--      subtest names shown in English (French) bilingual format per tester
--      feedback. Currently only French names are stored.
--   2. EVIC — "Automatisation de la frappe" subtest not relevant for current
--      clinical workflow; remove from catalog.
-- =============================================================================


-- =============================================================================
-- 1. DTVP-A — Subtest names: English (Français) bilingual format
--    Known test_id = 'dtvp-a' (confirmed in migration 20260305000001)
--    Subtest French names sourced from data/subtestAliases.ts
-- =============================================================================

UPDATE public.official_subtests
  SET name = 'Copying (Copie)'
  WHERE test_id = 'dtvp-a'
    AND name = 'Copie';

UPDATE public.official_subtests
  SET name = 'Figure-Ground (Figure-Fond)'
  WHERE test_id = 'dtvp-a'
    AND name = 'Figure-Fond';

UPDATE public.official_subtests
  SET name = 'Visual-Motor Search (Recherche visuo-motrice)'
  WHERE test_id = 'dtvp-a'
    AND (name = 'Recherche visuo-motrice' OR name ILIKE '%visuo-motrice%search%'
         OR name ILIKE '%recherche%visuo%');

UPDATE public.official_subtests
  SET name = 'Visual Closure (Fermeture Visuelle)'
  WHERE test_id = 'dtvp-a'
    AND (name = 'Fermeture Visuelle' OR name ILIKE '%fermeture%visuelle%');

UPDATE public.official_subtests
  SET name = 'Form Constancy (Constance de la forme)'
  WHERE test_id = 'dtvp-a'
    AND (name = 'Constance de la forme' OR name ILIKE '%constance%forme%');

UPDATE public.official_subtests
  SET name = 'Visual-Motor Speed (Vitesse visuo-motrice)'
  WHERE test_id = 'dtvp-a'
    AND (name = 'Vitesse visuo-motrice' OR name ILIKE '%vitesse%visuo%');

-- Also update composite scores to be bilingual for consistency
-- (These were renamed in the previous migration to French composite names)
-- MRP and GVP are internationally recognized acronyms — keep as-is.


-- =============================================================================
-- 2. EVIC — Remove "Automatisation de la frappe" subtest
--    This subtest is not clinically relevant for current workflow.
--    We first delete its norms, then the subtest itself.
--    Uses name-based WHERE because test_id for EVIC is not confirmed
--    in migrations (it may be a private test ID in the DB).
-- =============================================================================

DO $$
DECLARE
  v_subtest_ids TEXT[];
BEGIN
  -- Find all matching subtest IDs
  SELECT ARRAY_AGG(id) INTO v_subtest_ids
  FROM public.official_subtests
  WHERE name ILIKE '%automatisation%frappe%'
     OR name ILIKE '%automatisation de la frappe%';

  IF v_subtest_ids IS NOT NULL AND array_length(v_subtest_ids, 1) > 0 THEN
    -- Remove linked norms first (FK safety)
    DELETE FROM public.official_norms
      WHERE subtest_id = ANY(v_subtest_ids);

    -- Remove the subtests
    DELETE FROM public.official_subtests
      WHERE id = ANY(v_subtest_ids);

    RAISE NOTICE 'Deleted % "Automatisation de la frappe" subtest(s) and their norms', array_length(v_subtest_ids, 1);
  ELSE
    RAISE NOTICE 'No "Automatisation de la frappe" subtest found — nothing to delete';
  END IF;
END;
$$;
