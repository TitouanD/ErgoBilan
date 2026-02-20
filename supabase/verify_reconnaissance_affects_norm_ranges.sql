-- Verification helper: inspect age coverage for NEPSY-2 "Reconnaissance des affects" variants.
-- Expected in current dataset: COLERE covers 60-65 months.

SELECT
  s.id,
  s.name AS subtest_name,
  s.abbreviation,
  s.organization_id,
  COUNT(n.*) AS norm_rows,
  MIN(n.age_min_months) AS min_age_months,
  MAX(n.age_max_months) AS max_age_months
FROM public.official_subtests s
LEFT JOIN public.official_norms n ON n.subtest_id = s.id
WHERE s.test_id = 'nepsy-2'
  AND norm_subtest_name(s.name) = norm_subtest_name('Reconnaissance des affects')
GROUP BY s.id, s.name, s.abbreviation, s.organization_id
ORDER BY s.organization_id NULLS FIRST, s.abbreviation NULLS FIRST, s.id;
