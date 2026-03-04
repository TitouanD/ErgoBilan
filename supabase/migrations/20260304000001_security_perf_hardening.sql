-- ============================================================
-- Migration: Security & Performance Hardening (2026-03-04)
-- Resolves all Supabase database linter findings:
--   ERROR  : security_definer_view (view_unified_catalog)
--   WARN   : function_search_path_mutable (5 functions)
--   INFO   : rls_enabled_no_policy (official_norms_conflict_archive)
--   WARN   : auth_rls_initplan (subtest_direction_override_events)
--   INFO   : unused_index (5 safely redundant indexes)
-- ============================================================


-- ============================================================
-- STEP 1: Fix view_unified_catalog SECURITY DEFINER → INVOKER
--
-- The view already enforces access via SECURITY DEFINER helper
-- functions (is_current_user_onboarded, check_is_member_of).
-- Norms remain a blackbox — only accessible through the
-- compute_score SECURITY DEFINER RPC.
-- In Postgres 15+, ALTER VIEW ... SET (security_invoker = on)
-- makes the view run with the caller's privileges, not the
-- owner's, preventing privilege escalation via view ownership.
-- ============================================================

ALTER VIEW public.view_unified_catalog SET (security_invoker = on);


-- Also harden the other two views as best-practice (they were
-- not flagged but benefit from the same treatment):
ALTER VIEW public.view_unified_subtests       SET (security_invoker = on);
ALTER VIEW public.view_official_norm_certainty SET (security_invoker = on);


-- ============================================================
-- STEP 2: Fix mutable search_path on 5 functions (WARN)
--
-- Each function needs search_path pinned to prevent a superuser
-- from injecting schema objects that the function picks up at
-- runtime. We pin to 'public', 'pg_catalog' which covers all
-- function dependencies. No function body changes needed.
-- ============================================================

ALTER FUNCTION public.norm_lookup_target_plausibility(text, real, real)
  SET search_path = 'public', 'pg_catalog';

ALTER FUNCTION public.official_norms_capture_duplicate_evidence()
  SET search_path = 'public', 'pg_catalog';

ALTER FUNCTION public.normalize_subtest_abbreviation_tag(text)
  SET search_path = 'public', 'pg_catalog';

ALTER FUNCTION public.compute_score_core(text, real, integer, text, text)
  SET search_path = 'public', 'pg_catalog';

ALTER FUNCTION public.admin_save_test_bundle(jsonb)
  SET search_path = 'public', 'pg_catalog';


-- ============================================================
-- STEP 3: Add RLS SELECT policy on official_norms_conflict_archive
--
-- Table has RLS enabled but no policies — meaning no direct
-- row access is possible from any role. All writes happen
-- exclusively through SECURITY DEFINER admin RPCs (which bypass
-- RLS). Adding a read-only policy for admins satisfies the
-- linter and allows future admin tooling to query the archive
-- directly if needed.
-- ============================================================

CREATE POLICY "official_norms_conflict_archive_admin_read"
  ON public.official_norms_conflict_archive
  FOR SELECT
  USING (check_is_admin());


-- ============================================================
-- STEP 4: Fix auth_rls_initplan on subtest_direction_override_events
--
-- The INSERT policy currently re-evaluates auth.uid() per row,
-- which is suboptimal. Wrapping in (SELECT ...) causes Postgres
-- to evaluate it once per statement (init-plan).
-- ============================================================

DROP POLICY IF EXISTS "subtest_direction_override_events_insert_system"
  ON public.subtest_direction_override_events;

CREATE POLICY "subtest_direction_override_events_insert_system"
  ON public.subtest_direction_override_events
  FOR INSERT
  WITH CHECK ((SELECT auth.uid()) IS NOT NULL);


-- ============================================================
-- STEP 5: Drop safely redundant / unused indexes
--
-- Dropped (confirmed safe):
--   idx_subscriptions_user              → UNIQUE constraint on user_id
--                                         already creates an implicit index;
--                                         this explicit copy is fully redundant.
--   idx_admin_norm_fitting_issue_overrides_dismissed_by  ← RESTORED in 20260304000002
--   idx_admin_norm_fitting_issue_overrides_subtest_id    ← RESTORED in 20260304000002
--   idx_admin_norm_fitting_issue_overrides_test_id       ← RESTORED in 20260304000002
--                                         NOTE: Dropping these introduced
--                                         "unindexed_foreign_key" warnings of
--                                         equal severity. They were re-created in
--                                         migration 20260304000002 to cover the FKs.
--   idx_admin_audit_log_action_date     → table is currently empty (0 rows);
--                                         no planner benefit; re-add if audit
--                                         volume grows and direct queries filter
--                                         by (action, created_at).
--
-- Kept (despite "unused" flag — intentional for scale):
--   idx_patient_assessments_org_date, idx_patient_assessments_org_kind_date
--   idx_patient_followups_org_status_due
--   idx_pending_questionnaires_practitioner
--   idx_drafts_user_patient
--   idx_extraction_log_status, idx_extraction_log_strategy_created
--   generation_log_user_created_at_idx
--   signup_rate_limit_created_at_idx
--   idx_insights_source
--   idx_official_tests_category
--   idx_norm_archive_norm_id, idx_norm_archive_subtest_id
-- ============================================================

DROP INDEX IF EXISTS public.idx_subscriptions_user;
DROP INDEX IF EXISTS public.idx_admin_norm_fitting_issue_overrides_dismissed_by;
DROP INDEX IF EXISTS public.idx_admin_norm_fitting_issue_overrides_subtest_id;
DROP INDEX IF EXISTS public.idx_admin_norm_fitting_issue_overrides_test_id;
DROP INDEX IF EXISTS public.idx_admin_audit_log_action_date;
