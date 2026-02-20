-- Fix LOOKUP scoring false negatives and expose age/gender-aware norms availability.
-- Root cause: in PL/pgSQL, `record IS NOT NULL` can evaluate to NULL when some fields
-- are NULL, so LOOKUP branches incorrectly fell through to `no_norm`.

CREATE OR REPLACE FUNCTION public.compute_score(
  p_subtest_id text,
  p_raw_score real,
  p_age_months integer,
  p_gender text DEFAULT 'Mixed'::text,
  p_class_level text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_org_id uuid;
  v_subtest record;
  v_norm record;
  v_floor_norm record;
  v_method text;
  v_z real;
  v_standard real;
  v_percentile real;
  v_lowest_raw_min real;
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

  IF NOT FOUND THEN
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

    IF NOT FOUND THEN
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

    IF FOUND THEN
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

    -- If below lowest measurable raw score for this age/gender, use floor row.
    SELECT min(n.raw_min) INTO v_lowest_raw_min
    FROM public.official_norms n
    WHERE n.subtest_id = p_subtest_id
      AND (n.organization_id IS NULL OR n.organization_id = v_caller_org_id)
      AND n.age_min_months <= p_age_months
      AND n.age_max_months >= p_age_months
      AND (n.gender = p_gender OR n.gender = 'Mixed')
      AND n.raw_min IS NOT NULL;

    IF v_lowest_raw_min IS NOT NULL AND p_raw_score < v_lowest_raw_min THEN
      SELECT * INTO v_floor_norm
      FROM public.official_norms
      WHERE subtest_id = p_subtest_id
        AND (organization_id IS NULL OR organization_id = v_caller_org_id)
        AND age_min_months <= p_age_months
        AND age_max_months >= p_age_months
        AND raw_min IS NULL
        AND raw_max IS NULL
        AND (gender = p_gender OR gender = 'Mixed')
      ORDER BY
        CASE WHEN organization_id = v_caller_org_id THEN 0 ELSE 1 END,
        standard_score ASC NULLS LAST
      LIMIT 1;

      IF FOUND THEN
        RETURN jsonb_build_object(
          'raw', p_raw_score,
          'standard', v_floor_norm.standard_score,
          'percentile', v_floor_norm.percentile,
          'zScore', NULL,
          'norm_found', true,
          'method', 'LOOKUP',
          'warnings', ARRAY['floor_score']
        );
      END IF;
    END IF;

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
    'standard', NULL,
    'percentile', NULL,
    'zScore', NULL,
    'norm_found', false,
    'method', 'NONE',
    'warnings', ARRAY['unsupported_mode']
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.check_norms_applicability(
  p_subtest_ids text[],
  p_age_months integer,
  p_gender text DEFAULT 'Mixed'::text
)
RETURNS TABLE(subtest_id text, has_norms boolean, has_applicable_norms boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH caller AS (
    SELECT om.organization_id AS caller_org_id
    FROM public.organization_members om
    WHERE om.user_id = auth.uid()
    LIMIT 1
  )
  SELECT
    u.id AS subtest_id,
    EXISTS (
      SELECT 1
      FROM public.official_norms n
      WHERE n.subtest_id = u.id
        AND (
          n.organization_id IS NULL
          OR n.organization_id = (SELECT caller_org_id FROM caller)
        )
      LIMIT 1
    ) AS has_norms,
    EXISTS (
      SELECT 1
      FROM public.official_norms n
      WHERE n.subtest_id = u.id
        AND (
          n.organization_id IS NULL
          OR n.organization_id = (SELECT caller_org_id FROM caller)
        )
        AND n.age_min_months <= p_age_months
        AND n.age_max_months >= p_age_months
        AND (n.gender = p_gender OR n.gender = 'Mixed')
      LIMIT 1
    ) AS has_applicable_norms
  FROM unnest(p_subtest_ids) AS u(id);
$function$;

GRANT EXECUTE ON FUNCTION public.check_norms_applicability(text[], integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_norms_applicability(text[], integer, text) TO anon;
