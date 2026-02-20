-- Fix mis-mapped secondary grade ages in L'Espargot parametric norms.
-- Source issue: secondary classes (6e/4e/2nde) were interpreted as ages 6/4/2 years
-- and stored as 72/48/24 months instead of 132/156/180 months.

WITH target_rows AS (
  SELECT
    n.id,
    n.age_min_months,
    n.age_max_months
  FROM public.official_norms n
  JOIN public.official_subtests s ON s.id = n.subtest_id
  WHERE s.test_id = 'espargot'
    AND s.computation_mode = 'PARAMETRIC'
    AND n.age_min_months IN (24, 48, 72)
    AND n.age_max_months IN (35, 59, 83)
    AND (n.age_max_months - n.age_min_months) = 11
    AND EXISTS (
      SELECT 1
      FROM public.official_norms n2
      WHERE n2.subtest_id = n.subtest_id
        AND n2.age_min_months BETWEEN 84 AND 120
        AND n2.age_max_months BETWEEN 95 AND 131
    )
)
UPDATE public.official_norms n
SET
  age_min_months = tr.age_min_months + 108,
  age_max_months = tr.age_max_months + 108
FROM target_rows tr
WHERE n.id = tr.id;
