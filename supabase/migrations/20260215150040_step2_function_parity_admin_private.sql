BEGIN;

CREATE OR REPLACE FUNCTION public.admin_get_test_bundle(p_test_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bundle jsonb;
BEGIN
  IF NOT check_is_admin() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
      'test', jsonb_build_object(
        'id', t.id,
        'name', t.name,
        'category_id', t.category_id,
        'version', t.version,
        'author', t.author,
        'organization_id', t.organization_id,
        'created_at', t.created_at
      ),
      'subtests', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', s.id,
          'test_id', s.test_id,
          'name', s.name,
          'unit', s.unit,
          'score_type', s.score_type,
          'computation_mode', s.computation_mode,
          'input_model', s.input_model,
          'input_config', s.input_config,
          'organization_id', s.organization_id
        ) ORDER BY s.name)
        FROM official_subtests s
        WHERE s.test_id = t.id
      ), '[]'::jsonb),
      'norms', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', n.id,
          'subtest_id', n.subtest_id,
          'organization_id', n.organization_id,
          'age_min_months', n.age_min_months,
          'age_max_months', n.age_max_months,
          'gender', n.gender,
          'raw_min', n.raw_min,
          'raw_max', n.raw_max,
          'mean', n.mean,
          'sd', n.sd,
          'standard_score', n.standard_score,
          'percentile', n.percentile
        ) ORDER BY n.age_min_months)
        FROM official_norms n
        WHERE n.subtest_id IN (
          SELECT s2.id FROM official_subtests s2 WHERE s2.test_id = t.id
        )
      ), '[]'::jsonb)
    )
  INTO v_bundle
  FROM official_tests t
  WHERE t.id = p_test_id;

  RETURN v_bundle;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_save_test_bundle(p_payload jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_test jsonb;
  v_test_id text;
  v_org_id uuid;
  v_subtests jsonb;
  v_norms jsonb;
  v_sub jsonb;
BEGIN
  IF NOT check_is_admin() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  v_test := COALESCE(p_payload->'test', '{}'::jsonb);
  v_test_id := COALESCE(v_test->>'id', '');

  IF v_test_id = '' THEN
    RAISE EXCEPTION 'Test id missing';
  END IF;

  v_org_id := NULL;
  IF (v_test ? 'organization_id') THEN
    v_org_id := NULLIF(v_test->>'organization_id', '')::uuid;
  END IF;

  INSERT INTO official_tests (id, name, category_id, version, author, organization_id)
  VALUES (
    v_test_id,
    COALESCE(v_test->>'name', ''),
    COALESCE(v_test->>'category_id', ''),
    COALESCE(v_test->>'version', '1.0'),
    COALESCE(v_test->>'author', ''),
    v_org_id
  )
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    category_id = EXCLUDED.category_id,
    version = EXCLUDED.version,
    author = EXCLUDED.author,
    organization_id = EXCLUDED.organization_id;

  v_subtests := COALESCE(p_payload->'subtests', '[]'::jsonb);
  FOR v_sub IN SELECT * FROM jsonb_array_elements(v_subtests)
  LOOP
    IF COALESCE(v_sub->>'id', '') = '' THEN
      RAISE EXCEPTION 'Subtest id missing';
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
      organization_id
    )
    VALUES (
      v_sub->>'id',
      v_test_id,
      COALESCE(v_sub->>'name', ''),
      COALESCE(v_sub->>'unit', 'pts'),
      COALESCE(v_sub->>'score_type', 'standard'),
      COALESCE(v_sub->>'computation_mode', 'LOOKUP'),
      COALESCE(v_sub->>'input_model', 'numeric_4mode'),
      COALESCE(v_sub->'input_config', '{}'::jsonb),
      COALESCE(NULLIF(v_sub->>'organization_id', '')::uuid, v_org_id)
    )
    ON CONFLICT (id) DO UPDATE SET
      test_id = EXCLUDED.test_id,
      name = EXCLUDED.name,
      unit = EXCLUDED.unit,
      score_type = EXCLUDED.score_type,
      computation_mode = EXCLUDED.computation_mode,
      input_model = EXCLUDED.input_model,
      input_config = EXCLUDED.input_config,
      organization_id = EXCLUDED.organization_id;
  END LOOP;

  DELETE FROM official_norms
  WHERE subtest_id IN (
    SELECT (s->>'id')::text
    FROM jsonb_array_elements(v_subtests) s
    WHERE COALESCE(s->>'id', '') <> ''
  );

  v_norms := COALESCE(p_payload->'norms', '[]'::jsonb);
  IF jsonb_array_length(v_norms) > 0 THEN
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
    SELECT
      n->>'subtest_id',
      COALESCE(NULLIF(n->>'organization_id', '')::uuid, v_org_id),
      NULLIF(n->>'age_min_months', '')::integer,
      NULLIF(n->>'age_max_months', '')::integer,
      COALESCE(n->>'gender', 'Mixed'),
      NULLIF(n->>'raw_min', '')::real,
      NULLIF(n->>'raw_max', '')::real,
      NULLIF(n->>'mean', '')::real,
      NULLIF(n->>'sd', '')::real,
      NULLIF(n->>'standard_score', '')::real,
      NULLIF(n->>'percentile', '')::real
    FROM jsonb_array_elements(v_norms) n
    WHERE COALESCE(n->>'subtest_id', '') <> ''
      AND (n->>'subtest_id') IN (
        SELECT (s->>'id')::text FROM jsonb_array_elements(v_subtests) s
      );
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_private_test(p_payload jsonb)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid;
  v_test jsonb;
  v_test_id text;
  v_test_name text;
  v_category_id text;
  v_version text;
  v_author text;
  v_sub jsonb;
  v_sub_name text;
  v_sub_id text;
  v_subtests jsonb;
  v_norms jsonb;
  v_existing_id text;
  v_norm_sub text;
  v_seen_subtests text[] := ARRAY[]::text[];
BEGIN
  SELECT organization_id INTO v_org_id
  FROM organization_members
  WHERE user_id = auth.uid()
  LIMIT 1;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'No organization found for user' USING ERRCODE = '42501';
  END IF;

  v_test := COALESCE(p_payload->'test', '{}'::jsonb);
  v_test_name := COALESCE(v_test->>'name', '');
  IF v_test_name = '' THEN
    RAISE EXCEPTION 'Test name missing';
  END IF;

  SELECT id INTO v_existing_id
  FROM official_tests
  WHERE organization_id = v_org_id
    AND norm_name(name) = norm_name(v_test_name)
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    PERFORM merge_private_test(v_existing_id, p_payload);
    RETURN v_existing_id;
  END IF;

  v_category_id := COALESCE(v_test->>'category_id', '');
  v_version := COALESCE(v_test->>'version', '1.0');
  v_author := COALESCE(
    v_test->>'author',
    COALESCE(current_setting('request.jwt.claims', true)::json->>'email', '')
  );

  v_test_id := concat('priv_', split_part(v_org_id::text, '-', 1), '_', substr(gen_random_uuid()::text, 1, 8));

  INSERT INTO official_tests (id, name, category_id, version, author, organization_id)
  VALUES (v_test_id, v_test_name, v_category_id, v_version, v_author, v_org_id);

  v_subtests := COALESCE(p_payload->'subtests', '[]'::jsonb);
  FOR v_sub IN SELECT * FROM jsonb_array_elements(v_subtests)
  LOOP
    v_sub_name := COALESCE(v_sub->>'name', '');
    IF v_sub_name = '' THEN
      RAISE EXCEPTION 'Subtest name missing';
    END IF;

    v_norm_sub := norm_name(v_sub_name);
    IF v_norm_sub = ANY(v_seen_subtests) THEN
      CONTINUE;
    END IF;
    v_seen_subtests := array_append(v_seen_subtests, v_norm_sub);

    v_sub_id := concat(
      v_test_id,
      '_',
      substring(regexp_replace(lower(v_sub_name), '[^a-z0-9]+', '_', 'g') for 50)
    );

    INSERT INTO official_subtests (
      id,
      test_id,
      name,
      unit,
      score_type,
      computation_mode,
      input_model,
      input_config,
      organization_id
    )
    VALUES (
      v_sub_id,
      v_test_id,
      v_sub_name,
      COALESCE(v_sub->>'unit', 'pts'),
      COALESCE(v_sub->>'score_type', 'standard'),
      COALESCE(v_sub->>'computation_mode', 'LOOKUP'),
      COALESCE(v_sub->>'input_model', 'numeric_4mode'),
      COALESCE(v_sub->'input_config', '{}'::jsonb),
      v_org_id
    );

    v_norms := v_sub->'norms';
    IF v_norms IS NOT NULL AND jsonb_array_length(v_norms) > 0 THEN
      WITH new_norms AS (
        SELECT DISTINCT
          NULLIF(n->>'age_min_months', '')::integer AS age_min_months,
          NULLIF(n->>'age_max_months', '')::integer AS age_max_months,
          COALESCE(n->>'gender', 'Mixed') AS gender,
          NULLIF(n->>'raw_min', '')::real AS raw_min,
          NULLIF(n->>'raw_max', '')::real AS raw_max,
          NULLIF(n->>'mean', '')::real AS mean,
          NULLIF(n->>'sd', '')::real AS sd,
          NULLIF(n->>'standard_score', '')::real AS standard_score,
          NULLIF(n->>'percentile', '')::real AS percentile
        FROM jsonb_array_elements(v_norms) AS n
      )
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
      SELECT
        v_sub_id,
        v_org_id,
        nn.age_min_months,
        nn.age_max_months,
        nn.gender,
        nn.raw_min,
        nn.raw_max,
        nn.mean,
        nn.sd,
        nn.standard_score,
        nn.percentile
      FROM new_norms nn;
    END IF;
  END LOOP;

  RETURN v_test_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.merge_private_test(p_target_id text, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid;
  v_sub jsonb;
  v_norm_row jsonb;
  v_sub_name text;
  v_existing_sub_id text;
  v_new_sub_id text;
  v_new_subtests int := 0;
  v_new_norms int := 0;
BEGIN
  SELECT om.organization_id INTO v_org_id
  FROM organization_members om
  WHERE om.user_id = auth.uid()
  LIMIT 1;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'No organization found' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM official_tests
    WHERE id = p_target_id AND organization_id = v_org_id
  ) THEN
    RAISE EXCEPTION 'Target test not owned by your organization' USING ERRCODE = '42501';
  END IF;

  FOR v_sub IN SELECT * FROM jsonb_array_elements(p_payload -> 'subtests')
  LOOP
    v_sub_name := v_sub ->> 'name';

    SELECT s.id INTO v_existing_sub_id
    FROM official_subtests s
    WHERE s.test_id = p_target_id
      AND norm_subtest_name(s.name) = norm_subtest_name(v_sub_name)
    LIMIT 1;

    IF v_existing_sub_id IS NULL THEN
      v_new_sub_id := p_target_id || '_' || left(regexp_replace(lower(public.unaccent(trim(v_sub_name))), '[^a-z0-9]+', '_', 'g'), 50);

      INSERT INTO official_subtests (
        id,
        test_id,
        name,
        unit,
        score_type,
        computation_mode,
        input_model,
        input_config,
        organization_id
      )
      VALUES (
        v_new_sub_id,
        p_target_id,
        v_sub_name,
        COALESCE(v_sub ->> 'unit', 'pts'),
        COALESCE(v_sub ->> 'score_type', 'standard'),
        COALESCE(v_sub ->> 'computation_mode', 'LOOKUP'),
        COALESCE(v_sub ->> 'input_model', 'numeric_4mode'),
        COALESCE(v_sub -> 'input_config', '{}'::jsonb),
        v_org_id
      );
      v_new_subtests := v_new_subtests + 1;
      v_existing_sub_id := v_new_sub_id;
    ELSE
      UPDATE official_subtests
      SET
        unit = COALESCE(v_sub ->> 'unit', unit),
        score_type = COALESCE(v_sub ->> 'score_type', score_type),
        computation_mode = COALESCE(v_sub ->> 'computation_mode', computation_mode),
        input_model = COALESCE(v_sub ->> 'input_model', input_model),
        input_config = COALESCE(v_sub -> 'input_config', input_config)
      WHERE id = v_existing_sub_id;
    END IF;

    FOR v_norm_row IN SELECT * FROM jsonb_array_elements(v_sub -> 'norms')
    LOOP
      IF NOT EXISTS (
        SELECT 1 FROM official_norms n
        WHERE n.subtest_id = v_existing_sub_id
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
        INSERT INTO official_norms (subtest_id, organization_id, age_min_months, age_max_months, gender, raw_min, raw_max, mean, sd, standard_score, percentile)
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

  RETURN jsonb_build_object('new_subtests', v_new_subtests, 'new_norms', v_new_norms);
END;
$$;

CREATE OR REPLACE FUNCTION public.attach_subtests_to_test(p_test_id text, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid;
  v_sub jsonb;
  v_norm_row jsonb;
  v_sub_name text;
  v_sub_id text;
  v_existing_sub_id text;
  v_new_subtests int := 0;
  v_new_norms int := 0;
  v_test_exists boolean;
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

  FOR v_sub IN SELECT * FROM jsonb_array_elements(p_payload -> 'subtests')
  LOOP
    v_sub_name := v_sub ->> 'name';
    v_existing_sub_id := NULL;

    SELECT s.id INTO v_existing_sub_id
    FROM official_subtests s
    WHERE s.test_id = p_test_id
      AND s.organization_id = v_org_id
      AND norm_subtest_name(s.name) = norm_subtest_name(v_sub_name)
    LIMIT 1;

    IF v_existing_sub_id IS NULL THEN
      SELECT s.id INTO v_existing_sub_id
      FROM official_subtests s
      WHERE s.test_id = p_test_id
        AND s.organization_id IS NULL
        AND norm_subtest_name(s.name) = norm_subtest_name(v_sub_name)
      LIMIT 1;
    END IF;

    IF v_existing_sub_id IS NULL THEN
      v_sub_id := p_test_id || '_' || left(regexp_replace(lower(public.unaccent(trim(v_sub_name))), '[^a-z0-9]+', '_', 'g'), 50) || '_' || left(v_org_id::text, 8);
      INSERT INTO official_subtests (
        id,
        test_id,
        name,
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
        COALESCE(v_sub ->> 'unit', 'pts'),
        COALESCE(v_sub ->> 'score_type', 'standard'),
        COALESCE(v_sub ->> 'computation_mode', 'LOOKUP'),
        COALESCE(v_sub ->> 'input_model', 'numeric_4mode'),
        COALESCE(v_sub -> 'input_config', '{}'::jsonb),
        v_org_id
      );
      v_new_subtests := v_new_subtests + 1;
      v_existing_sub_id := v_sub_id;
    END IF;

    FOR v_norm_row IN SELECT * FROM jsonb_array_elements(v_sub -> 'norms')
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
$$;

COMMIT;;
