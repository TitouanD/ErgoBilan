-- Admin bundle RPCs: include and persist subtest abbreviation.

CREATE OR REPLACE FUNCTION public.admin_get_test_bundle(p_test_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
          'abbreviation', s.abbreviation,
          'unit', s.unit,
          'score_type', s.score_type,
          'computation_mode', s.computation_mode,
          'input_model', s.input_model,
          'input_config', s.input_config,
          'organization_id', s.organization_id
        ) ORDER BY s.name, s.abbreviation)
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
$function$;

CREATE OR REPLACE FUNCTION public.admin_save_test_bundle(p_payload jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_test jsonb;
  v_test_id text;
  v_org_id uuid;
  v_subtests jsonb;
  v_norms jsonb;
  v_sub jsonb;
  v_sub_name text;
  v_sub_abbreviation text;
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

    v_sub_name := COALESCE(v_sub->>'name', '');
    v_sub_abbreviation := NULLIF(
      upper(regexp_replace(trim(COALESCE(v_sub->>'abbreviation', '')), '\\s+', ' ', 'g')),
      ''
    );

    IF v_sub_abbreviation IS NULL
       AND v_sub_name ~ '\\(([A-Z0-9][A-Z0-9&/ -]{0,19})\\)\\s*$' THEN
      v_sub_abbreviation := upper(regexp_replace(trim((regexp_match(v_sub_name, '\\(([A-Z0-9][A-Z0-9&/ -]{0,19})\\)\\s*$'))[1]), '\\s+', ' ', 'g'));
      v_sub_name := trim(regexp_replace(v_sub_name, '\\s*\\(([A-Z0-9][A-Z0-9&/ -]{0,19})\\)\\s*$', ''));
    END IF;

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
      v_sub->>'id',
      v_test_id,
      v_sub_name,
      v_sub_abbreviation,
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
      abbreviation = EXCLUDED.abbreviation,
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
$function$;
