
-- ===================================================================
-- 1) Find duplicate subtests within a single test (name similarity)
-- ===================================================================
CREATE OR REPLACE FUNCTION admin_find_duplicate_subtests(p_test_id text, p_threshold real DEFAULT 0.5)
RETURNS TABLE(
  subtest_id_a text,
  subtest_name_a text,
  org_id_a uuid,
  norms_count_a bigint,
  subtest_id_b text,
  subtest_name_b text,
  org_id_b uuid,
  norms_count_b bigint,
  similarity_score real
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT check_is_admin() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    SELECT
      a.id AS subtest_id_a,
      a.name AS subtest_name_a,
      a.organization_id AS org_id_a,
      (SELECT count(*) FROM official_norms n WHERE n.subtest_id = a.id) AS norms_count_a,
      b.id AS subtest_id_b,
      b.name AS subtest_name_b,
      b.organization_id AS org_id_b,
      (SELECT count(*) FROM official_norms n WHERE n.subtest_id = b.id) AS norms_count_b,
      similarity(lower(unaccent(a.name)), lower(unaccent(b.name))) AS similarity_score
    FROM official_subtests a
    JOIN official_subtests b ON a.test_id = b.test_id AND a.id < b.id
    WHERE a.test_id = p_test_id
      AND similarity(lower(unaccent(a.name)), lower(unaccent(b.name))) >= p_threshold
    ORDER BY similarity_score DESC;
END;
$$;

-- ===================================================================
-- 2) Merge subtests: move all norms from source into target, delete source
-- ===================================================================
CREATE OR REPLACE FUNCTION admin_merge_subtests(p_source_ids text[], p_target_id text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_migrated_norms bigint := 0;
  v_rows bigint;
  v_target_name text;
  v_source_id text;
BEGIN
  IF NOT check_is_admin() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  SELECT name INTO v_target_name FROM official_subtests WHERE id = p_target_id;
  IF v_target_name IS NULL THEN
    RAISE EXCEPTION 'Target subtest not found: %', p_target_id;
  END IF;

  FOREACH v_source_id IN ARRAY p_source_ids LOOP
    IF v_source_id = p_target_id THEN CONTINUE; END IF;

    -- Move norms from source to target
    UPDATE official_norms SET subtest_id = p_target_id WHERE subtest_id = v_source_id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_migrated_norms := v_migrated_norms + v_rows;

    -- Delete source subtest
    DELETE FROM official_subtests WHERE id = v_source_id;
  END LOOP;

  RETURN jsonb_build_object(
    'merged_subtests', array_length(p_source_ids, 1),
    'migrated_norms', v_migrated_norms,
    'target_name', v_target_name
  );
END;
$$;

-- ===================================================================
-- 3) Find exact duplicate norms (grouped by subtest)
-- ===================================================================
CREATE OR REPLACE FUNCTION admin_find_duplicate_norms(p_subtest_id text DEFAULT NULL, p_test_id text DEFAULT NULL)
RETURNS TABLE(
  subtest_id text,
  subtest_name text,
  duplicate_group_count bigint,
  total_excess_rows bigint
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT check_is_admin() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    WITH norm_groups AS (
      SELECT
        n.subtest_id,
        n.age_min_months, n.age_max_months, n.gender,
        n.raw_min, n.raw_max, n.standard_score,
        count(*) AS cnt
      FROM official_norms n
      JOIN official_subtests s ON s.id = n.subtest_id
      WHERE (p_subtest_id IS NULL OR n.subtest_id = p_subtest_id)
        AND (p_test_id IS NULL OR s.test_id = p_test_id)
      GROUP BY n.subtest_id, n.age_min_months, n.age_max_months, n.gender,
               n.raw_min, n.raw_max, n.standard_score
      HAVING count(*) > 1
    )
    SELECT
      ng.subtest_id,
      s.name AS subtest_name,
      count(*)::bigint AS duplicate_group_count,
      sum(ng.cnt - 1)::bigint AS total_excess_rows
    FROM norm_groups ng
    JOIN official_subtests s ON s.id = ng.subtest_id
    GROUP BY ng.subtest_id, s.name
    ORDER BY total_excess_rows DESC;
END;
$$;

-- ===================================================================
-- 4) Deduplicate norms: keep one per unique key, delete extras
-- ===================================================================
CREATE OR REPLACE FUNCTION admin_deduplicate_norms(p_subtest_id text DEFAULT NULL, p_test_id text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_deleted bigint;
BEGIN
  IF NOT check_is_admin() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  WITH ranked AS (
    SELECT
      n.id,
      row_number() OVER (
        PARTITION BY n.subtest_id, n.age_min_months, n.age_max_months, n.gender,
                     n.raw_min, n.raw_max, n.standard_score
        ORDER BY
          CASE WHEN n.organization_id IS NULL THEN 0 ELSE 1 END,
          n.id
      ) AS rn
    FROM official_norms n
    JOIN official_subtests s ON s.id = n.subtest_id
    WHERE (p_subtest_id IS NULL OR n.subtest_id = p_subtest_id)
      AND (p_test_id IS NULL OR s.test_id = p_test_id)
  )
  DELETE FROM official_norms WHERE id IN (SELECT id FROM ranked WHERE rn > 1);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN jsonb_build_object('deleted', v_deleted);
END;
$$;
;
