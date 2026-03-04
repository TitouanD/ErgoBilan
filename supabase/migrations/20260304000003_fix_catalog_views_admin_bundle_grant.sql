-- ============================================================
-- Migration: Fix catalog views + enforce norm blackbox (2026-03-04)
--
-- Problems fixed:
--   1. Migration 20260304000001 set view_unified_catalog and
--      view_unified_subtests to security_invoker=ON. This broke
--      access for authenticated users because they have no direct
--      SELECT on official_subtests / official_tests. The view's
--      WHERE clause (is_current_user_onboarded, check_is_member_of)
--      already enforces per-user gating — security_invoker=OFF is
--      correct here.
--
--   2. admin_get_test_bundle was never granted EXECUTE to
--      authenticated. The function guards itself via check_is_admin()
--      (raises 42501 internally), so granting to all authenticated
--      is safe.
--
--   3. Direct SELECT on official_norms, official_subtests,
--      official_tests must be impossible for authenticated / anon.
--      Norms are exclusively accessible via compute_score()
--      (SECURITY DEFINER). Subtest/test metadata is exclusively
--      accessible via view_unified_catalog / view_unified_subtests
--      (owner-permission views). This prevents copyright scraping
--      of norm tables by norm editors or external audits.
-- ============================================================


-- ============================================================
-- STEP 1: Revert security_invoker=ON on the two user-facing views
--
-- These views run as their owner (postgres/service role), which
-- has the necessary table access. The WHERE clause with
-- is_current_user_onboarded() + check_is_member_of() enforces
-- per-user gating. Setting security_invoker=ON forces the view
-- to run as the calling user, who intentionally has NO direct
-- grants on the underlying tables → every query returns 42501.
-- ============================================================

ALTER VIEW public.view_unified_catalog    SET (security_invoker = off);
ALTER VIEW public.view_unified_subtests   SET (security_invoker = off);

-- view_official_norm_certainty is only called from within
-- SECURITY DEFINER admin RPCs — keep it at security_invoker=ON
-- (already set by 20260304000001, do not revert).


-- ============================================================
-- STEP 2: Harden underlying tables — REVOKE direct access
--
-- authenticated and anon must NEVER be able to SELECT from:
--   • official_norms     – copyright-protected norm tables
--   • official_subtests  – goes through view_unified_subtests
--   • official_tests     – goes through view_unified_catalog
--
-- All legitimate access paths:
--   • Catalog metadata  → view_unified_catalog (security_invoker=off)
--   • Subtest metadata  → view_unified_subtests (security_invoker=off)
--   • Norm computation  → compute_score() SECURITY DEFINER RPC
--   • Admin operations  → admin_* SECURITY DEFINER RPCs
-- ============================================================

REVOKE SELECT ON TABLE public.official_norms     FROM authenticated;
REVOKE SELECT ON TABLE public.official_norms     FROM anon;
REVOKE SELECT ON TABLE public.official_subtests  FROM authenticated;
REVOKE SELECT ON TABLE public.official_subtests  FROM anon;
REVOKE SELECT ON TABLE public.official_tests     FROM authenticated;
REVOKE SELECT ON TABLE public.official_tests     FROM anon;

-- official_categories: retains authenticated SELECT (icon keys,
-- display labels only — no norm data). Already in ACL contract.


-- ============================================================
-- STEP 3: Grant EXECUTE on admin_get_test_bundle to authenticated
--
-- The function body enforces: IF NOT check_is_admin() THEN
-- RAISE EXCEPTION USING ERRCODE='42501'. Non-admin callers get
-- a permission error at the application layer, not at the grant
-- layer. This matches the pattern of all other admin_* RPCs.
-- ============================================================

GRANT EXECUTE ON FUNCTION public.admin_get_test_bundle(text) TO authenticated;

-- Re-grant view_unified_subtests SELECT to authenticated.
-- This grant can be lost when the view is recreated by earlier migrations
-- that call CREATE OR REPLACE VIEW without re-issuing the GRANT.
GRANT SELECT ON TABLE public.view_unified_subtests TO authenticated;
