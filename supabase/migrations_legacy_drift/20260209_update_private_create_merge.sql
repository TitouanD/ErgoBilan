-- Migration: Enforce merge-on-create and dedupe norms
-- Date: 2026-02-09
-- Purpose: Prevent duplicates within same org and payload across create/merge/promote

BEGIN;

-- -----------------------------------------------------------------------------
-- USER: CREATE PRIVATE TEST (MERGE IF EXISTS)
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
      computation_mode
    )
    VALUES (
      v_sub_id,
      v_test_id,
      v_sub_name,
      COALESCE(v_sub->>'unit', 'pts'),
      COALESCE(v_sub->>'score_type', 'standard'),
      COALESCE(v_sub->>'computation_mode', 'LOOKUP')
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
        computation_mode
      )
      VALUES (
        v_sub_id,
        p_target_id,
        v_sub_name,
        COALESCE(v_sub->>'unit', 'pts'),
        COALESCE(v_sub->>'score_type', 'standard'),
        COALESCE(v_sub->>'computation_mode', 'LOOKUP')
      );

      v_existing_id := v_sub_id;
      v_new_subtests := v_new_subtests + 1;
    END IF;

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
        v_existing_id,
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
      FROM new_norms nn
      WHERE NOT EXISTS (
        SELECT 1 FROM official_norms e
        WHERE e.subtest_id = v_existing_id
          AND e.age_min_months IS NOT DISTINCT FROM nn.age_min_months
          AND e.age_max_months IS NOT DISTINCT FROM nn.age_max_months
          AND e.gender IS NOT DISTINCT FROM nn.gender
          AND e.raw_min IS NOT DISTINCT FROM nn.raw_min
          AND e.raw_max IS NOT DISTINCT FROM nn.raw_max
          AND e.mean IS NOT DISTINCT FROM nn.mean
          AND e.sd IS NOT DISTINCT FROM nn.sd
          AND e.standard_score IS NOT DISTINCT FROM nn.standard_score
          AND e.percentile IS NOT DISTINCT FROM nn.percentile
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
        SET test_id = v_public_test.id
      WHERE id = v_private_sub.id;

      UPDATE official_norms
      SET organization_id = NULL
      WHERE subtest_id = v_private_sub.id;

      v_new_subtests := v_new_subtests + 1;
    ELSE
      -- Insert only non-duplicate norms (full row match, NULL-safe)
      WITH source_norms AS (
        SELECT DISTINCT
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
        v_target_sub_id,
        NULL,
        s.age_min_months,
        s.age_max_months,
        s.gender,
        s.raw_min,
        s.raw_max,
        s.mean,
        s.sd,
        s.standard_score,
        s.percentile
      FROM source_norms s
      WHERE NOT EXISTS (
        SELECT 1 FROM official_norms e
        WHERE e.subtest_id = v_target_sub_id
          AND e.age_min_months IS NOT DISTINCT FROM s.age_min_months
          AND e.age_max_months IS NOT DISTINCT FROM s.age_max_months
          AND e.gender IS NOT DISTINCT FROM s.gender
          AND e.raw_min IS NOT DISTINCT FROM s.raw_min
          AND e.raw_max IS NOT DISTINCT FROM s.raw_max
          AND e.mean IS NOT DISTINCT FROM s.mean
          AND e.sd IS NOT DISTINCT FROM s.sd
          AND e.standard_score IS NOT DISTINCT FROM s.standard_score
          AND e.percentile IS NOT DISTINCT FROM s.percentile
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

COMMIT;
