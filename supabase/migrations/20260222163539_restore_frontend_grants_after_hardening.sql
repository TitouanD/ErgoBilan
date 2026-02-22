-- Restore minimal frontend grants after hardening migration:
-- keep service-only RPCs locked, while re-enabling authenticated/anon flows that rely on RLS.

-- 1) Authenticated table/view access required by frontend data paths.
GRANT SELECT, UPDATE ON TABLE public.practitioners TO authenticated;
GRANT SELECT ON TABLE public.subscriptions TO authenticated;

GRANT SELECT, UPDATE ON TABLE public.organization_members TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.pending_questionnaires TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.patients TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.drafts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.patient_assessments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.patient_followups TO authenticated;

GRANT SELECT, INSERT ON TABLE public.contribution_insights TO authenticated;
GRANT SELECT ON TABLE public.official_categories TO authenticated;
GRANT SELECT ON TABLE public.view_unified_catalog TO authenticated;
GRANT SELECT ON TABLE public.view_unified_subtests TO authenticated;

-- 2) Anonymous portal access (token-constrained by RLS policies).
GRANT SELECT, UPDATE ON TABLE public.pending_questionnaires TO anon;

-- 3) Re-grant frontend RPC execute rights for authenticated callers only.
-- Security remains enforced by function bodies and RLS checks (auth.uid()/check_is_admin/etc).
DO $$
DECLARE
  fn record;
BEGIN
  FOR fn IN
    SELECT
      n.nspname AS schema_name,
      p.proname AS function_name,
      pg_get_function_identity_arguments(p.oid) AS identity_args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND (
        p.proname IN (
          'bootstrap_practitioner_for_user',
          'bootstrap_org_for_user',
          'compute_score',
          'check_norms_availability',
          'check_norms_applicability',
          'check_is_admin',
          'check_is_member_of',
          'find_private_test_by_name',
          'find_similar_tests',
          'create_private_test',
          'merge_private_test',
          'attach_subtests_to_test'
        )
        OR p.proname LIKE 'admin\_%' ESCAPE '\'
      )
  LOOP
    EXECUTE format(
      'GRANT EXECUTE ON FUNCTION %I.%I(%s) TO authenticated',
      fn.schema_name,
      fn.function_name,
      fn.identity_args
    );
  END LOOP;
END;
$$;

-- 4) Explicitly keep sensitive internals service-only.
REVOKE ALL ON FUNCTION public.consume_credit() FROM authenticated;
REVOKE ALL ON FUNCTION public.check_rate_limit(integer) FROM authenticated;
REVOKE ALL ON FUNCTION public.check_extraction_access() FROM authenticated;
REVOKE ALL ON FUNCTION public.check_extraction_rate_limit(integer, integer) FROM authenticated;
REVOKE ALL ON FUNCTION public.check_norm_query_rate_limit(text, integer, real, text, integer, integer, integer, integer) FROM authenticated;
REVOKE ALL ON FUNCTION public.finalize_generation_internal(uuid, uuid, boolean, text) FROM authenticated;
REVOKE ALL ON FUNCTION public.claim_generation_session(uuid, uuid, integer) FROM authenticated;
