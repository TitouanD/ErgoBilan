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

-- 2. Update `admin_attach_subtests` to propagate missing score_type/computation_mode
CREATE OR REPLACE FUNCTION public.admin_attach_subtests(
  p_target_test_id text,
  p_subtests jsonb
)
RETURNS TABLE (
  merged_subtest_id text,
  inserted_norms integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_admin_user_id uuid := auth.uid();
  v_caller_org_id uuid;
  v_subtest jsonb;
  v_norm jsonb;
  v_existing_id text;
  v_new_subtest_id text;
  v_norms_count integer;
  v_total_norms_count integer := 0;
  v_subtest_abbreviation text;
  v_subtest_score_type text;
  v_subtest_computation_mode text;
  v_subtest_input_model text;
BEGIN
  IF v_admin_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT om.organization_id INTO v_caller_org_id
  FROM public.organization_members om
  WHERE om.user_id = v_admin_user_id
  LIMIT 1;

  IF v_caller_org_id IS NULL THEN
    RAISE EXCEPTION 'User does not belong to an organization' USING ERRCODE = '42501';
  END IF;

  FOR v_subtest IN SELECT * FROM jsonb_array_elements(p_subtests) LOOP
    v_norms_count := 0;
    v_existing_id := NULL;

    -- Chercher par id strict
    IF v_subtest->>'id' IS NOT NULL THEN
      SELECT s.id INTO v_existing_id
      FROM official_subtests s
      WHERE s.test_id = p_target_test_id
        AND s.id = v_subtest->>'id'
        AND (s.organization_id IS NULL OR s.organization_id = v_caller_org_id)
      LIMIT 1;
    END IF;

    -- Chercher par nom et abréviation
    IF v_existing_id IS NULL THEN
      SELECT s.id INTO v_existing_id
      FROM official_subtests s
      WHERE s.test_id = p_target_test_id
        AND lower(trim(s.name)) = lower(trim(v_subtest->>'name'))
        AND coalesce(lower(trim(s.abbreviation)), '') = coalesce(lower(trim(v_subtest->>'abbreviation')), '')
        AND (s.organization_id IS NULL OR s.organization_id = v_caller_org_id)
      LIMIT 1;
    END IF;

    IF v_existing_id IS NOT NULL THEN
      -- Le sous-test existe déjà, on vérifie si on doit enrichir son score_type / computation_mode
      v_subtest_score_type := coalesce(v_subtest->>'score_type', 'none');
      v_subtest_computation_mode := coalesce(v_subtest->>'computation_mode', 'PARAMETRIC');
      v_subtest_input_model := coalesce(v_subtest->>'input_model', 'numeric_4mode');

      UPDATE official_subtests
      SET
        score_type = CASE WHEN score_type = 'none' AND v_subtest_score_type != 'none' THEN v_subtest_score_type ELSE score_type END,
        computation_mode = CASE WHEN computation_mode IS NULL OR computation_mode = 'NONE' THEN v_subtest_computation_mode ELSE computation_mode END,
        input_model = CASE WHEN input_model = 'numeric_4mode' AND v_subtest_input_model != 'numeric_4mode' THEN v_subtest_input_model ELSE input_model END
      WHERE id = v_existing_id
        AND (
          (score_type = 'none' AND v_subtest_score_type != 'none') OR
          (computation_mode IS NULL OR computation_mode = 'NONE') OR
          (input_model = 'numeric_4mode' AND v_subtest_input_model != 'numeric_4mode')
        );

      v_new_subtest_id := v_existing_id;
    ELSE
      -- Création d'un nouveau sous-test privé
      v_new_subtest_id := gen_random_uuid();
      v_subtest_abbreviation := coalesce(NULLIF(trim(v_subtest->>'abbreviation'), ''), NULL);
      
      -- Si l'abbréviation passée n'est pas valide, on l'efface
      IF v_subtest_abbreviation IS NOT NULL AND v_subtest_abbreviation !~ '^[A-Z0-9][A-Z0-9&/ -]{0,19}$' THEN
        v_subtest_abbreviation := NULL;
      END IF;

      INSERT INTO official_subtests (
        id,
        test_id,
        name,
        unit,
        score_type,
        computation_mode,
        input_model,
        input_config,
        abbreviation,
        raw_direction,
        organization_id
      ) VALUES (
        v_new_subtest_id,
        p_target_test_id,
        v_subtest->>'name',
        v_subtest->>'unit',
        coalesce(v_subtest->>'score_type', 'none'),
        coalesce(v_subtest->>'computation_mode', 'PARAMETRIC'),
        coalesce(v_subtest->>'input_model', 'numeric_4mode'),
        coalesce(v_subtest->'input_config', '{}'::jsonb),
        v_subtest_abbreviation,
        coalesce(v_subtest->>'raw_direction', 'auto'),
        v_caller_org_id
      );
    END IF;

    -- Ajout des normes
    FOR v_norm IN SELECT * FROM jsonb_array_elements(v_subtest->'norms') LOOP
      INSERT INTO official_norms (
        subtest_id,
        age_min_months,
        age_max_months,
        gender,
        mean,
        sd,
        raw_min,
        raw_max,
        standard_score,
        percentile,
        organization_id
      ) VALUES (
        v_new_subtest_id,
        (v_norm->>'age_min_months')::integer,
        (v_norm->>'age_max_months')::integer,
        v_norm->>'gender',
        (v_norm->>'mean')::real,
        (v_norm->>'sd')::real,
        (v_norm->>'raw_min')::real,
        (v_norm->>'raw_max')::real,
        (v_norm->>'standard_score')::real,
        (v_norm->>'percentile')::real,
        v_caller_org_id
      );
      v_norms_count := v_norms_count + 1;
    END LOOP;

    v_total_norms_count := v_total_norms_count + v_norms_count;

    merged_subtest_id := v_new_subtest_id;
    inserted_norms := v_norms_count;
    RETURN NEXT;
  END LOOP;

  INSERT INTO public.admin_audit_log (
    admin_user_id, action, affected_test_ids, metadata, result
  ) VALUES (
    v_admin_user_id,
    'attach_subtests',
    jsonb_build_array(p_target_test_id),
    jsonb_build_object('subtests_count', jsonb_array_length(p_subtests), 'inserted_norms', v_total_norms_count),
    'SUCCESS'
  );
END;
$function$;
