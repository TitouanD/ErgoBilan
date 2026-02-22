BEGIN;

-- ============================================================
-- 1) RLS initplan optimization: avoid per-row auth/current_setting re-eval
-- ============================================================

ALTER POLICY generation_log_select_own
  ON public.generation_log
  USING (user_id = (select auth.uid()));

ALTER POLICY practitioners_select_own
  ON public.practitioners
  USING ((select auth.uid()) = id);

ALTER POLICY practitioners_update_own
  ON public.practitioners
  USING ((select auth.uid()) = id)
  WITH CHECK ((select auth.uid()) = id);

ALTER POLICY view_own_membership
  ON public.organization_members
  USING (user_id = (select auth.uid()));

ALTER POLICY update_own_member_key
  ON public.organization_members
  USING (user_id = (select auth.uid()))
  WITH CHECK (user_id = (select auth.uid()));

ALTER POLICY leave_non_owner_membership
  ON public.organization_members
  USING (user_id = (select auth.uid()) AND role <> 'owner');

ALTER POLICY "Users can read own subscription"
  ON public.subscriptions
  USING ((select auth.uid()) = user_id);

ALTER POLICY "Drafts are private"
  ON public.drafts
  USING (user_id = (select auth.uid()))
  WITH CHECK (user_id = (select auth.uid()));

ALTER POLICY "Users can view their own extraction logs"
  ON public.extraction_log
  USING ((select auth.uid()) = user_id);

ALTER POLICY "Users can insert their own extraction logs"
  ON public.extraction_log
  WITH CHECK ((select auth.uid()) = user_id);

ALTER POLICY "Access patients via organization"
  ON public.patients
  USING (
    organization_id IN (
      SELECT om.organization_id
      FROM public.organization_members om
      WHERE om.user_id = (select auth.uid())
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT om.organization_id
      FROM public.organization_members om
      WHERE om.user_id = (select auth.uid())
    )
  );

ALTER POLICY "Access assessments via organization"
  ON public.patient_assessments
  USING (
    organization_id IN (
      SELECT om.organization_id
      FROM public.organization_members om
      WHERE om.user_id = (select auth.uid())
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT om.organization_id
      FROM public.organization_members om
      WHERE om.user_id = (select auth.uid())
    )
  );

ALTER POLICY "Access followups via organization"
  ON public.patient_followups
  USING (
    organization_id IN (
      SELECT om.organization_id
      FROM public.organization_members om
      WHERE om.user_id = (select auth.uid())
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT om.organization_id
      FROM public.organization_members om
      WHERE om.user_id = (select auth.uid())
    )
  );

ALTER POLICY "Admins can insert audit logs"
  ON public.admin_audit_log
  WITH CHECK (admin_user_id = (select auth.uid()) AND check_is_admin());

ALTER POLICY practitioner_insert_pending
  ON public.pending_questionnaires
  WITH CHECK (
    practitioner_id = (select auth.uid())
    AND organization_id IN (
      SELECT om.organization_id
      FROM public.organization_members om
      WHERE om.user_id = (select auth.uid())
    )
  );

ALTER POLICY family_read_by_token
  ON public.pending_questionnaires
  USING (
    access_token = (
      ((select current_setting('request.headers'::text, true))::json ->> 'x-questionnaire-token')
    )
  );

ALTER POLICY family_update_by_token
  ON public.pending_questionnaires
  USING (
    status = 'pending'
    AND access_token = (
      ((select current_setting('request.headers'::text, true))::json ->> 'x-questionnaire-token')
    )
  )
  WITH CHECK (family_encrypted_data IS NOT NULL);

-- ============================================================
-- 2) Remove multiple permissive policy overlaps (same role/action)
-- ============================================================

-- organizations: remove redundant SELECT policy, keep/access all with explicit checks
DROP POLICY IF EXISTS view_own_organizations ON public.organizations;

ALTER POLICY access_own_orgs
  ON public.organizations
  USING (
    id IN (
      SELECT om.organization_id
      FROM public.organization_members om
      WHERE om.user_id = (select auth.uid())
    )
  )
  WITH CHECK (
    id IN (
      SELECT om.organization_id
      FROM public.organization_members om
      WHERE om.user_id = (select auth.uid())
    )
  );

-- norm_query_log: merge own/admin SELECT policies into one
DROP POLICY IF EXISTS norm_query_log_admin_read ON public.norm_query_log;
DROP POLICY IF EXISTS norm_query_log_select_own ON public.norm_query_log;

CREATE POLICY norm_query_log_select_access
ON public.norm_query_log
FOR SELECT
TO authenticated
USING (
  check_is_admin()
  OR user_id = (select auth.uid())
);

-- pending_questionnaires: split broad ALL policy to avoid INSERT overlap and keep behavior clear
DROP POLICY IF EXISTS practitioner_manage_pending ON public.pending_questionnaires;

CREATE POLICY practitioner_select_pending
ON public.pending_questionnaires
FOR SELECT
TO authenticated
USING (
  organization_id IN (
    SELECT om.organization_id
    FROM public.organization_members om
    WHERE om.user_id = (select auth.uid())
  )
);

CREATE POLICY practitioner_update_pending
ON public.pending_questionnaires
FOR UPDATE
TO authenticated
USING (
  organization_id IN (
    SELECT om.organization_id
    FROM public.organization_members om
    WHERE om.user_id = (select auth.uid())
  )
)
WITH CHECK (
  organization_id IN (
    SELECT om.organization_id
    FROM public.organization_members om
    WHERE om.user_id = (select auth.uid())
  )
);

CREATE POLICY practitioner_delete_pending
ON public.pending_questionnaires
FOR DELETE
TO authenticated
USING (
  organization_id IN (
    SELECT om.organization_id
    FROM public.organization_members om
    WHERE om.user_id = (select auth.uid())
  )
);

-- official_tests: replace overlapping legacy policies with one policy per action
DROP POLICY IF EXISTS "Admin Delete Only" ON public.official_tests;
DROP POLICY IF EXISTS "Admin Update Only" ON public.official_tests;
DROP POLICY IF EXISTS "Admins can view all tests" ON public.official_tests;
DROP POLICY IF EXISTS "Insert Private Only" ON public.official_tests;
DROP POLICY IF EXISTS "Unified View: Public + My Private" ON public.official_tests;
DROP POLICY IF EXISTS manage_own_tests ON public.official_tests;
DROP POLICY IF EXISTS view_mixed_tests ON public.official_tests;

CREATE POLICY official_tests_select_access
ON public.official_tests
FOR SELECT
TO authenticated
USING (
  check_is_admin()
  OR organization_id IS NULL
  OR organization_id IN (
    SELECT om.organization_id
    FROM public.organization_members om
    WHERE om.user_id = (select auth.uid())
  )
);

CREATE POLICY official_tests_insert_private
ON public.official_tests
FOR INSERT
TO authenticated
WITH CHECK (
  organization_id IS NOT NULL
  AND organization_id IN (
    SELECT om.organization_id
    FROM public.organization_members om
    WHERE om.user_id = (select auth.uid())
  )
);

CREATE POLICY official_tests_update_access
ON public.official_tests
FOR UPDATE
TO authenticated
USING (
  check_is_admin()
  OR organization_id IN (
    SELECT om.organization_id
    FROM public.organization_members om
    WHERE om.user_id = (select auth.uid())
  )
)
WITH CHECK (
  check_is_admin()
  OR organization_id IN (
    SELECT om.organization_id
    FROM public.organization_members om
    WHERE om.user_id = (select auth.uid())
  )
);

CREATE POLICY official_tests_delete_access
ON public.official_tests
FOR DELETE
TO authenticated
USING (
  check_is_admin()
  OR organization_id IN (
    SELECT om.organization_id
    FROM public.organization_members om
    WHERE om.user_id = (select auth.uid())
  )
);

-- official_norms: replace overlapping legacy policies with one policy per action
DROP POLICY IF EXISTS "Admin Delete Norms" ON public.official_norms;
DROP POLICY IF EXISTS "Admin Update Norms" ON public.official_norms;
DROP POLICY IF EXISTS "Insert Private Norms" ON public.official_norms;
DROP POLICY IF EXISTS admin_read_all_norms ON public.official_norms;
DROP POLICY IF EXISTS manage_own_norms ON public.official_norms;
DROP POLICY IF EXISTS view_own_org_norms ON public.official_norms;

CREATE POLICY official_norms_select_access
ON public.official_norms
FOR SELECT
TO authenticated
USING (
  check_is_admin()
  OR (
    organization_id IS NOT NULL
    AND organization_id IN (
      SELECT om.organization_id
      FROM public.organization_members om
      WHERE om.user_id = (select auth.uid())
    )
  )
);

CREATE POLICY official_norms_insert_private
ON public.official_norms
FOR INSERT
TO authenticated
WITH CHECK (
  organization_id IS NOT NULL
  AND organization_id IN (
    SELECT om.organization_id
    FROM public.organization_members om
    WHERE om.user_id = (select auth.uid())
  )
);

CREATE POLICY official_norms_update_access
ON public.official_norms
FOR UPDATE
TO authenticated
USING (
  check_is_admin()
  OR organization_id IN (
    SELECT om.organization_id
    FROM public.organization_members om
    WHERE om.user_id = (select auth.uid())
  )
)
WITH CHECK (
  check_is_admin()
  OR organization_id IN (
    SELECT om.organization_id
    FROM public.organization_members om
    WHERE om.user_id = (select auth.uid())
  )
);

CREATE POLICY official_norms_delete_access
ON public.official_norms
FOR DELETE
TO authenticated
USING (
  check_is_admin()
  OR organization_id IN (
    SELECT om.organization_id
    FROM public.organization_members om
    WHERE om.user_id = (select auth.uid())
  )
);

-- ============================================================
-- 3) Duplicate indexes and missing FK indexes
-- ============================================================

DROP INDEX IF EXISTS public.idx_official_norms_org;
DROP INDEX IF EXISTS public.idx_official_tests_org;

CREATE INDEX IF NOT EXISTS idx_admin_norm_fitting_issue_overrides_dismissed_by
  ON public.admin_norm_fitting_issue_overrides (dismissed_by);

CREATE INDEX IF NOT EXISTS idx_admin_norm_fitting_issue_overrides_subtest_id
  ON public.admin_norm_fitting_issue_overrides (subtest_id);

CREATE INDEX IF NOT EXISTS idx_admin_norm_fitting_issue_overrides_test_id
  ON public.admin_norm_fitting_issue_overrides (test_id);

CREATE INDEX IF NOT EXISTS idx_admin_norm_issue_overrides_dismissed_by
  ON public.admin_norm_issue_overrides (dismissed_by);

CREATE INDEX IF NOT EXISTS idx_official_norms_subtest_id
  ON public.official_norms (subtest_id);

CREATE INDEX IF NOT EXISTS idx_patient_assessments_user_id
  ON public.patient_assessments (user_id);

COMMIT;