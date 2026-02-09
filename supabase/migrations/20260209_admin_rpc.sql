-- Migration: Admin RPC + Test Write Functions
-- Date: 2026-02-09
-- Purpose: Secure admin operations and test writes via SECURITY DEFINER RPCs

BEGIN;

-- -----------------------------------------------------------------------------
-- ADMIN CHECK
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_check()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(check_is_admin(), false);
$$;

REVOKE ALL ON FUNCTION public.admin_check() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_check() TO authenticated;

-- -----------------------------------------------------------------------------
-- ADMIN: LIST CANDIDATES (PRIVATE TESTS)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_candidates()
RETURNS TABLE(
  id text,
  name text,
  author text,
  organization_id uuid,
  created_at timestamptz,
  subtest_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT check_is_admin() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    SELECT
      t.id,
      t.name,
      t.author,
      t.organization_id,
      t.created_at,
      (SELECT count(*) FROM official_subtests s WHERE s.test_id = t.id) AS subtest_count
    FROM official_tests t
    WHERE t.organization_id IS NOT NULL
    ORDER BY t.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_candidates() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_candidates() TO authenticated;

-- -----------------------------------------------------------------------------
-- ADMIN: LIST TESTS (PUBLIC/PRIVATE/ALL)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_tests(p_scope text DEFAULT 'public')
RETURNS TABLE(
  id text,
  name text,
  category_id text,
  organization_id uuid,
  created_at timestamptz,
  subtest_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT check_is_admin() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    SELECT
      t.id,
      t.name,
      t.category_id,
      t.organization_id,
      t.created_at,
      (SELECT count(*) FROM official_subtests s WHERE s.test_id = t.id) AS subtest_count
    FROM official_tests t
    WHERE (
      CASE
        WHEN p_scope = 'public' THEN t.organization_id IS NULL
        WHEN p_scope = 'private' THEN t.organization_id IS NOT NULL
        ELSE TRUE
      END
    )
    ORDER BY t.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_tests(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_tests(text) TO authenticated;

-- -----------------------------------------------------------------------------
-- ADMIN: GET TEST BUNDLE (TEST + SUBTESTS + NORMS)
-- -----------------------------------------------------------------------------
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

REVOKE ALL ON FUNCTION public.admin_get_test_bundle(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_test_bundle(text) TO authenticated;

-- -----------------------------------------------------------------------------
-- ADMIN: SAVE TEST BUNDLE (UPSERT TEST + SUBTESTS, REPLACE NORMS)
-- -----------------------------------------------------------------------------
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
      organization_id
    )
    VALUES (
      v_sub->>'id',
      v_test_id,
      COALESCE(v_sub->>'name', ''),
      COALESCE(v_sub->>'unit', 'pts'),
      COALESCE(v_sub->>'score_type', 'standard'),
      COALESCE(v_sub->>'computation_mode', 'LOOKUP'),
      COALESCE(NULLIF(v_sub->>'organization_id', '')::uuid, v_org_id)
    )
    ON CONFLICT (id) DO UPDATE SET
      test_id = EXCLUDED.test_id,
      name = EXCLUDED.name,
      unit = EXCLUDED.unit,
      score_type = EXCLUDED.score_type,
      computation_mode = EXCLUDED.computation_mode,
      organization_id = EXCLUDED.organization_id;
  END LOOP;

  -- Replace norms for the provided subtests
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

REVOKE ALL ON FUNCTION public.admin_save_test_bundle(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_save_test_bundle(jsonb) TO authenticated;

-- -----------------------------------------------------------------------------
-- ADMIN: DELETE TEST / SUBTEST
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_delete_test(p_test_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT check_is_admin() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  DELETE FROM official_tests WHERE id = p_test_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_test(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_delete_test(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_delete_subtest(p_subtest_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT check_is_admin() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  DELETE FROM official_subtests WHERE id = p_subtest_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_subtest(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_delete_subtest(text) TO authenticated;

-- -----------------------------------------------------------------------------
-- ADMIN: PROMOTE PRIVATE TEST (MERGE IF EXISTS)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_promote_test(p_test_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_private_test record;
  v_public_test record;
  v_private_sub record;
  v_target_sub_id text;
  v_new_subtests integer := 0;
  v_merged_norms integer := 0;
  v_rows integer := 0;
BEGIN
  IF NOT check_is_admin() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  SELECT id, name INTO v_private_test
  FROM official_tests
  WHERE id = p_test_id;

  IF v_private_test IS NULL THEN
    RAISE EXCEPTION 'Test introuvable';
  END IF;

  SELECT id, name INTO v_public_test
  FROM official_tests
  WHERE organization_id IS NULL
    AND norm_name(name) = norm_name(v_private_test.name)
  LIMIT 1;

  -- Simple promotion if no public match
  IF v_public_test IS NULL THEN
    UPDATE official_norms
    SET organization_id = NULL
    WHERE subtest_id IN (SELECT id FROM official_subtests WHERE test_id = p_test_id);

    UPDATE official_subtests
    SET organization_id = NULL
    WHERE test_id = p_test_id;

    UPDATE official_tests
    SET organization_id = NULL
    WHERE id = p_test_id;

    RETURN jsonb_build_object('merged', false, 'target_name', v_private_test.name);
  END IF;

  -- Merge private into existing public test
  FOR v_private_sub IN
    SELECT id, name FROM official_subtests WHERE test_id = p_test_id
  LOOP
    SELECT id INTO v_target_sub_id
    FROM official_subtests
    WHERE test_id = v_public_test.id
      AND norm_name(name) = norm_name(v_private_sub.name)
    LIMIT 1;

    IF v_target_sub_id IS NULL THEN
      -- Move private subtest under public test
      UPDATE official_subtests
      SET test_id = v_public_test.id,
          organization_id = NULL
      WHERE id = v_private_sub.id;

      UPDATE official_norms
      SET organization_id = NULL
      WHERE subtest_id = v_private_sub.id;

      v_new_subtests := v_new_subtests + 1;
    ELSE
      -- Insert only non-duplicate norms
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
        v_target_sub_id,
        NULL,
        n.age_min_months,
        n.age_max_months,
        n.gender,
        n.raw_min,
        n.raw_max,
        n.mean,
        n.sd,
        n.standard_score,
        n.percentile
      FROM official_norms n
      WHERE n.subtest_id = v_private_sub.id
        AND NOT EXISTS (
          SELECT 1 FROM official_norms e
          WHERE e.subtest_id = v_target_sub_id
            AND e.age_min_months = n.age_min_months
            AND e.age_max_months = n.age_max_months
            AND e.gender = n.gender
        );

      GET DIAGNOSTICS v_rows = ROW_COUNT;
      v_merged_norms := v_merged_norms + v_rows;

      DELETE FROM official_norms WHERE subtest_id = v_private_sub.id;
      DELETE FROM official_subtests WHERE id = v_private_sub.id;
    END IF;
  END LOOP;

  DELETE FROM official_tests WHERE id = p_test_id;

  RETURN jsonb_build_object(
    'merged', true,
    'target_name', v_public_test.name,
    'new_subtests', v_new_subtests,
    'merged_norms', v_merged_norms
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_promote_test(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_promote_test(text) TO authenticated;

-- -----------------------------------------------------------------------------
-- USER: FIND PRIVATE TEST BY NORMALIZED NAME
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.find_private_test_by_name(p_name text)
RETURNS TABLE(
  id text,
  name text,
  subtest_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid;
BEGIN
  SELECT organization_id INTO v_org_id
  FROM organization_members
  WHERE user_id = auth.uid()
  LIMIT 1;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'No organization found for user' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    SELECT
      t.id,
      t.name,
      (SELECT count(*) FROM official_subtests s WHERE s.test_id = t.id) AS subtest_count
    FROM official_tests t
    WHERE t.organization_id = v_org_id
      AND norm_name(t.name) = norm_name(p_name);
END;
$$;

REVOKE ALL ON FUNCTION public.find_private_test_by_name(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.find_private_test_by_name(text) TO authenticated;

-- -----------------------------------------------------------------------------
-- USER: CREATE PRIVATE TEST (WITH SUBTESTS + NORMS)
-- -----------------------------------------------------------------------------
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
      organization_id
    )
    VALUES (
      v_sub_id,
      v_test_id,
      v_sub_name,
      COALESCE(v_sub->>'unit', 'pts'),
      COALESCE(v_sub->>'score_type', 'standard'),
      COALESCE(v_sub->>'computation_mode', 'LOOKUP'),
      v_org_id
    );

    v_norms := v_sub->'norms';
    IF v_norms IS NOT NULL AND jsonb_array_length(v_norms) > 0 THEN
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
        NULLIF(n->>'age_min_months', '')::integer,
        NULLIF(n->>'age_max_months', '')::integer,
        COALESCE(n->>'gender', 'Mixed'),
        NULLIF(n->>'raw_min', '')::real,
        NULLIF(n->>'raw_max', '')::real,
        NULLIF(n->>'mean', '')::real,
        NULLIF(n->>'sd', '')::real,
        NULLIF(n->>'standard_score', '')::real,
        NULLIF(n->>'percentile', '')::real
      FROM jsonb_array_elements(v_norms) AS n;
    END IF;
  END LOOP;

  RETURN v_test_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_private_test(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_private_test(jsonb) TO authenticated;

-- -----------------------------------------------------------------------------
-- USER: MERGE INTO EXISTING PRIVATE TEST
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.merge_private_test(p_target_id text, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid;
  v_target_org uuid;
  v_sub jsonb;
  v_sub_name text;
  v_sub_id text;
  v_existing_id text;
  v_subtests jsonb;
  v_norms jsonb;
  v_new_subtests integer := 0;
  v_new_norms integer := 0;
  v_rows integer := 0;
BEGIN
  SELECT organization_id INTO v_org_id
  FROM organization_members
  WHERE user_id = auth.uid()
  LIMIT 1;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'No organization found for user' USING ERRCODE = '42501';
  END IF;

  SELECT organization_id INTO v_target_org
  FROM official_tests
  WHERE id = p_target_id;

  IF v_target_org IS NULL OR v_target_org <> v_org_id THEN
    RAISE EXCEPTION 'Test not accessible' USING ERRCODE = '42501';
  END IF;

  v_subtests := COALESCE(p_payload->'subtests', '[]'::jsonb);
  FOR v_sub IN SELECT * FROM jsonb_array_elements(v_subtests)
  LOOP
    v_sub_name := COALESCE(v_sub->>'name', '');
    IF v_sub_name = '' THEN
      RAISE EXCEPTION 'Subtest name missing';
    END IF;

    SELECT id INTO v_existing_id
    FROM official_subtests
    WHERE test_id = p_target_id
      AND norm_name(name) = norm_name(v_sub_name)
    LIMIT 1;

    IF v_existing_id IS NULL THEN
      v_sub_id := concat(
        p_target_id,
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
        organization_id
      )
      VALUES (
        v_sub_id,
        p_target_id,
        v_sub_name,
        COALESCE(v_sub->>'unit', 'pts'),
        COALESCE(v_sub->>'score_type', 'standard'),
        COALESCE(v_sub->>'computation_mode', 'LOOKUP'),
        v_org_id
      );

      v_existing_id := v_sub_id;
      v_new_subtests := v_new_subtests + 1;
    END IF;

    v_norms := v_sub->'norms';
    IF v_norms IS NOT NULL AND jsonb_array_length(v_norms) > 0 THEN
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
        v_existing_id,
        v_org_id,
        NULLIF(n->>'age_min_months', '')::integer,
        NULLIF(n->>'age_max_months', '')::integer,
        COALESCE(n->>'gender', 'Mixed'),
        NULLIF(n->>'raw_min', '')::real,
        NULLIF(n->>'raw_max', '')::real,
        NULLIF(n->>'mean', '')::real,
        NULLIF(n->>'sd', '')::real,
        NULLIF(n->>'standard_score', '')::real,
        NULLIF(n->>'percentile', '')::real
      FROM jsonb_array_elements(v_norms) AS n
      WHERE NOT EXISTS (
        SELECT 1 FROM official_norms e
        WHERE e.subtest_id = v_existing_id
          AND e.age_min_months = NULLIF(n->>'age_min_months', '')::integer
          AND e.age_max_months = NULLIF(n->>'age_max_months', '')::integer
          AND e.gender = COALESCE(n->>'gender', 'Mixed')
      );

      GET DIAGNOSTICS v_rows = ROW_COUNT;
      v_new_norms := v_new_norms + v_rows;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'new_subtests', v_new_subtests,
    'new_norms', v_new_norms
  );
END;
$$;

REVOKE ALL ON FUNCTION public.merge_private_test(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.merge_private_test(text, jsonb) TO authenticated;

COMMIT;

