BEGIN;

ALTER VIEW public.view_unified_catalog SET (security_invoker = true);
ALTER VIEW public.view_unified_subtests SET (security_invoker = true);

COMMIT;;
