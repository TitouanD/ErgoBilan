-- Exempt percentile and unresolved-none lookup subtests from LOOKUP_NO_SCORE quality flag.
-- Add a dedicated SCORE_TYPE_UNSET issue to force admin review when score_type='none'.

CREATE OR REPLACE FUNCTION public.admin_norm_quality_check(
  p_test_id text DEFAULT NULL::text,
  p_subtest_id text DEFAULT NULL::text
)
RETURNS TABLE(
  norm_id uuid,
  subtest_id text,
  subtest_name text,
  flag_code text,
  flag_label text,
  details text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT check_is_admin() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT
      n.*,
      s.name AS subtest_name,
      s.test_id,
      s.computation_mode,
      s.score_type
    FROM official_norms n
    JOIN official_subtests s ON s.id = n.subtest_id
    WHERE (p_test_id IS NULL OR s.test_id = p_test_id)
      AND (p_subtest_id IS NULL OR n.subtest_id = p_subtest_id)
  ),
  age_ordered AS (
    SELECT
      b.id AS norm_id,
      b.subtest_id,
      b.subtest_name,
      b.gender,
      b.age_min_months,
      b.age_max_months,
      lag(b.age_min_months) OVER (PARTITION BY b.subtest_id, b.gender ORDER BY b.age_min_months, b.age_max_months) AS prev_age_min,
      lag(b.age_max_months) OVER (PARTITION BY b.subtest_id, b.gender ORDER BY b.age_min_months, b.age_max_months) AS prev_age_max
    FROM base b
    WHERE b.computation_mode = 'PARAMETRIC'
      AND b.age_min_months IS NOT NULL
      AND b.age_max_months IS NOT NULL
  ),
  all_flags AS (
    SELECT * FROM (
      -- 1) Inverted age range
      SELECT
        b.id AS norm_id,
        b.subtest_id AS subtest_id,
        b.subtest_name AS subtest_name,
        'AGE_INVERTED'::text AS flag_code,
        'Tranche d''age inversee'::text AS flag_label,
        format('min=%s > max=%s', b.age_min_months, b.age_max_months)::text AS details
      FROM base b
      WHERE b.age_min_months IS NOT NULL
        AND b.age_max_months IS NOT NULL
        AND b.age_min_months > b.age_max_months

      UNION ALL

      -- 2) Inverted raw score range
      SELECT
        b.id AS norm_id,
        b.subtest_id AS subtest_id,
        b.subtest_name AS subtest_name,
        'RAW_INVERTED'::text AS flag_code,
        'Scores bruts inverses'::text AS flag_label,
        format('raw_min=%s > raw_max=%s', b.raw_min, b.raw_max)::text AS details
      FROM base b
      WHERE b.raw_min IS NOT NULL
        AND b.raw_max IS NOT NULL
        AND b.raw_min > b.raw_max

      UNION ALL

      -- 3) Standard score out of plausible range
      SELECT
        b.id AS norm_id,
        b.subtest_id AS subtest_id,
        b.subtest_name AS subtest_name,
        'SCORE_IMPLAUSIBLE'::text AS flag_code,
        'Score standard hors limites'::text AS flag_label,
        format('standard_score=%s', b.standard_score)::text AS details
      FROM base b
      WHERE b.standard_score IS NOT NULL
        AND (b.standard_score < 1 OR b.standard_score > 200)

      UNION ALL

      -- 4) Negative SD
      SELECT
        b.id AS norm_id,
        b.subtest_id AS subtest_id,
        b.subtest_name AS subtest_name,
        'NEGATIVE_SD'::text AS flag_code,
        'Ecart-type negatif'::text AS flag_label,
        format('sd=%s', b.sd)::text AS details
      FROM base b
      WHERE b.sd IS NOT NULL
        AND b.sd < 0

      UNION ALL

      -- 4b) Zero SD
      SELECT
        b.id AS norm_id,
        b.subtest_id AS subtest_id,
        b.subtest_name AS subtest_name,
        'ZERO_SD'::text AS flag_code,
        'Ecart-type nul'::text AS flag_label,
        format('sd=%s', b.sd)::text AS details
      FROM base b
      WHERE b.sd IS NOT NULL
        AND b.sd = 0

      UNION ALL

      -- 5) Percentile out of range
      SELECT
        b.id AS norm_id,
        b.subtest_id AS subtest_id,
        b.subtest_name AS subtest_name,
        'PERCENTILE_OOB'::text AS flag_code,
        'Percentile hors [0-100]'::text AS flag_label,
        format('percentile=%s', b.percentile)::text AS details
      FROM base b
      WHERE b.percentile IS NOT NULL
        AND (b.percentile < 0 OR b.percentile > 100)

      UNION ALL

      -- 6) LOOKUP subtest with no standard_score
      -- Exempt percentile and unresolved-none score types.
      SELECT
        b.id AS norm_id,
        b.subtest_id AS subtest_id,
        b.subtest_name AS subtest_name,
        'LOOKUP_NO_SCORE'::text AS flag_code,
        'Norme LOOKUP sans score standard'::text AS flag_label,
        'standard_score is NULL'::text AS details
      FROM base b
      WHERE b.computation_mode = 'LOOKUP'
        AND COALESCE(lower(b.score_type), 'standard') NOT IN ('percentile', 'none')
        AND b.standard_score IS NULL

      UNION ALL

      -- 6b) LOOKUP subtest with inconsistent raw range (one null, one not)
      SELECT
        b.id AS norm_id,
        b.subtest_id AS subtest_id,
        b.subtest_name AS subtest_name,
        'LOOKUP_MISSING_RAW'::text AS flag_code,
        'Norme LOOKUP avec raw_min/raw_max incoherent (un seul est null)'::text AS flag_label,
        format('raw_min=%s, raw_max=%s', b.raw_min, b.raw_max)::text AS details
      FROM base b
      WHERE b.computation_mode = 'LOOKUP'
        AND ((b.raw_min IS NULL) != (b.raw_max IS NULL))

      UNION ALL

      -- 6c) score_type unresolved -> one issue per subtest (admin review required)
      SELECT
        (array_agg(b.id ORDER BY b.id))[1] AS norm_id,
        b.subtest_id AS subtest_id,
        max(b.subtest_name) AS subtest_name,
        'SCORE_TYPE_UNSET'::text AS flag_code,
        'Sous-test sans type de score (review admin requise)'::text AS flag_label,
        format('score_type=none, mode=%s, normes=%s', max(b.computation_mode), count(*))::text AS details
      FROM base b
      WHERE COALESCE(lower(b.score_type), 'none') = 'none'
      GROUP BY b.subtest_id

      UNION ALL

      -- 7) PARAMETRIC subtest missing mean or sd
      SELECT
        b.id AS norm_id,
        b.subtest_id AS subtest_id,
        b.subtest_name AS subtest_name,
        'PARAM_INCOMPLETE'::text AS flag_code,
        'Norme PARAMETRIC sans mean ou sd'::text AS flag_label,
        format('mean=%s, sd=%s', b.mean, b.sd)::text AS details
      FROM base b
      WHERE b.computation_mode = 'PARAMETRIC'
        AND (b.mean IS NULL OR b.sd IS NULL)

      UNION ALL

      -- 8) Very wide age range (> 120 months), excluding open-ended sentinel rows.
      SELECT
        b.id AS norm_id,
        b.subtest_id AS subtest_id,
        b.subtest_name AS subtest_name,
        'AGE_TOO_WIDE'::text AS flag_code,
        'Tranche d''age tres large (>10 ans)'::text AS flag_label,
        format('%s-%s mois (delta=%s)', b.age_min_months, b.age_max_months, b.age_max_months - b.age_min_months)::text AS details
      FROM base b
      WHERE b.age_min_months IS NOT NULL
        AND b.age_max_months IS NOT NULL
        AND b.age_max_months <> 999
        AND (b.age_max_months - b.age_min_months) > 120

      UNION ALL

      -- 9) Overlapping age ranges (PARAMETRIC only)
      SELECT
        a.norm_id AS norm_id,
        a.subtest_id AS subtest_id,
        a.subtest_name AS subtest_name,
        'AGE_OVERLAP'::text AS flag_code,
        'Tranches d''age qui se chevauchent'::text AS flag_label,
        format('prev=%s-%s, curr=%s-%s', a.prev_age_min, a.prev_age_max, a.age_min_months, a.age_max_months)::text AS details
      FROM age_ordered a
      WHERE a.prev_age_max IS NOT NULL
        AND a.age_min_months < a.prev_age_max

      UNION ALL

      -- 10) Gaps in age ranges (PARAMETRIC only)
      SELECT
        a.norm_id AS norm_id,
        a.subtest_id AS subtest_id,
        a.subtest_name AS subtest_name,
        'AGE_GAP'::text AS flag_code,
        'Trou d''age entre deux tranches'::text AS flag_label,
        format('prev=%s-%s, curr=%s-%s', a.prev_age_min, a.prev_age_max, a.age_min_months, a.age_max_months)::text AS details
      FROM age_ordered a
      WHERE a.prev_age_max IS NOT NULL
        AND a.age_min_months > a.prev_age_max + 1
    ) flagged
  )
  SELECT
    af.norm_id,
    af.subtest_id,
    af.subtest_name,
    af.flag_code,
    af.flag_label,
    af.details
  FROM all_flags af
  LEFT JOIN public.admin_norm_issue_overrides o
    ON o.norm_id = af.norm_id
   AND o.flag_code = af.flag_code
   AND o.dismissed = true
  WHERE o.norm_id IS NULL
  ORDER BY af.subtest_id, af.flag_code;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.admin_norm_quality_check(text, text) TO authenticated;
