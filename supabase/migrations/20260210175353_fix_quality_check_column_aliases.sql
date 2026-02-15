
CREATE OR REPLACE FUNCTION admin_norm_quality_check(
  p_test_id uuid DEFAULT NULL,
  p_subtest_id text DEFAULT NULL
)
RETURNS TABLE(norm_id uuid, subtest_id text, subtest_name text, flag_code text, flag_label text, details text)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT check_is_admin() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT * FROM (

    -- 1) Inverted age range
    SELECT n.id AS norm_id, n.subtest_id, s.name AS subtest_name,
           'AGE_INVERTED'::text AS flag_code, 'Tranche d''âge inversée'::text AS flag_label,
           format('min=%s > max=%s', n.age_min_months, n.age_max_months)::text AS details
    FROM official_norms n
    JOIN official_subtests s ON s.id = n.subtest_id
    WHERE (p_test_id IS NULL OR s.test_id = p_test_id)
      AND (p_subtest_id IS NULL OR n.subtest_id = p_subtest_id)
      AND n.age_min_months IS NOT NULL AND n.age_max_months IS NOT NULL
      AND n.age_min_months > n.age_max_months

    UNION ALL

    -- 2) Inverted raw score range
    SELECT n.id, n.subtest_id, s.name,
           'RAW_INVERTED'::text, 'Scores bruts inversés'::text,
           format('raw_min=%s > raw_max=%s', n.raw_min, n.raw_max)::text
    FROM official_norms n
    JOIN official_subtests s ON s.id = n.subtest_id
    WHERE (p_test_id IS NULL OR s.test_id = p_test_id)
      AND (p_subtest_id IS NULL OR n.subtest_id = p_subtest_id)
      AND n.raw_min IS NOT NULL AND n.raw_max IS NOT NULL
      AND n.raw_min > n.raw_max

    UNION ALL

    -- 3) Standard score out of plausible range
    SELECT n.id, n.subtest_id, s.name,
           'SCORE_IMPLAUSIBLE'::text, 'Score standard hors limites'::text,
           format('standard_score=%s', n.standard_score)::text
    FROM official_norms n
    JOIN official_subtests s ON s.id = n.subtest_id
    WHERE (p_test_id IS NULL OR s.test_id = p_test_id)
      AND (p_subtest_id IS NULL OR n.subtest_id = p_subtest_id)
      AND n.standard_score IS NOT NULL
      AND (n.standard_score < 1 OR n.standard_score > 200)

    UNION ALL

    -- 4) Negative SD
    SELECT n.id, n.subtest_id, s.name,
           'NEGATIVE_SD'::text, 'Écart-type négatif'::text,
           format('sd=%s', n.sd)::text
    FROM official_norms n
    JOIN official_subtests s ON s.id = n.subtest_id
    WHERE (p_test_id IS NULL OR s.test_id = p_test_id)
      AND (p_subtest_id IS NULL OR n.subtest_id = p_subtest_id)
      AND n.sd IS NOT NULL AND n.sd < 0

    UNION ALL

    -- 5) Percentile out of range
    SELECT n.id, n.subtest_id, s.name,
           'PERCENTILE_OOB'::text, 'Percentile hors [0-100]'::text,
           format('percentile=%s', n.percentile)::text
    FROM official_norms n
    JOIN official_subtests s ON s.id = n.subtest_id
    WHERE (p_test_id IS NULL OR s.test_id = p_test_id)
      AND (p_subtest_id IS NULL OR n.subtest_id = p_subtest_id)
      AND n.percentile IS NOT NULL
      AND (n.percentile < 0 OR n.percentile > 100)

    UNION ALL

    -- 6) LOOKUP subtest with no standard_score
    SELECT n.id, n.subtest_id, s.name,
           'LOOKUP_NO_SCORE'::text, 'Norme LOOKUP sans score standard'::text,
           'standard_score is NULL'::text
    FROM official_norms n
    JOIN official_subtests s ON s.id = n.subtest_id
    WHERE (p_test_id IS NULL OR s.test_id = p_test_id)
      AND (p_subtest_id IS NULL OR n.subtest_id = p_subtest_id)
      AND s.computation_mode = 'LOOKUP'
      AND n.standard_score IS NULL

    UNION ALL

    -- 7) PARAMETRIC subtest missing mean or sd
    SELECT n.id, n.subtest_id, s.name,
           'PARAM_INCOMPLETE'::text, 'Norme PARAMETRIC sans mean ou sd'::text,
           format('mean=%s, sd=%s', n.mean, n.sd)::text
    FROM official_norms n
    JOIN official_subtests s ON s.id = n.subtest_id
    WHERE (p_test_id IS NULL OR s.test_id = p_test_id)
      AND (p_subtest_id IS NULL OR n.subtest_id = p_subtest_id)
      AND s.computation_mode = 'PARAMETRIC'
      AND (n.mean IS NULL OR n.sd IS NULL)

    UNION ALL

    -- 8) Very wide age range (> 120 months)
    SELECT n.id, n.subtest_id, s.name,
           'AGE_TOO_WIDE'::text, 'Tranche d''âge très large (>10 ans)'::text,
           format('%s-%s mois (delta=%s)', n.age_min_months, n.age_max_months, n.age_max_months - n.age_min_months)::text
    FROM official_norms n
    JOIN official_subtests s ON s.id = n.subtest_id
    WHERE (p_test_id IS NULL OR s.test_id = p_test_id)
      AND (p_subtest_id IS NULL OR n.subtest_id = p_subtest_id)
      AND n.age_min_months IS NOT NULL AND n.age_max_months IS NOT NULL
      AND (n.age_max_months - n.age_min_months) > 120

  ) AS all_flags
  ORDER BY all_flags.subtest_id, all_flags.flag_code;
END;
$$;
;
