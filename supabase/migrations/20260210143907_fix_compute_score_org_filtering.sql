
CREATE OR REPLACE FUNCTION compute_score(
  p_subtest_id text,
  p_raw_score real,
  p_age_months int,
  p_gender text DEFAULT 'Mixed',
  p_class_level text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_caller_org_id uuid;
  v_subtest       record;
  v_norm          record;
  v_lookup        record;
  v_z             real;
  v_standard      real;
  v_percentile    real;
BEGIN
  -- 0. Resolve caller's organization
  SELECT om.organization_id INTO v_caller_org_id
  FROM organization_members om
  WHERE om.user_id = auth.uid()
  LIMIT 1;

  -- 1. Fetch subtest definition (public OR caller's org)
  SELECT * INTO v_subtest
  FROM public.official_subtests
  WHERE id = p_subtest_id
    AND (organization_id IS NULL OR organization_id = v_caller_org_id)
  LIMIT 1;

  IF v_subtest IS NULL THEN
    RETURN NULL;
  END IF;

  -- 2. PARAMETRIC: find applicable norm (public + own org only)
  SELECT * INTO v_norm
  FROM public.official_norms
  WHERE subtest_id = p_subtest_id
    AND (organization_id IS NULL OR organization_id = v_caller_org_id)
    AND age_min_months <= p_age_months
    AND age_max_months >= p_age_months
    AND (gender = p_gender OR gender = 'Mixed')
  ORDER BY
    CASE WHEN organization_id = v_caller_org_id THEN 0 ELSE 1 END,  -- prefer own org norms
    CASE WHEN gender = p_gender THEN 0 ELSE 1 END
  LIMIT 1;

  IF v_norm IS NULL THEN
    RETURN NULL;
  END IF;

  -- 3. BRANCH A: PARAMETRIC
  IF v_norm.mean IS NOT NULL AND v_norm.sd IS NOT NULL AND v_norm.sd > 0 THEN
    v_z := (p_raw_score - v_norm.mean) / v_norm.sd;

    IF v_subtest.score_type = 'standard' THEN
      v_standard := 100 + (v_z * 15);
    ELSIF v_subtest.score_type = 'scaled' THEN
      v_standard := 10 + (v_z * 3);
    ELSIF v_subtest.score_type = 'sten' THEN
      v_standard := 5.5 + (v_z * 2);
    ELSIF v_subtest.score_type IN ('t_score', 't-score') THEN
      v_standard := 50 + (v_z * 10);
    ELSE
      v_standard := 100 + (v_z * 15);
    END IF;

    v_percentile := (0.5 * (1.0 + erf(v_z / sqrt(2.0)))) * 100;

    RETURN jsonb_build_object(
      'raw', p_raw_score,
      'standard', round(v_standard::numeric, 1),
      'percentile', round(v_percentile::numeric, 1),
      'zScore', round(v_z::numeric, 2),
      'method', 'PARAMETRIC'
    );
  END IF;

  -- 4. BRANCH B: LOOKUP (same org filter)
  SELECT * INTO v_lookup
  FROM public.official_norms
  WHERE subtest_id = p_subtest_id
    AND (organization_id IS NULL OR organization_id = v_caller_org_id)
    AND age_min_months <= p_age_months
    AND age_max_months >= p_age_months
    AND raw_min <= p_raw_score
    AND raw_max >= p_raw_score
    AND (gender = p_gender OR gender = 'Mixed')
  ORDER BY
    CASE WHEN organization_id = v_caller_org_id THEN 0 ELSE 1 END,
    CASE WHEN gender = p_gender THEN 0 ELSE 1 END
  LIMIT 1;

  IF v_lookup IS NOT NULL THEN
    RETURN jsonb_build_object(
      'raw', p_raw_score,
      'standard', COALESCE(v_lookup.standard_score, 0),
      'percentile', COALESCE(v_lookup.percentile, 0),
      'zScore', 0,
      'method', 'LOOKUP'
    );
  END IF;

  RETURN NULL;
END;
$$;
;
