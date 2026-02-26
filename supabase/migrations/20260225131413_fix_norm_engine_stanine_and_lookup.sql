-- Migration to fix stanine support, lookup z-score calculation, and attribute propagation

-- 1. Update `compute_score_core` to handle stanine and calculate z-score for LOOKUP
CREATE OR REPLACE FUNCTION public.compute_score_core(
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
  v_effective_subtest_id text;
  v_subtest record;
  v_norm record;
  v_floor_norm record;
  v_method text;
  v_z real;
  v_standard real;
  v_percentile real;
  v_lowest_raw_min real;
  v_direction text;
  v_warnings text[] := ARRAY[]::text[];
  v_scale_mean real;
  v_scale_sd real;
BEGIN
  SELECT om.organization_id INTO v_caller_org_id
  FROM organization_members om
  WHERE om.user_id = auth.uid()
  LIMIT 1;

  v_effective_subtest_id := public.resolve_effective_subtest_id(p_subtest_id, v_caller_org_id);

  SELECT * INTO v_subtest
  FROM public.official_subtests
  WHERE id = v_effective_subtest_id
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

  IF v_subtest.id <> p_subtest_id AND coalesce(v_subtest.is_override_clone, false) THEN
    v_warnings := array_append(v_warnings, 'direction_override_clone_applied');
  END IF;

  IF lower(coalesce(v_subtest.score_type, 'none')) = 'none' THEN
    v_warnings := array_append(v_warnings, 'score_type_unset');
    RETURN jsonb_build_object(
      'raw', p_raw_score,
      'standard', NULL,
      'percentile', NULL,
      'zScore', NULL,
      'norm_found', false,
      'method', 'NONE',
      'warnings', v_warnings
    );
  END IF;

  v_method := upper(COALESCE(v_subtest.computation_mode, 'LOOKUP'));

  IF v_method = 'PARAMETRIC' THEN
    SELECT * INTO v_norm
    FROM public.official_norms
    WHERE subtest_id = v_effective_subtest_id
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
        'warnings', array_append(v_warnings, 'no_norm')
      );
    END IF;

    v_direction := lower(coalesce(v_subtest.raw_direction, 'auto'));
    IF v_direction NOT IN ('higher_better', 'lower_better') THEN
      v_direction := CASE
        WHEN lower(coalesce(v_subtest.name, '')) ~ '(temps|latence|erreur|fautes|qualite|qualité|duree|durée|delai|délai)'
          THEN 'lower_better'
        ELSE 'higher_better'
      END;
      v_warnings := array_append(v_warnings, 'direction_auto_applied');
    END IF;

    IF v_direction = 'lower_better' THEN
      v_z := (v_norm.mean - p_raw_score) / v_norm.sd;
    ELSE
      v_z := (p_raw_score - v_norm.mean) / v_norm.sd;
    END IF;

    IF v_subtest.score_type = 'standard' THEN
      v_standard := 100 + (v_z * 15);
    ELSIF v_subtest.score_type = 'scaled' THEN
      v_standard := 10 + (v_z * 3);
    ELSIF v_subtest.score_type = 'sten' THEN
      v_standard := 5.5 + (v_z * 2);
    ELSIF v_subtest.score_type = 'stanine' THEN
      v_standard := 5 + (v_z * 2);
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
      'warnings', v_warnings
    );
  END IF;

  IF v_method = 'LOOKUP' THEN
    SELECT * INTO v_norm
    FROM public.official_norms
    WHERE subtest_id = v_effective_subtest_id
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
      -- Determine scale mean and sd to calculate internal zScore for UI (GaussBand)
      IF v_norm.standard_score IS NOT NULL AND v_subtest.score_type IS NOT NULL THEN
        IF v_subtest.score_type = 'standard' THEN
          v_scale_mean := 100.0; v_scale_sd := 15.0;
        ELSIF v_subtest.score_type = 'scaled' THEN
          v_scale_mean := 10.0; v_scale_sd := 3.0;
        ELSIF v_subtest.score_type = 'sten' THEN
          v_scale_mean := 5.5; v_scale_sd := 2.0;
        ELSIF v_subtest.score_type = 'stanine' THEN
          v_scale_mean := 5.0; v_scale_sd := 2.0;
        ELSIF v_subtest.score_type IN ('t_score', 't-score') THEN
          v_scale_mean := 50.0; v_scale_sd := 10.0;
        ELSE
          v_scale_mean := NULL; v_scale_sd := NULL;
        END IF;

        IF v_scale_mean IS NOT NULL AND v_scale_sd IS NOT NULL THEN
          v_z := (v_norm.standard_score - v_scale_mean) / v_scale_sd;
        END IF;
      END IF;

      RETURN jsonb_build_object(
        'raw', p_raw_score,
        'standard', v_norm.standard_score,
        'percentile', v_norm.percentile,
        'zScore', CASE WHEN v_z IS NULL THEN NULL ELSE round(v_z::numeric, 2) END,
        'norm_found', true,
        'method', 'LOOKUP',
        'warnings', v_warnings
      );
    END IF;

    SELECT min(n.raw_min) INTO v_lowest_raw_min
    FROM public.official_norms n
    WHERE n.subtest_id = v_effective_subtest_id
      AND (n.organization_id IS NULL OR n.organization_id = v_caller_org_id)
      AND n.age_min_months <= p_age_months
      AND n.age_max_months >= p_age_months
      AND (n.gender = p_gender OR n.gender = 'Mixed')
      AND n.raw_min IS NOT NULL;

    IF v_lowest_raw_min IS NOT NULL AND p_raw_score < v_lowest_raw_min THEN
      SELECT * INTO v_floor_norm
      FROM public.official_norms
      WHERE subtest_id = v_effective_subtest_id
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
        -- Determine scale mean and sd to calculate internal zScore for UI (GaussBand)
        IF v_floor_norm.standard_score IS NOT NULL AND v_subtest.score_type IS NOT NULL THEN
          IF v_subtest.score_type = 'standard' THEN
            v_scale_mean := 100.0; v_scale_sd := 15.0;
          ELSIF v_subtest.score_type = 'scaled' THEN
            v_scale_mean := 10.0; v_scale_sd := 3.0;
          ELSIF v_subtest.score_type = 'sten' THEN
            v_scale_mean := 5.5; v_scale_sd := 2.0;
          ELSIF v_subtest.score_type = 'stanine' THEN
            v_scale_mean := 5.0; v_scale_sd := 2.0;
          ELSIF v_subtest.score_type IN ('t_score', 't-score') THEN
            v_scale_mean := 50.0; v_scale_sd := 10.0;
          ELSE
            v_scale_mean := NULL; v_scale_sd := NULL;
          END IF;

          IF v_scale_mean IS NOT NULL AND v_scale_sd IS NOT NULL THEN
            v_z := (v_floor_norm.standard_score - v_scale_mean) / v_scale_sd;
          END IF;
        END IF;

        RETURN jsonb_build_object(
          'raw', p_raw_score,
          'standard', v_floor_norm.standard_score,
          'percentile', v_floor_norm.percentile,
          'zScore', CASE WHEN v_z IS NULL THEN NULL ELSE round(v_z::numeric, 2) END,
          'norm_found', true,
          'method', 'LOOKUP',
          'warnings', array_append(v_warnings, 'floor_score')
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
      'warnings', array_append(v_warnings, 'no_norm')
    );
  END IF;

  RETURN jsonb_build_object(
    'raw', p_raw_score,
    'standard', NULL,
    'percentile', NULL,
    'zScore', NULL,
    'norm_found', false,
    'method', 'NONE',
    'warnings', array_append(v_warnings, 'unsupported_mode')
  );
END;
$function$;

-- 2. Update `attach_subtests_to_test` to propagate conditionally
CREATE OR REPLACE FUNCTION public.attach_subtests_to_test(p_test_id text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_org_id uuid;
  v_sub jsonb;
  v_norm_row jsonb;
  v_sub_raw_name text;
  v_sub_name text;
  v_sub_base_name text;
  v_sub_abbreviation text;
  v_sub_id text;
  v_existing_sub_id text;
  v_new_subtests int := 0;
  v_new_norms int := 0;
  v_test_exists boolean;
  v_trailing_tag text;
  v_trailing_tag_normalized text;
  v_payload_same_name_count integer;
  v_existing_same_name_count integer;
  v_existing_same_name_tagged_count integer;
  v_requires_abbreviation boolean;
  
  -- NEW VARIABLES FOR PROPAGATION
  v_existing_score_type text;
  v_existing_comp_mode text;
  v_existing_input_model text;
  v_new_score_type text;
  v_new_comp_mode text;
  v_new_input_model text;
BEGIN
  SELECT om.organization_id INTO v_org_id
  FROM organization_members om
  WHERE om.user_id = auth.uid()
  LIMIT 1;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'No organization found for user' USING ERRCODE = '42501';
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM official_tests t
    WHERE t.id = p_test_id
      AND (t.organization_id IS NULL OR t.organization_id = v_org_id)
  ) INTO v_test_exists;

  IF NOT v_test_exists THEN
    RAISE EXCEPTION 'Test not found or not accessible' USING ERRCODE = '42704';
  END IF;

  FOR v_sub IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload -> 'subtests', '[]'::jsonb))
  LOOP
    v_sub_raw_name := trim(COALESCE(v_sub ->> 'name', ''));
    IF v_sub_raw_name = '' THEN
      RAISE EXCEPTION 'Subtest name missing';
    END IF;

    v_sub_name := v_sub_raw_name;
    v_sub_abbreviation := public.normalize_subtest_abbreviation_tag(v_sub->>'abbreviation');
    v_trailing_tag := public.extract_trailing_tag(v_sub_raw_name);
    v_trailing_tag_normalized := public.normalize_subtest_abbreviation_tag(v_trailing_tag);
    v_sub_base_name := CASE
      WHEN v_trailing_tag IS NOT NULL THEN trim(regexp_replace(v_sub_raw_name, '\s*\([^()]{1,80}\)\s*$', ''))
      ELSE v_sub_raw_name
    END;
    IF v_sub_base_name = '' THEN
      v_sub_base_name := v_sub_raw_name;
    END IF;

    SELECT COUNT(*) INTO v_payload_same_name_count
    FROM jsonb_array_elements(COALESCE(p_payload -> 'subtests', '[]'::jsonb)) s2
    WHERE norm_subtest_name(
      COALESCE(
        NULLIF(trim(regexp_replace(COALESCE(s2->>'name', ''), '\s*\([^()]{1,80}\)\s*$', '')), ''),
        trim(COALESCE(s2->>'name', ''))
      )
    ) = norm_subtest_name(v_sub_base_name);

    SELECT
      COUNT(*),
      COUNT(*) FILTER (WHERE public.normalize_subtest_abbreviation_tag(s.abbreviation) IS NOT NULL)
    INTO v_existing_same_name_count, v_existing_same_name_tagged_count
    FROM official_subtests s
    WHERE s.test_id = p_test_id
      AND norm_subtest_name(s.name) = norm_subtest_name(v_sub_base_name);

    v_requires_abbreviation :=
      v_payload_same_name_count > 1
      OR v_existing_same_name_count > 1
      OR v_existing_same_name_tagged_count > 0;

    IF v_sub_abbreviation IS NULL
       AND v_requires_abbreviation
       AND v_trailing_tag_normalized IS NOT NULL THEN
      v_sub_abbreviation := v_trailing_tag_normalized;
    END IF;

    IF v_requires_abbreviation AND v_sub_abbreviation IS NULL THEN
      RAISE EXCEPTION 'Ambiguous subtest "%" in test "%": abbreviation/tag is required', v_sub_base_name, p_test_id;
    END IF;

    IF v_requires_abbreviation THEN
      v_sub_name := v_sub_base_name;
    ELSIF v_sub_abbreviation IS NOT NULL
      AND v_trailing_tag_normalized IS NOT NULL
      AND v_trailing_tag_normalized = v_sub_abbreviation THEN
      v_sub_name := v_sub_base_name;
    END IF;

    v_existing_sub_id := NULL;

    SELECT s.id INTO v_existing_sub_id
    FROM official_subtests s
    WHERE s.test_id = p_test_id
      AND s.organization_id = v_org_id
      AND norm_subtest_name(s.name) = norm_subtest_name(v_sub_name)
      AND COALESCE(public.normalize_subtest_abbreviation_tag(s.abbreviation), '') = COALESCE(v_sub_abbreviation, '')
    LIMIT 1;

    IF v_existing_sub_id IS NULL THEN
      SELECT s.id INTO v_existing_sub_id
      FROM official_subtests s
      WHERE s.test_id = p_test_id
        AND s.organization_id IS NULL
        AND norm_subtest_name(s.name) = norm_subtest_name(v_sub_name)
        AND COALESCE(public.normalize_subtest_abbreviation_tag(s.abbreviation), '') = COALESCE(v_sub_abbreviation, '')
      LIMIT 1;
    END IF;

    IF v_existing_sub_id IS NULL THEN
      v_sub_id := p_test_id || '_' || left(regexp_replace(lower(public.unaccent(trim(v_sub_name))), '[^a-z0-9]+', '_', 'g'), 42)
        || CASE
             WHEN v_sub_abbreviation IS NOT NULL
               THEN '_' || left(regexp_replace(lower(v_sub_abbreviation), '[^a-z0-9]+', '_', 'g'), 7)
             ELSE ''
           END
        || '_' || left(v_org_id::text, 8);
      INSERT INTO official_subtests (
        id,
        test_id,
        name,
        abbreviation,
        unit,
        score_type,
        computation_mode,
        input_model,
        input_config,
        organization_id
      )
      VALUES (
        v_sub_id,
        p_test_id,
        v_sub_name,
        v_sub_abbreviation,
        COALESCE(v_sub ->> 'unit', 'pts'),
        COALESCE(v_sub ->> 'score_type', 'standard'),
        COALESCE(v_sub ->> 'computation_mode', 'LOOKUP'),
        COALESCE(v_sub ->> 'input_model', 'numeric_4mode'),
        COALESCE(v_sub -> 'input_config', '{}'::jsonb),
        v_org_id
      );
      v_new_subtests := v_new_subtests + 1;
      v_existing_sub_id := v_sub_id;
    ELSE
      -- PROPAGATION LOGIC: the subtest exists, update missing attributes if payload has better definitions
      SELECT score_type, computation_mode, input_model
      INTO v_existing_score_type, v_existing_comp_mode, v_existing_input_model
      FROM official_subtests
      WHERE id = v_existing_sub_id;
      
      v_new_score_type := COALESCE(v_sub ->> 'score_type', 'none');
      v_new_comp_mode := COALESCE(v_sub ->> 'computation_mode', 'PARAMETRIC');
      v_new_input_model := COALESCE(v_sub ->> 'input_model', 'numeric_4mode');

      UPDATE official_subtests
      SET
        score_type = CASE WHEN v_existing_score_type = 'none' AND v_new_score_type != 'none' THEN v_new_score_type ELSE score_type END,
        computation_mode = CASE WHEN v_existing_comp_mode IS NULL OR v_existing_comp_mode = 'NONE' THEN v_new_comp_mode ELSE computation_mode END,
        input_model = CASE WHEN v_existing_input_model = 'numeric_4mode' AND v_new_input_model != 'numeric_4mode' THEN v_new_input_model ELSE input_model END
      WHERE id = v_existing_sub_id
        AND (
          (v_existing_score_type = 'none' AND v_new_score_type != 'none') OR
          (v_existing_comp_mode IS NULL OR v_existing_comp_mode = 'NONE') OR
          (v_existing_input_model = 'numeric_4mode' AND v_new_input_model != 'numeric_4mode')
        );
    END IF;

    FOR v_norm_row IN SELECT * FROM jsonb_array_elements(COALESCE(v_sub -> 'norms', '[]'::jsonb))
    LOOP
      IF NOT EXISTS (
        SELECT 1 FROM official_norms n
        WHERE n.subtest_id = v_existing_sub_id
          AND n.organization_id IS NOT DISTINCT FROM v_org_id
          AND n.age_min_months IS NOT DISTINCT FROM (v_norm_row ->> 'age_min_months')::int
          AND n.age_max_months IS NOT DISTINCT FROM (v_norm_row ->> 'age_max_months')::int
          AND n.gender IS NOT DISTINCT FROM (v_norm_row ->> 'gender')
          AND n.raw_min IS NOT DISTINCT FROM (v_norm_row ->> 'raw_min')::real
          AND n.raw_max IS NOT DISTINCT FROM (v_norm_row ->> 'raw_max')::real
          AND n.mean IS NOT DISTINCT FROM (v_norm_row ->> 'mean')::real
          AND n.sd IS NOT DISTINCT FROM (v_norm_row ->> 'sd')::real
          AND n.standard_score IS NOT DISTINCT FROM (v_norm_row ->> 'standard_score')::real
          AND n.percentile IS NOT DISTINCT FROM (v_norm_row ->> 'percentile')::real
      ) THEN
        INSERT INTO official_norms (
          subtest_id,
          organization_id,
          age_min_months,
          age_max_months,
          gender,
          raw_min,
          raw_max,
          mean,
          sd,
          standard_score,
          percentile
        )
        VALUES (
          v_existing_sub_id,
          v_org_id,
          (v_norm_row ->> 'age_min_months')::int,
          (v_norm_row ->> 'age_max_months')::int,
          COALESCE(v_norm_row ->> 'gender', 'Mixed'),
          (v_norm_row ->> 'raw_min')::real,
          (v_norm_row ->> 'raw_max')::real,
          (v_norm_row ->> 'mean')::real,
          (v_norm_row ->> 'sd')::real,
          (v_norm_row ->> 'standard_score')::real,
          (v_norm_row ->> 'percentile')::real
        );
        v_new_norms := v_new_norms + 1;
      END IF;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'new_subtests', v_new_subtests,
    'new_norms', v_new_norms,
    'test_id', p_test_id
  );
END;
$function$;
