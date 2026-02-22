BEGIN;

-- Remove legacy objects no longer referenced by app or RPC flows.
DROP VIEW IF EXISTS public.admin_candidates_promotion;
DROP FUNCTION IF EXISTS public.check_paid_access();

-- Normalize contribution_insights policies to a minimal, explicit set.
DROP POLICY IF EXISTS contribution_insights_admin_select ON public.contribution_insights;
DROP POLICY IF EXISTS contribution_insights_insert_authenticated ON public.contribution_insights;
DROP POLICY IF EXISTS "Admin Read Insights" ON public.contribution_insights;
DROP POLICY IF EXISTS "Admins analyze insights" ON public.contribution_insights;
DROP POLICY IF EXISTS "Deposit anonymous insights" ON public.contribution_insights;
DROP POLICY IF EXISTS "Log Insights" ON public.contribution_insights;

CREATE POLICY contribution_insights_admin_select
ON public.contribution_insights
FOR SELECT
TO authenticated
USING (public.check_is_admin());

CREATE POLICY contribution_insights_insert_authenticated
ON public.contribution_insights
FOR INSERT
TO authenticated
WITH CHECK (
  age_months > 0
  AND test_id IS NOT NULL
  AND subtest_id IS NOT NULL
);

COMMIT;
