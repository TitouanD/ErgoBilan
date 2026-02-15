-- Migration: Subtest normalization v3
-- Date: 2026-02-10
-- Purpose: Strip test prefixes (M-ABC 2) and re-dedup

BEGIN;

CREATE EXTENSION IF NOT EXISTS unaccent SCHEMA public;

CREATE OR REPLACE FUNCTION public.norm_subtest_name(input TEXT)
RETURNS TEXT LANGUAGE SQL IMMUTABLE PARALLEL SAFE AS $$
  WITH base AS (
    SELECT lower(public.unaccent(trim(COALESCE(input, '')))) AS v
  ),
  stripped AS (
    SELECT regexp_replace(
      regexp_replace(
        regexp_replace(v,
          '^m\\s*-?\\s*abc\\s*2\\s*[:\\-_]*\\s*', '', 'g'
        ),
        '^mabc\\s*2\\s*[:\\-_]*\\s*', '', 'g'
      ),
      '^mabc2\\s*[:\\-_]*\\s*', '', 'g'
    ) AS v
    FROM base
  ),
  cleaned AS (
    SELECT regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              regexp_replace(
                regexp_replace(
                  regexp_replace(v,
                    '\\(([^)]*(age|ans|mois|[0-9]+\\s*;\\s*[0-9]+|[0-9]+\\s*[-:]\\s*[0-9]+)[^)]*)\\)', ' ', 'g'
                  ),
                  '\\bage\\s*[0-9].*$', ' ', 'g'
                ),
                '\\b(une|un|one)\\b', '1', 'g'
              ),
              '\\b(deux|two)\\b', '2', 'g'
            ),
            '\\b(trois|three)\\b', '3', 'g'
          ),
          '\\b(meilleure)\\b', 'meilleur', 'g'
        ),
        '\\b(prefered|preferred|preferee|prefere)\\b', 'prefere', 'g'
      ),
      '\\b(meilleur\\s+main|main\\s+meilleur|prefere\\s+main|main\\s+prefere)\\b', '1 main meilleur', 'g'
    ) AS v
    FROM stripped
  )
  SELECT regexp_replace(v, '[^a-z0-9]', '', 'g') FROM cleaned;
$$;

DO $$
DECLARE
  v_test RECORD;
  v_dup_group RECORD;
  v_keeper_id TEXT;
  v_victim RECORD;
  v_norm RECORD;
  v_exists BOOLEAN;
  v_migrated INT := 0;
  v_deleted_subs INT := 0;
BEGIN
  FOR v_test IN
    SELECT DISTINCT test_id FROM official_subtests
  LOOP
    FOR v_dup_group IN
      SELECT norm_subtest_name(name) AS nname,
             array_agg(id ORDER BY created_at ASC) AS ids,
             count(*) AS cnt
      FROM official_subtests
      WHERE test_id = v_test.test_id
      GROUP BY norm_subtest_name(name)
      HAVING count(*) > 1
    LOOP
      v_keeper_id := v_dup_group.ids[1];

      FOR v_victim IN
        SELECT id FROM official_subtests
        WHERE id = ANY(v_dup_group.ids) AND id != v_keeper_id
      LOOP
        UPDATE contribution_insights
        SET subtest_id = v_keeper_id
        WHERE subtest_id = v_victim.id;

        FOR v_norm IN
          SELECT * FROM official_norms WHERE subtest_id = v_victim.id
        LOOP
          SELECT EXISTS(
            SELECT 1 FROM official_norms
            WHERE subtest_id = v_keeper_id
              AND age_min_months IS NOT DISTINCT FROM v_norm.age_min_months
              AND age_max_months IS NOT DISTINCT FROM v_norm.age_max_months
              AND gender IS NOT DISTINCT FROM v_norm.gender
              AND raw_min IS NOT DISTINCT FROM v_norm.raw_min
              AND raw_max IS NOT DISTINCT FROM v_norm.raw_max
              AND mean IS NOT DISTINCT FROM v_norm.mean
              AND sd IS NOT DISTINCT FROM v_norm.sd
              AND standard_score IS NOT DISTINCT FROM v_norm.standard_score
              AND percentile IS NOT DISTINCT FROM v_norm.percentile
          ) INTO v_exists;

          IF NOT v_exists THEN
            UPDATE official_norms
            SET subtest_id = v_keeper_id
            WHERE id = v_norm.id;
            v_migrated := v_migrated + 1;
          END IF;
        END LOOP;

        DELETE FROM official_norms WHERE subtest_id = v_victim.id;
        DELETE FROM official_subtests WHERE id = v_victim.id;
        v_deleted_subs := v_deleted_subs + 1;
      END LOOP;
    END LOOP;
  END LOOP;

  RAISE NOTICE 'Dedup complete: % norms migrated, % duplicate subtests removed', v_migrated, v_deleted_subs;
END $$;

DROP INDEX IF EXISTS idx_official_subtests_test_norm_subname;
CREATE UNIQUE INDEX IF NOT EXISTS idx_official_subtests_test_norm_subname
ON official_subtests (test_id, norm_subtest_name(name));

-- ADMIN: PROMOTE PRIVATE TEST (MERGE IF EXISTS)
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

  FOR v_private_sub IN
    SELECT id, name FROM official_subtests WHERE test_id = p_test_id
  LOOP
    SELECT id INTO v_target_sub_id
    FROM official_subtests
    WHERE test_id = v_public_test.id
      AND norm_subtest_name(name) = norm_subtest_name(v_private_sub.name)
    LIMIT 1;

    IF v_target_sub_id IS NULL THEN
      UPDATE official_subtests
      SET test_id = v_public_test.id,
          organization_id = NULL
      WHERE id = v_private_sub.id;

      UPDATE official_norms
      SET organization_id = NULL
      WHERE subtest_id = v_private_sub.id;

      v_new_subtests := v_new_subtests + 1;
    ELSE
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
            AND e.age_min_months IS NOT DISTINCT FROM n.age_min_months
            AND e.age_max_months IS NOT DISTINCT FROM n.age_max_months
            AND e.gender IS NOT DISTINCT FROM n.gender
            AND e.raw_min IS NOT DISTINCT FROM n.raw_min
            AND e.raw_max IS NOT DISTINCT FROM n.raw_max
            AND e.mean IS NOT DISTINCT FROM n.mean
            AND e.sd IS NOT DISTINCT FROM n.sd
            AND e.standard_score IS NOT DISTINCT FROM n.standard_score
            AND e.percentile IS NOT DISTINCT FROM n.percentile
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
;
