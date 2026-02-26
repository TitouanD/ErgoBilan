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

  v_existing_score_type text;
  v_existing_comp_mode text;
  v_existing_input_model text;
  v_new_score_type text;
  v_new_comp_mode text;
  v_new_input_model text;
  v_sub_comp_mode text;
  v_sub_input_model text;

  v_norm_age_min integer;
  v_norm_age_max integer;
  v_norm_gender text;
  v_norm_raw_min real;
  v_norm_raw_max real;
  v_norm_mean real;
  v_norm_sd real;
  v_norm_standard_score real;
  v_norm_percentile real;
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
        COALESCE(NULLIF(v_sub ->> 'score_type', ''), 'none'),
        upper(COALESCE(NULLIF(v_sub ->> 'computation_mode', ''), 'LOOKUP')),
        lower(COALESCE(NULLIF(v_sub ->> 'input_model', ''), 'numeric_4mode')),
        COALESCE(v_sub -> 'input_config', '{}'::jsonb),
        v_org_id
      );
      v_new_subtests := v_new_subtests + 1;
      v_existing_sub_id := v_sub_id;
    ELSE
      SELECT score_type, computation_mode, input_model
      INTO v_existing_score_type, v_existing_comp_mode, v_existing_input_model
      FROM official_subtests
      WHERE id = v_existing_sub_id;

      v_new_score_type := COALESCE(NULLIF(v_sub ->> 'score_type', ''), 'none');
      v_new_comp_mode := upper(COALESCE(NULLIF(v_sub ->> 'computation_mode', ''), 'LOOKUP'));
      v_new_input_model := lower(COALESCE(NULLIF(v_sub ->> 'input_model', ''), 'numeric_4mode'));

      UPDATE official_subtests
      SET
        score_type = CASE WHEN v_existing_score_type = 'none' AND v_new_score_type <> 'none' THEN v_new_score_type ELSE score_type END,
        computation_mode = CASE WHEN v_existing_comp_mode IS NULL OR v_existing_comp_mode = 'NONE' THEN v_new_comp_mode ELSE computation_mode END,
        input_model = CASE WHEN v_existing_input_model = 'numeric_4mode' AND v_new_input_model <> 'numeric_4mode' THEN v_new_input_model ELSE input_model END
      WHERE id = v_existing_sub_id
        AND (
          (v_existing_score_type = 'none' AND v_new_score_type <> 'none') OR
          (v_existing_comp_mode IS NULL OR v_existing_comp_mode = 'NONE') OR
          (v_existing_input_model = 'numeric_4mode' AND v_new_input_model <> 'numeric_4mode')
        );
    END IF;

    SELECT
      upper(COALESCE(computation_mode, 'LOOKUP')),
      lower(COALESCE(input_model, 'numeric_4mode'))
    INTO v_sub_comp_mode, v_sub_input_model
    FROM official_subtests
    WHERE id = v_existing_sub_id;

    FOR v_norm_row IN SELECT * FROM jsonb_array_elements(COALESCE(v_sub -> 'norms', '[]'::jsonb))
    LOOP
      v_norm_age_min := NULLIF(v_norm_row ->> 'age_min_months', '')::int;
      v_norm_age_max := NULLIF(v_norm_row ->> 'age_max_months', '')::int;
      v_norm_gender := COALESCE(NULLIF(v_norm_row ->> 'gender', ''), 'Mixed');
      v_norm_raw_min := NULLIF(v_norm_row ->> 'raw_min', '')::real;
      v_norm_raw_max := NULLIF(v_norm_row ->> 'raw_max', '')::real;
      v_norm_mean := NULLIF(v_norm_row ->> 'mean', '')::real;
      v_norm_sd := NULLIF(v_norm_row ->> 'sd', '')::real;
      v_norm_standard_score := NULLIF(v_norm_row ->> 'standard_score', '')::real;
      v_norm_percentile := NULLIF(v_norm_row ->> 'percentile', '')::real;

      IF v_norm_age_min IS NULL OR v_norm_age_max IS NULL OR v_norm_age_min > v_norm_age_max THEN
        CONTINUE;
      END IF;

      IF (v_norm_raw_min IS NULL) <> (v_norm_raw_max IS NULL) THEN
        CONTINUE;
      END IF;
      IF v_norm_raw_min IS NOT NULL AND v_norm_raw_max IS NOT NULL AND v_norm_raw_min > v_norm_raw_max THEN
        CONTINUE;
      END IF;

      IF v_norm_percentile IS NOT NULL AND (v_norm_percentile < 0 OR v_norm_percentile > 100) THEN
        CONTINUE;
      END IF;

      IF (v_norm_mean IS NULL) <> (v_norm_sd IS NULL) THEN
        CONTINUE;
      END IF;
      IF v_norm_sd IS NOT NULL AND v_norm_sd <= 0 THEN
        CONTINUE;
      END IF;

      IF v_sub_comp_mode = 'PARAMETRIC' THEN
        IF v_norm_mean IS NULL OR v_norm_sd IS NULL THEN
          CONTINUE;
        END IF;
      ELSIF v_sub_input_model = 'numeric_4mode' THEN
        IF v_norm_standard_score IS NULL AND v_norm_percentile IS NULL THEN
          CONTINUE;
        END IF;
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM official_norms n
        WHERE n.subtest_id = v_existing_sub_id
          AND n.organization_id IS NOT DISTINCT FROM v_org_id
          AND n.age_min_months IS NOT DISTINCT FROM v_norm_age_min
          AND n.age_max_months IS NOT DISTINCT FROM v_norm_age_max
          AND n.gender IS NOT DISTINCT FROM v_norm_gender
          AND n.raw_min IS NOT DISTINCT FROM v_norm_raw_min
          AND n.raw_max IS NOT DISTINCT FROM v_norm_raw_max
          AND n.mean IS NOT DISTINCT FROM v_norm_mean
          AND n.sd IS NOT DISTINCT FROM v_norm_sd
          AND n.standard_score IS NOT DISTINCT FROM v_norm_standard_score
          AND n.percentile IS NOT DISTINCT FROM v_norm_percentile
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
          v_norm_age_min,
          v_norm_age_max,
          v_norm_gender,
          v_norm_raw_min,
          v_norm_raw_max,
          v_norm_mean,
          v_norm_sd,
          v_norm_standard_score,
          v_norm_percentile
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
