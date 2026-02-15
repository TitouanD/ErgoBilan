BEGIN;

ALTER TABLE public.official_subtests
  ADD COLUMN IF NOT EXISTS input_model text;

ALTER TABLE public.official_subtests
  ADD COLUMN IF NOT EXISTS input_config jsonb;

UPDATE public.official_subtests
SET input_model = COALESCE(NULLIF(input_model, ''), 'numeric_4mode')
WHERE input_model IS NULL OR input_model = '';

UPDATE public.official_subtests
SET input_config = COALESCE(input_config, '{}'::jsonb)
WHERE input_config IS NULL;

ALTER TABLE public.official_subtests
  ALTER COLUMN input_model SET DEFAULT 'numeric_4mode';
ALTER TABLE public.official_subtests
  ALTER COLUMN input_model SET NOT NULL;

ALTER TABLE public.official_subtests
  ALTER COLUMN input_config SET DEFAULT '{}'::jsonb;
ALTER TABLE public.official_subtests
  ALTER COLUMN input_config SET NOT NULL;

UPDATE public.official_subtests
SET
  input_model = 'qualitative_category',
  input_config = jsonb_build_object(
    'options', jsonb_build_array(
      jsonb_build_object('code', 'much_less', 'label', 'Beaucoup moins que les autres', 'order', 1),
      jsonb_build_object('code', 'less', 'label', 'Moins que les autres', 'order', 2),
      jsonb_build_object('code', 'as_others', 'label', 'Comme la plupart des autres', 'order', 3),
      jsonb_build_object('code', 'more', 'label', 'Plus que les autres', 'order', 4),
      jsonb_build_object('code', 'much_more', 'label', 'Beaucoup plus que les autres', 'order', 5)
    ),
    'defaultMetric', 'raw'
  )
WHERE test_id = 'profil-sensoriel-2';

DROP VIEW IF EXISTS public.view_unified_subtests;

CREATE VIEW public.view_unified_subtests AS
SELECT
  s.id,
  s.test_id,
  s.name,
  s.unit,
  s.score_type,
  s.computation_mode,
  s.input_model,
  s.input_config
FROM public.official_subtests s
JOIN public.official_tests t ON t.id = s.test_id
WHERE
  (t.organization_id IS NULL OR public.check_is_member_of(t.organization_id))
  AND (s.organization_id IS NULL OR public.check_is_member_of(s.organization_id));

GRANT SELECT ON public.view_unified_subtests TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.compute_score_v2(
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
  v_result jsonb;
BEGIN
  v_result := public.compute_score_v2(
    p_subtest_id,
    p_raw_score,
    p_age_months,
    p_gender,
    p_class_level
  );

  IF v_result IS NULL OR COALESCE((v_result->>'norm_found')::boolean, false) = false THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'raw', (v_result->>'raw')::real,
    'standard', v_result->'standard',
    'percentile', v_result->'percentile',
    'zScore', v_result->'zScore',
    'method', COALESCE(v_result->>'method', 'NONE')
  );
END;
$$;

COMMIT;;
