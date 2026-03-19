-- =============================================================================
-- Migration : Catalog quality checks view + function
-- Date : 2026-03-18
-- =============================================================================

CREATE OR REPLACE VIEW public.view_catalog_quality_issues AS
WITH tests_without_subtests AS (
  SELECT
    'TEST_WITHOUT_SUBTESTS'::text AS issue_code,
    t.id AS test_id,
    t.name AS test_name,
    NULL::text AS subtest_id,
    NULL::text AS subtest_name,
    'Test visible sans sous-test'::text AS detail
  FROM public.official_tests t
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.official_subtests st
    WHERE st.test_id = t.id
  )
),
lookup_without_norms AS (
  SELECT
    'LOOKUP_WITHOUT_NORMS'::text AS issue_code,
    t.id AS test_id,
    t.name AS test_name,
    st.id AS subtest_id,
    st.name AS subtest_name,
    'Sous-test en LOOKUP sans norme'::text AS detail
  FROM public.official_tests t
  JOIN public.official_subtests st ON st.test_id = t.id
  WHERE st.computation_mode = 'LOOKUP'
    AND NOT EXISTS (
      SELECT 1
      FROM public.official_norms n
      WHERE n.subtest_id = st.id
    )
),
score_mode_mismatch AS (
  SELECT
    'SCORE_MODE_MISMATCH'::text AS issue_code,
    t.id AS test_id,
    t.name AS test_name,
    st.id AS subtest_id,
    st.name AS subtest_name,
    'score_type=none mais computation_mode<>NONE'::text AS detail
  FROM public.official_tests t
  JOIN public.official_subtests st ON st.test_id = t.id
  WHERE st.score_type = 'none'
    AND st.computation_mode <> 'NONE'
),
duplicate_names AS (
  SELECT
    'DUPLICATE_SUBTEST_NAME'::text AS issue_code,
    t.id AS test_id,
    t.name AS test_name,
    NULL::text AS subtest_id,
    d.lname AS subtest_name,
    ('Nom dupliqué x' || d.c)::text AS detail
  FROM (
    SELECT test_id, lower(trim(name)) AS lname, count(*) AS c
    FROM public.official_subtests
    GROUP BY test_id, lower(trim(name))
    HAVING count(*) > 1
  ) d
  JOIN public.official_tests t ON t.id = d.test_id
)
SELECT * FROM tests_without_subtests
UNION ALL
SELECT * FROM lookup_without_norms
UNION ALL
SELECT * FROM score_mode_mismatch
UNION ALL
SELECT * FROM duplicate_names;


CREATE OR REPLACE FUNCTION public.admin_catalog_quality_summary()
RETURNS TABLE (
  issue_code text,
  issues_count bigint
)
LANGUAGE sql
STABLE
AS $$
  SELECT issue_code, count(*)::bigint AS issues_count
  FROM public.view_catalog_quality_issues
  GROUP BY issue_code
  ORDER BY issue_code;
$$;
