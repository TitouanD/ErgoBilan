-- Restore unified catalog views to SECURITY DEFINER behavior.
-- Reason: Catalog clients query views only and do not have direct table privileges.

BEGIN;

ALTER VIEW public.view_unified_catalog SET (security_invoker = false);
ALTER VIEW public.view_unified_subtests SET (security_invoker = false);

COMMIT;
