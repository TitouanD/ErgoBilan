-- =============================================================================
-- Migration: Fix admin bundle RPC grants for frontend usage with admin-only guard
-- Date: 2026-03-19
-- =============================================================================

-- Ensure no broad/public access.
REVOKE ALL ON FUNCTION public.admin_get_test_bundle(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_save_test_bundle(jsonb) FROM PUBLIC;
-- Ensure frontend authenticated users can call the RPC,
-- while admin-only access is still enforced inside the function body via check_is_admin().
GRANT EXECUTE ON FUNCTION public.admin_get_test_bundle(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_save_test_bundle(jsonb) TO authenticated;
-- Keep service_role and postgres access (backend/maintenance).
GRANT EXECUTE ON FUNCTION public.admin_get_test_bundle(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_save_test_bundle(jsonb) TO service_role;
