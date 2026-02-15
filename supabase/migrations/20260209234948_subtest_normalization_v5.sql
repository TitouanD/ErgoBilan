-- Migration: Subtest normalization v5
-- Date: 2026-02-10
-- Purpose: Robust M-ABC 2 prefix stripping + case-insensitive age removal

BEGIN;

CREATE EXTENSION IF NOT EXISTS unaccent SCHEMA public;

CREATE OR REPLACE FUNCTION public.norm_subtest_name(input TEXT)
RETURNS TEXT LANGUAGE SQL IMMUTABLE PARALLEL SAFE AS $$
  WITH base AS (
    SELECT lower(public.unaccent(trim(COALESCE(input, '')))) AS v
  ),
  stripped AS (
    SELECT regexp_replace(
      v,
      '^m[^a-z0-9]*abc[^a-z0-9]*2[^a-z0-9]*',
      '',
      'g'
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
                    '\\(([^)]*(age|ans|mois)[^)]*)\\)', ' ', 'gi'
                  ),
                  '\\bage\\s*[0-9].*$', ' ', 'gi'
                ),
                '\\b(une|un|one)\\b', '1', 'gi'
              ),
              '\\b(deux|two)\\b', '2', 'gi'
            ),
            '\\b(trois|three)\\b', '3', 'gi'
          ),
          '\\b(meilleure)\\b', 'meilleur', 'gi'
        ),
        '\\b(prefered|preferred|preferee|prefere)\\b', 'prefere', 'gi'
      ),
      '\\b(meilleur\\s+main|main\\s+meilleur|prefere\\s+main|main\\s+prefere)\\b', '1 main meilleur', 'gi'
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

COMMIT;
;
