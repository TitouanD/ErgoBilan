-- Unify scoring RPC on compute_score (remove compute_score_v2)
-- Date: 2026-02-15

BEGIN;

CREATE OR REPLACE FUNCTION public.compute_score(
  p_subtest_id text,
  p_raw_score real,
  p_age_months integer,
  p_gender text DEFAULT 'Mixed',
  p_class_level text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_org_id uuid;
  v_subtest record;
  v_norm record;
  v_method text;
  v_z real;
  v_standard real;
  v_percentile real;
BEGIN
  SELECT om.organization_id INTO v_caller_org_id
  FROM organization_members om
  WHERE om.user_id = auth.uid()
  LIMIT 1;

  SELECT * INTO v_subtest
  FROM public.official_subtests
  WHERE id = p_subtest_id
    AND (organization_id IS NULL OR organization_id = v_caller_org_id)
  LIMIT 1;

  IF v_subtest IS NULL THEN
    RETURN jsonb_build_object(
      'raw', p_raw_score,
      'standard', NULL,
      'percentile', NULL,
      'zScore', NULL,
      'norm_found', false,
      'method', 'NONE',
      'warnings', ARRAY['subtest_not_found']
    );
  END IF;

  v_method := upper(COALESCE(v_subtest.computation_mode, 'LOOKUP'));

  IF v_method = 'PARAMETRIC' THEN
    SELECT * INTO v_norm
    FROM public.official_norms
    WHERE subtest_id = p_subtest_id
      AND (organization_id IS NULL OR organization_id = v_caller_org_id)
      AND age_min_months <= p_age_months
      AND age_max_months >= p_age_months
      AND (gender = p_gender OR gender = 'Mixed')
      AND mean IS NOT NULL
      AND sd IS NOT NULL
      AND sd > 0
    ORDER BY
      CASE WHEN organization_id = v_caller_org_id THEN 0 ELSE 1 END,
      CASE WHEN gender = p_gender THEN 0 ELSE 1 END
    LIMIT 1;

    IF v_norm IS NULL THEN
      RETURN jsonb_build_object(
        'raw', p_raw_score,
        'standard', NULL,
        'percentile', NULL,
        'zScore', NULL,
        'norm_found', false,
        'method', 'PARAMETRIC',
        'warnings', ARRAY['no_norm']
      );
    END IF;

    v_z := (p_raw_score - v_norm.mean) / v_norm.sd;

    IF v_subtest.score_type = 'standard' THEN
      v_standard := 100 + (v_z * 15);
    ELSIF v_subtest.score_type = 'scaled' THEN
      v_standard := 10 + (v_z * 3);
    ELSIF v_subtest.score_type = 'sten' THEN
      v_standard := 5.5 + (v_z * 2);
    ELSIF v_subtest.score_type IN ('t_score', 't-score') THEN
      v_standard := 50 + (v_z * 10);
    ELSIF v_subtest.score_type = 'percentile' THEN
      v_standard := NULL;
    ELSE
      v_standard := 100 + (v_z * 15);
    END IF;

    v_percentile := (0.5 * (1.0 + erf(v_z / sqrt(2.0)))) * 100;

    RETURN jsonb_build_object(
      'raw', p_raw_score,
      'standard', CASE WHEN v_standard IS NULL THEN NULL ELSE round(v_standard::numeric, 1) END,
      'percentile', round(v_percentile::numeric, 1),
      'zScore', round(v_z::numeric, 2),
      'norm_found', true,
      'method', 'PARAMETRIC',
      'warnings', ARRAY[]::text[]
    );
  END IF;

  IF v_method = 'LOOKUP' THEN
    SELECT * INTO v_norm
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

    IF v_norm IS NULL THEN
      RETURN jsonb_build_object(
        'raw', p_raw_score,
        'standard', NULL,
        'percentile', NULL,
        'zScore', NULL,
        'norm_found', false,
        'method', 'LOOKUP',
        'warnings', ARRAY['no_norm']
      );
    END IF;

    RETURN jsonb_build_object(
      'raw', p_raw_score,
      'standard', v_norm.standard_score,
      'percentile', v_norm.percentile,
      'zScore', NULL,
      'norm_found', true,
      'method', 'LOOKUP',
      'warnings', ARRAY[]::text[]
    );
  END IF;

  RETURN jsonb_build_object(
    'raw', p_raw_score,
    'standard', NULL,
    'percentile', NULL,
    'zScore', NULL,
    'norm_found', false,
    'method', 'NONE',
    'warnings', ARRAY['unsupported_mode']
  );
END;
$$;

DROP FUNCTION IF EXISTS public.compute_score_v2(text, real, integer, text, text);

COMMIT;;
