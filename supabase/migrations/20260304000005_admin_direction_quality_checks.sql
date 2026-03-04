-- ============================================================
-- Migration: 20260304000005 — Admin direction quality checks
--
-- Adds admin_list_direction_issues() SECURITY DEFINER RPC.
-- Returns subtest-level direction quality issues in two categories:
--
--   DIRECTION_AUTO_WITH_NORMS
--     raw_direction = 'auto' but the subtest already has norms.
--     At score time, compute_score_core will fall back to the name-regex
--     and add 'direction_auto_applied' to warnings. This is NEVER acceptable
--     for official subtests and should be treated as a blocking issue.
--
--   DIRECTION_NAME_MISMATCH
--     raw_direction = 'higher_better' but the subtest name contains a keyword
--     that typically signals a "lower is better" measure (temps, erreurs, …).
--     May be intentional (e.g. "temps de reaction qualite" scored positively),
--     but warrants admin review and explicit confirmation.
--
-- Security: check_is_admin() guard. Reads official_subtests and official_tests
--           directly (function is SECURITY DEFINER / owner = postgres).
-- ============================================================

CREATE OR REPLACE FUNCTION public.admin_list_direction_issues()
RETURNS TABLE (
    subtest_id        text,
    subtest_name      text,
    test_id           text,
    test_name         text,
    current_direction text,
    issue_code        text,
    issue_label       text,
    details           text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
    IF NOT check_is_admin() THEN
        RAISE EXCEPTION 'admin_list_direction_issues: not authorized' USING ERRCODE = '42501';
    END IF;

    -- -------------------------------------------------------
    -- Issue 1: raw_direction='auto' but norms already exist.
    -- Any scored subtest in this state will use the name-regex
    -- fallback server-side (adds 'direction_auto_applied' warning).
    -- -------------------------------------------------------
    RETURN QUERY
    SELECT
        s.id                                                AS subtest_id,
        s.name                                              AS subtest_name,
        s.test_id                                           AS test_id,
        t.name                                              AS test_name,
        s.raw_direction                                     AS current_direction,
        'DIRECTION_AUTO_WITH_NORMS'::text                   AS issue_code,
        'Direction non définie (normes présentes)'::text    AS issue_label,
        format(
            'Ce sous-test possède %s norme(s) mais raw_direction=''auto''. '
            'Le sens de scoring sera inféré par regex sur le nom au moment du calcul, '
            'ce qui peut produire des résultats incorrects. '
            'Définir explicitement raw_direction dans la bibliothèque admin.',
            (SELECT COUNT(*) FROM public.official_norms n WHERE n.subtest_id = s.id)
        )                                                   AS details
    FROM public.official_subtests s
    JOIN public.official_tests t ON t.id = s.test_id
    WHERE s.raw_direction = 'auto'
      AND EXISTS (SELECT 1 FROM public.official_norms n WHERE n.subtest_id = s.id)
      AND s.is_override_clone = false;

    -- -------------------------------------------------------
    -- Issue 2: DB says higher_better but name contains a
    -- lower-is-better keyword → possible mislabelling.
    -- Only checks official non-clone subtests (org = NULL)
    -- to avoid surfacing intentional org overrides.
    -- -------------------------------------------------------
    RETURN QUERY
    SELECT
        s.id                                                AS subtest_id,
        s.name                                              AS subtest_name,
        s.test_id                                           AS test_id,
        t.name                                              AS test_name,
        s.raw_direction                                     AS current_direction,
        'DIRECTION_NAME_MISMATCH'::text                     AS issue_code,
        'Sens suspect (nom ↔ DB)'::text                     AS issue_label,
        format(
            'raw_direction=''higher_better'' mais le nom contient le terme « %s », '
            'qui indique généralement une mesure "moins c''est mieux". '
            'Vérifier si ce sens est intentionnel et, si oui, aucune action requise.',
            (regexp_matches(lower(s.name),
                '(temps|latence|erreur|fautes|qualite|qualité|duree|durée|delai|délai)'))[1]
        )                                                   AS details
    FROM public.official_subtests s
    JOIN public.official_tests t ON t.id = s.test_id
    WHERE s.raw_direction = 'higher_better'
      AND lower(s.name) ~ '(temps|latence|erreur|fautes|qualite|qualit[eé]|dur[eé]e|d[eé]lai)'
      AND s.is_override_clone = false
      AND s.organization_id IS NULL;

END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_list_direction_issues() TO authenticated;

COMMENT ON FUNCTION public.admin_list_direction_issues IS
    'Admin-only RPC. Returns subtest-level direction quality issues: '
    'DIRECTION_AUTO_WITH_NORMS (blocking) and DIRECTION_NAME_MISMATCH (warning). '
    'See migration 20260304000005 for details.';
