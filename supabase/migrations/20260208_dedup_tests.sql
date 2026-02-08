-- ============================================================
-- Migration: Test deduplication safety net + MABC-2 cleanup
-- Date: 2026-02-08
-- 
-- IMPORTANT: The normalization must match JS normalizeTestName():
--   trim → lower → unaccent → strip [^a-z0-9]
-- Without unaccent, 'préférée' → strips 'é' entirely instead of → 'preferee'
-- ============================================================

-- Enable unaccent extension (idempotent)
CREATE EXTENSION IF NOT EXISTS unaccent SCHEMA public;

-- Helper: normalize a test/subtest name identically to JS normalizeTestName()
-- Usage: norm_name(name) = norm_name(other_name)
CREATE OR REPLACE FUNCTION public.norm_name(input TEXT)
RETURNS TEXT LANGUAGE SQL IMMUTABLE PARALLEL SAFE AS $$
    SELECT regexp_replace(lower(public.unaccent(trim(COALESCE(input, '')))), '[^a-z0-9]', '', 'g')
$$;

-- PART 1: Clean up duplicate subtests within same test (by normalized name)
-- This handles the case where subtests were already re-assigned to the target
-- test_id but still exist as duplicates (e.g. "Tirelire main préférée" vs "tirelire_main_preferee")
-- Also cleans up any orphaned source test rows.

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
    -- For each test, find subtest groups that share the same normalized name
    FOR v_test IN
        SELECT DISTINCT test_id FROM official_subtests
    LOOP
        FOR v_dup_group IN
            SELECT norm_name(name) AS nname, 
                   array_agg(id ORDER BY created_at ASC) AS ids,
                   count(*) AS cnt
            FROM official_subtests
            WHERE test_id = v_test.test_id
            GROUP BY norm_name(name)
            HAVING count(*) > 1
        LOOP
            -- Keep the oldest (first created), merge others into it
            v_keeper_id := v_dup_group.ids[1];

            FOR v_victim IN
                SELECT id FROM official_subtests 
                WHERE id = ANY(v_dup_group.ids) AND id != v_keeper_id
            LOOP
                -- Migrate non-duplicate norms from victim → keeper
                FOR v_norm IN
                    SELECT * FROM official_norms WHERE subtest_id = v_victim.id
                LOOP
                    SELECT EXISTS(
                        SELECT 1 FROM official_norms
                        WHERE subtest_id = v_keeper_id
                          AND age_min_months IS NOT DISTINCT FROM v_norm.age_min_months
                          AND age_max_months IS NOT DISTINCT FROM v_norm.age_max_months
                          AND gender IS NOT DISTINCT FROM v_norm.gender
                    ) INTO v_exists;

                    IF NOT v_exists THEN
                        UPDATE official_norms 
                        SET subtest_id = v_keeper_id
                        WHERE id = v_norm.id;
                        v_migrated := v_migrated + 1;
                    END IF;
                END LOOP;

                -- Delete leftover duplicate norms
                DELETE FROM official_norms WHERE subtest_id = v_victim.id;
                -- Delete the victim subtest
                DELETE FROM official_subtests WHERE id = v_victim.id;
                v_deleted_subs := v_deleted_subs + 1;
            END LOOP;
        END LOOP;
    END LOOP;

    -- Clean up any orphaned test rows (tests with no subtests left, e.g. the old source)
    DELETE FROM official_tests t
    WHERE NOT EXISTS (SELECT 1 FROM official_subtests s WHERE s.test_id = t.id);

    RAISE NOTICE 'Dedup complete: % norms migrated, % duplicate subtests removed', v_migrated, v_deleted_subs;
END $$;

-- PART 2: Unique index on (normalized name, scope) as safety net
-- Uses norm_name() for accent+punctuation-safe comparison.
-- Uses COALESCE to treat NULL organization_id (public) as a fixed UUID sentinel
-- so that uniqueness covers both public-public and private-within-same-org duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS idx_official_tests_name_scope 
ON official_tests (
    norm_name(name),
    COALESCE(organization_id, '00000000-0000-0000-0000-000000000000')
);
