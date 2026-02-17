-- ============================================================
-- Phase 3.3: Integrate Audit Logging into Admin RPCs
-- Purpose: Track all admin actions (merge_tests, promote_subtests, etc.)
--   for compliance and debugging
-- ============================================================

-- ============================================================
-- Update admin_merge_tests to include audit logging
-- ============================================================
-- Description: When admin merges source tests into target test,
--   log the action with affected test IDs, norm IDs, and results

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
  v_admin_user_id uuid;
  v_affected_test_ids text[] := ARRAY[]::text[];
  v_affected_norm_ids text[] := ARRAY[]::text[];
  v_result jsonb;
  v_error_msg text;
BEGIN
  IF NOT check_is_admin() THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  -- Capture admin user ID from JWT
  SELECT auth.uid() INTO v_admin_user_id;

  BEGIN
    SELECT t.name INTO v_target_name FROM official_tests t WHERE t.id = p_target_id;
    IF v_target_name IS NULL THEN
      RAISE EXCEPTION 'Target test not found: %', p_target_id;
    END IF;

    FOREACH v_source_id IN ARRAY p_source_ids
    LOOP
      IF v_source_id = p_target_id THEN CONTINUE; END IF;
      v_affected_test_ids := array_append(v_affected_test_ids, v_source_id);

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
          -- Migrate norms with full 9-field dedup (age, gender, raw, mean, sd, standard_score, percentile)
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
          SELECT ARRAY_AGG(id) INTO v_affected_norm_ids FROM inserted;
          IF v_affected_norm_ids IS NOT NULL THEN
            v_migrated_norms := v_migrated_norms + array_length(v_affected_norm_ids, 1);
          END IF;

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

    -- Build success response
    v_result := jsonb_build_object(
      'merged_tests', v_merged_tests,
      'moved_subtests', v_moved_subtests,
      'migrated_norms', v_migrated_norms,
      'updated_sessions', v_updated_sessions,
      'target_name', v_target_name
    );

    -- ✅ NEW: Log successful admin action to audit trail
    INSERT INTO admin_audit_log (
      admin_user_id,
      action,
      affected_test_ids,
      affected_norm_ids,
      metadata,
      result
    ) VALUES (
      v_admin_user_id,
      'merge_tests',
      v_affected_test_ids,
      v_affected_norm_ids,
      jsonb_build_object('target_id', p_target_id, 'source_count', array_length(p_source_ids, 1)),
      v_result
    );

    RETURN v_result;

  EXCEPTION WHEN others THEN
    v_error_msg := SQLERRM;
    -- ✅ NEW: Log failed admin action to audit trail
    INSERT INTO admin_audit_log (
      admin_user_id,
      action,
      affected_test_ids,
      affected_norm_ids,
      metadata,
      error_message
    ) VALUES (
      v_admin_user_id,
      'merge_tests',
      v_affected_test_ids,
      v_affected_norm_ids,
      jsonb_build_object('target_id', p_target_id, 'source_count', array_length(p_source_ids, 1)),
      v_error_msg
    );
    RAISE;
  END;
END;
$function$;

-- ============================================================
-- Update admin_promote_subtests to include audit logging
-- ============================================================
-- Description: When admin promotes subtests to org-wide catalog,
--   log the action with count and result

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
  v_admin_user_id uuid;
  v_result jsonb;
  v_error_msg text;
BEGIN
  IF NOT check_is_admin() THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  -- Capture admin user ID from JWT
  SELECT auth.uid() INTO v_admin_user_id;

  BEGIN
    FOREACH v_sub_id IN ARRAY p_subtest_ids
    LOOP
      UPDATE official_subtests SET organization_id = NULL WHERE id = v_sub_id AND organization_id IS NOT NULL;
      IF FOUND THEN
        UPDATE official_norms SET organization_id = NULL WHERE subtest_id = v_sub_id AND organization_id IS NOT NULL;
        v_promoted := v_promoted + 1;
      END IF;
    END LOOP;

    -- Build success response
    v_result := jsonb_build_object('promoted', v_promoted);

    -- ✅ NEW: Log successful admin action to audit trail
    INSERT INTO admin_audit_log (
      admin_user_id,
      action,
      metadata,
      result
    ) VALUES (
      v_admin_user_id,
      'promote_subtests',
      jsonb_build_object('subtest_count', array_length(p_subtest_ids, 1)),
      v_result
    );

    RETURN v_result;

  EXCEPTION WHEN others THEN
    v_error_msg := SQLERRM;
    -- ✅ NEW: Log failed admin action to audit trail
    INSERT INTO admin_audit_log (
      admin_user_id,
      action,
      metadata,
      error_message
    ) VALUES (
      v_admin_user_id,
      'promote_subtests',
      jsonb_build_object('subtest_count', array_length(p_subtest_ids, 1)),
      v_error_msg
    );
    RAISE;
  END;
END;
$function$;

-- ============================================================
-- Migration Notes
-- ============================================================
-- 
-- Changes Made:
-- 1. admin_merge_tests:
--    - Added v_admin_user_id, v_affected_test_ids, v_affected_norm_ids
--    - Collect affected IDs during merge operation
--    - Insert audit log on success with action='merge_tests'
--    - Insert audit log on exception with error_message
--
-- 2. admin_promote_subtests:
--    - Added v_admin_user_id capture
--    - Insert audit log on success with action='promote_subtests'
--    - Insert audit log on exception with error_message
--
-- Audit Table: admin_audit_log
--   Columns: id, admin_user_id, action, affected_test_ids, affected_norm_ids,
--            metadata, result, error_message, created_at, updated_at
--   Indexes: idx_admin_audit_log_admin_user_date, idx_admin_audit_log_action_date
--   RLS: Admins can view all, insert own rows
--
-- Verification:
--   SELECT * FROM admin_audit_log WHERE action = 'merge_tests' ORDER BY created_at DESC;
--
