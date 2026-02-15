
-- Promote org-scoped norms to public (set organization_id = NULL)
-- Can promote per subtest+org, or all norms under a test for a given org, or all pending norms for a test
CREATE OR REPLACE FUNCTION admin_promote_norms(
  p_subtest_id text DEFAULT NULL,
  p_test_id text DEFAULT NULL,
  p_organization_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count int;
BEGIN
  IF NOT check_is_admin() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  -- Mode 1: promote norms for a specific subtest + org
  IF p_subtest_id IS NOT NULL AND p_organization_id IS NOT NULL THEN
    UPDATE official_norms SET organization_id = NULL
    WHERE subtest_id = p_subtest_id AND organization_id = p_organization_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;

  -- Mode 2: promote ALL org-scoped norms for a specific subtest (all orgs)
  ELSIF p_subtest_id IS NOT NULL THEN
    UPDATE official_norms SET organization_id = NULL
    WHERE subtest_id = p_subtest_id AND organization_id IS NOT NULL;
    GET DIAGNOSTICS v_count = ROW_COUNT;

  -- Mode 3: promote all org-scoped norms under a test (optionally filtered by org)
  ELSIF p_test_id IS NOT NULL THEN
    UPDATE official_norms SET organization_id = NULL
    WHERE subtest_id IN (SELECT id FROM official_subtests WHERE test_id = p_test_id)
      AND organization_id IS NOT NULL
      AND (p_organization_id IS NULL OR organization_id = p_organization_id);
    GET DIAGNOSTICS v_count = ROW_COUNT;

  ELSE
    RAISE EXCEPTION 'Must provide p_subtest_id or p_test_id';
  END IF;

  RETURN jsonb_build_object('promoted', v_count);
END;
$$;

-- Also: reject (delete) org-scoped norms
CREATE OR REPLACE FUNCTION admin_reject_norms(
  p_subtest_id text DEFAULT NULL,
  p_test_id text DEFAULT NULL,
  p_organization_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count int;
BEGIN
  IF NOT check_is_admin() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  IF p_subtest_id IS NOT NULL AND p_organization_id IS NOT NULL THEN
    DELETE FROM official_norms
    WHERE subtest_id = p_subtest_id AND organization_id = p_organization_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;

  ELSIF p_subtest_id IS NOT NULL THEN
    DELETE FROM official_norms
    WHERE subtest_id = p_subtest_id AND organization_id IS NOT NULL;
    GET DIAGNOSTICS v_count = ROW_COUNT;

  ELSIF p_test_id IS NOT NULL THEN
    DELETE FROM official_norms
    WHERE subtest_id IN (SELECT id FROM official_subtests WHERE test_id = p_test_id)
      AND organization_id IS NOT NULL
      AND (p_organization_id IS NULL OR organization_id = p_organization_id);
    GET DIAGNOSTICS v_count = ROW_COUNT;

  ELSE
    RAISE EXCEPTION 'Must provide p_subtest_id or p_test_id';
  END IF;

  RETURN jsonb_build_object('rejected', v_count);
END;
$$;
;
