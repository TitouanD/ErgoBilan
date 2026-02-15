
-- ============================================================
-- RPC: admin_find_duplicates
-- ============================================================

CREATE OR REPLACE FUNCTION public.admin_find_duplicates(
  p_threshold float DEFAULT 0.4
)
RETURNS TABLE(
  test_id_a text,
  test_name_a text,
  org_id_a uuid,
  subtests_count_a bigint,
  norms_count_a bigint,
  test_id_b text,
  test_name_b text,
  org_id_b uuid,
  subtests_count_b bigint,
  norms_count_b bigint,
  similarity_score float
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT check_is_admin() THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    SELECT
      a.id AS test_id_a,
      a.name AS test_name_a,
      a.organization_id AS org_id_a,
      (SELECT count(*) FROM official_subtests WHERE test_id = a.id) AS subtests_count_a,
      (SELECT count(*) FROM official_norms n JOIN official_subtests s ON s.id = n.subtest_id WHERE s.test_id = a.id) AS norms_count_a,
      b.id AS test_id_b,
      b.name AS test_name_b,
      b.organization_id AS org_id_b,
      (SELECT count(*) FROM official_subtests WHERE test_id = b.id) AS subtests_count_b,
      (SELECT count(*) FROM official_norms n JOIN official_subtests s ON s.id = n.subtest_id WHERE s.test_id = b.id) AS norms_count_b,
      similarity(norm_name(a.name), norm_name(b.name))::float AS similarity_score
    FROM official_tests a
    CROSS JOIN official_tests b
    WHERE a.id < b.id
      AND similarity(norm_name(a.name), norm_name(b.name)) > p_threshold
    ORDER BY similarity_score DESC;
END;
$function$;

-- ============================================================
-- RPC: admin_merge_tests
-- ============================================================

CREATE OR REPLACE FUNCTION public.admin_merge_tests(
  p_source_ids text[],
  p_target_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_source_id text;
  v_source_sub RECORD;
  v_target_sub_id text;
  v_merged_tests int := 0;
  v_moved_subtests int := 0;
  v_migrated_norms int := 0;
  v_updated_sessions int := 0;
  v_target_name text;
  v_row_cnt int;
BEGIN
  IF NOT check_is_admin() THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT t.name INTO v_target_name FROM official_tests t WHERE t.id = p_target_id;
  IF v_target_name IS NULL THEN
    RAISE EXCEPTION 'Target test not found: %', p_target_id;
  END IF;

  FOREACH v_source_id IN ARRAY p_source_ids
  LOOP
    IF v_source_id = p_target_id THEN CONTINUE; END IF;

    FOR v_source_sub IN
      SELECT s.id, s.name, s.unit, s.score_type, s.computation_mode, s.organization_id
      FROM official_subtests s WHERE s.test_id = v_source_id
    LOOP
      SELECT s.id INTO v_target_sub_id
      FROM official_subtests s
      WHERE s.test_id = p_target_id
        AND norm_subtest_name(s.name) = norm_subtest_name(v_source_sub.name)
        AND s.organization_id IS NOT DISTINCT FROM v_source_sub.organization_id
      LIMIT 1;

      IF v_target_sub_id IS NOT NULL THEN
        -- Migrate norms with full 9-field dedup
        WITH inserted AS (
          INSERT INTO official_norms (subtest_id, organization_id, age_min_months, age_max_months, gender, raw_min, raw_max, mean, sd, standard_score, percentile)
          SELECT v_target_sub_id, n.organization_id, n.age_min_months, n.age_max_months, n.gender,
                 n.raw_min, n.raw_max, n.mean, n.sd, n.standard_score, n.percentile
          FROM official_norms n
          WHERE n.subtest_id = v_source_sub.id
            AND NOT EXISTS (
              SELECT 1 FROM official_norms ex
              WHERE ex.subtest_id = v_target_sub_id
                AND ex.age_min_months IS NOT DISTINCT FROM n.age_min_months
                AND ex.age_max_months IS NOT DISTINCT FROM n.age_max_months
                AND ex.gender IS NOT DISTINCT FROM n.gender
                AND ex.raw_min IS NOT DISTINCT FROM n.raw_min
                AND ex.raw_max IS NOT DISTINCT FROM n.raw_max
                AND ex.mean IS NOT DISTINCT FROM n.mean
                AND ex.sd IS NOT DISTINCT FROM n.sd
                AND ex.standard_score IS NOT DISTINCT FROM n.standard_score
                AND ex.percentile IS NOT DISTINCT FROM n.percentile
            )
          RETURNING id
        )
        SELECT count(*) INTO v_row_cnt FROM inserted;
        v_migrated_norms := v_migrated_norms + v_row_cnt;

        -- Remap contribution_insights
        UPDATE contribution_insights SET subtest_id = v_target_sub_id WHERE subtest_id = v_source_sub.id;

        -- Delete source subtest (CASCADE deletes remaining norms)
        DELETE FROM official_norms WHERE subtest_id = v_source_sub.id;
        DELETE FROM official_subtests WHERE id = v_source_sub.id;
      ELSE
        -- No match: move subtest to target
        UPDATE official_subtests SET test_id = p_target_id WHERE id = v_source_sub.id;
        v_moved_subtests := v_moved_subtests + 1;
      END IF;
    END LOOP;

    -- Remap sessions
    WITH updated AS (
      UPDATE sessions SET test_id = p_target_id, test_name = v_target_name
      WHERE test_id = v_source_id
      RETURNING id
    )
    SELECT count(*) INTO v_row_cnt FROM updated;
    v_updated_sessions := v_updated_sessions + v_row_cnt;

    -- Remap contribution_insights test-level
    UPDATE contribution_insights SET test_id = p_target_id WHERE test_id = v_source_id;

    -- Delete source test
    DELETE FROM official_tests WHERE id = v_source_id;
    v_merged_tests := v_merged_tests + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'merged_tests', v_merged_tests,
    'moved_subtests', v_moved_subtests,
    'migrated_norms', v_migrated_norms,
    'updated_sessions', v_updated_sessions,
    'target_name', v_target_name
  );
END;
$function$;

-- ============================================================
-- RPC: admin_promote_subtests
-- ============================================================

CREATE OR REPLACE FUNCTION public.admin_promote_subtests(
  p_subtest_ids text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_promoted int := 0;
  v_sub_id text;
BEGIN
  IF NOT check_is_admin() THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  FOREACH v_sub_id IN ARRAY p_subtest_ids
  LOOP
    UPDATE official_subtests SET organization_id = NULL WHERE id = v_sub_id AND organization_id IS NOT NULL;
    IF FOUND THEN
      UPDATE official_norms SET organization_id = NULL WHERE subtest_id = v_sub_id AND organization_id IS NOT NULL;
      v_promoted := v_promoted + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('promoted', v_promoted);
END;
$function$;
;
