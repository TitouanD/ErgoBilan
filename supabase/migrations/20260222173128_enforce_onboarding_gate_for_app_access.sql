-- Enforce onboarding completion (practitioner row + PIN configured)
-- before granting any authenticated app access.

-- 1) Safe helper callable by authenticated users (no parameters -> no enumeration).
CREATE OR REPLACE FUNCTION public.is_current_user_onboarded()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
SET row_security TO 'off'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.practitioners p
    WHERE p.id = auth.uid()
      AND p.encryption_salt IS NOT NULL
      AND p.encryption_validator IS NOT NULL
      AND p.encryption_salt <> 'pending'
      AND p.encryption_validator <> 'pending'
  );
$function$;

REVOKE ALL ON FUNCTION public.is_current_user_onboarded() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_current_user_onboarded() TO authenticated, service_role;

-- 2) Membership/admin helpers must require completed onboarding.
CREATE OR REPLACE FUNCTION public.check_is_admin()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_current_user_onboarded() THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.practitioners
    WHERE id = auth.uid()
      AND is_admin = true
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.check_is_member_of(org_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF org_id IS NULL OR auth.uid() IS NULL OR NOT public.is_current_user_onboarded() THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.organization_members
    WHERE user_id = auth.uid()
      AND organization_id = org_id
  );
END;
$function$;

-- 3) Restrictive gate across authenticated app tables.
DROP POLICY IF EXISTS authenticated_requires_onboarded_profile ON public.organizations;
CREATE POLICY authenticated_requires_onboarded_profile
ON public.organizations
AS RESTRICTIVE
FOR ALL
TO authenticated
USING (public.is_current_user_onboarded())
WITH CHECK (public.is_current_user_onboarded());

DROP POLICY IF EXISTS authenticated_requires_onboarded_profile ON public.organization_members;
CREATE POLICY authenticated_requires_onboarded_profile
ON public.organization_members
AS RESTRICTIVE
FOR ALL
TO authenticated
USING (public.is_current_user_onboarded())
WITH CHECK (public.is_current_user_onboarded());

DROP POLICY IF EXISTS authenticated_requires_onboarded_profile ON public.subscriptions;
CREATE POLICY authenticated_requires_onboarded_profile
ON public.subscriptions
AS RESTRICTIVE
FOR SELECT
TO authenticated
USING (public.is_current_user_onboarded());

DROP POLICY IF EXISTS authenticated_requires_onboarded_profile ON public.drafts;
CREATE POLICY authenticated_requires_onboarded_profile
ON public.drafts
AS RESTRICTIVE
FOR ALL
TO authenticated
USING (public.is_current_user_onboarded())
WITH CHECK (public.is_current_user_onboarded());

DROP POLICY IF EXISTS authenticated_requires_onboarded_profile ON public.patients;
CREATE POLICY authenticated_requires_onboarded_profile
ON public.patients
AS RESTRICTIVE
FOR ALL
TO authenticated
USING (public.is_current_user_onboarded())
WITH CHECK (public.is_current_user_onboarded());

DROP POLICY IF EXISTS authenticated_requires_onboarded_profile ON public.patient_assessments;
CREATE POLICY authenticated_requires_onboarded_profile
ON public.patient_assessments
AS RESTRICTIVE
FOR ALL
TO authenticated
USING (public.is_current_user_onboarded())
WITH CHECK (public.is_current_user_onboarded());

DROP POLICY IF EXISTS authenticated_requires_onboarded_profile ON public.patient_followups;
CREATE POLICY authenticated_requires_onboarded_profile
ON public.patient_followups
AS RESTRICTIVE
FOR ALL
TO authenticated
USING (public.is_current_user_onboarded())
WITH CHECK (public.is_current_user_onboarded());

DROP POLICY IF EXISTS authenticated_requires_onboarded_profile ON public.pending_questionnaires;
CREATE POLICY authenticated_requires_onboarded_profile
ON public.pending_questionnaires
AS RESTRICTIVE
FOR ALL
TO authenticated
USING (public.is_current_user_onboarded())
WITH CHECK (public.is_current_user_onboarded());

DROP POLICY IF EXISTS authenticated_requires_onboarded_profile ON public.contribution_insights;
CREATE POLICY authenticated_requires_onboarded_profile
ON public.contribution_insights
AS RESTRICTIVE
FOR ALL
TO authenticated
USING (public.is_current_user_onboarded())
WITH CHECK (public.is_current_user_onboarded());

DROP POLICY IF EXISTS authenticated_requires_onboarded_profile ON public.extraction_log;
CREATE POLICY authenticated_requires_onboarded_profile
ON public.extraction_log
AS RESTRICTIVE
FOR ALL
TO authenticated
USING (public.is_current_user_onboarded())
WITH CHECK (public.is_current_user_onboarded());

DROP POLICY IF EXISTS authenticated_requires_onboarded_profile ON public.generation_log;
CREATE POLICY authenticated_requires_onboarded_profile
ON public.generation_log
AS RESTRICTIVE
FOR ALL
TO authenticated
USING (public.is_current_user_onboarded())
WITH CHECK (public.is_current_user_onboarded());

DROP POLICY IF EXISTS authenticated_requires_onboarded_profile ON public.norm_query_log;
CREATE POLICY authenticated_requires_onboarded_profile
ON public.norm_query_log
AS RESTRICTIVE
FOR ALL
TO authenticated
USING (public.is_current_user_onboarded())
WITH CHECK (public.is_current_user_onboarded());

-- Norm catalog must not be readable by authenticated users without completed onboarding.
DROP POLICY IF EXISTS read_categories ON public.official_categories;
CREATE POLICY read_categories
ON public.official_categories
FOR SELECT
TO authenticated
USING (public.is_current_user_onboarded());

-- 4) Views used by frontend catalog: gate by onboarding + keep invoker security.
CREATE OR REPLACE VIEW public.view_unified_catalog
WITH (security_invoker = true)
AS
SELECT
  t.id,
  t.name AS label,
  t.category_id,
  c.label AS category_label,
  c.icon_key,
  c.sort_order,
  (
    SELECT count(*)
    FROM public.official_subtests s
    WHERE (public.is_current_user_onboarded())
      AND s.test_id = t.id
      AND (s.organization_id IS NULL OR public.check_is_member_of(s.organization_id))
  ) AS subtests_count
FROM public.official_tests t
JOIN public.official_categories c ON c.id = t.category_id
WHERE public.is_current_user_onboarded()
  AND (t.organization_id IS NULL OR public.check_is_member_of(t.organization_id));

CREATE OR REPLACE VIEW public.view_unified_subtests
WITH (security_invoker = true)
AS
SELECT
  s.id,
  s.test_id,
  s.name,
  s.unit,
  s.score_type,
  s.computation_mode,
  s.input_model,
  s.input_config,
  s.abbreviation
FROM public.official_subtests s
JOIN public.official_tests t ON t.id = s.test_id
WHERE public.is_current_user_onboarded()
  AND (t.organization_id IS NULL OR public.check_is_member_of(t.organization_id))
  AND (s.organization_id IS NULL OR public.check_is_member_of(s.organization_id));

-- 5) Norms RPCs: no onboarding => no data.
CREATE OR REPLACE FUNCTION public.check_norms_availability(p_subtest_ids text[])
RETURNS TABLE(subtest_id text, has_norms boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH guard AS (
    SELECT public.is_current_user_onboarded() AS ok
  ),
  caller AS (
    SELECT om.organization_id AS caller_org_id
    FROM public.organization_members om
    WHERE om.user_id = auth.uid()
    LIMIT 1
  )
  SELECT
    u.id AS subtest_id,
    EXISTS (
      SELECT 1
      FROM public.official_norms n
      WHERE n.subtest_id = u.id
        AND (
          n.organization_id IS NULL
          OR n.organization_id = (SELECT caller_org_id FROM caller)
        )
      LIMIT 1
    ) AS has_norms
  FROM unnest(p_subtest_ids) AS u(id)
  WHERE (SELECT ok FROM guard);
$function$;

CREATE OR REPLACE FUNCTION public.check_norms_applicability(
  p_subtest_ids text[],
  p_age_months integer,
  p_gender text DEFAULT 'Mixed'::text
)
RETURNS TABLE(subtest_id text, has_norms boolean, has_applicable_norms boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH guard AS (
    SELECT public.is_current_user_onboarded() AS ok
  ),
  caller AS (
    SELECT om.organization_id AS caller_org_id
    FROM public.organization_members om
    WHERE om.user_id = auth.uid()
    LIMIT 1
  )
  SELECT
    u.id AS subtest_id,
    EXISTS (
      SELECT 1
      FROM public.official_norms n
      WHERE n.subtest_id = u.id
        AND (
          n.organization_id IS NULL
          OR n.organization_id = (SELECT caller_org_id FROM caller)
        )
      LIMIT 1
    ) AS has_norms,
    EXISTS (
      SELECT 1
      FROM public.official_norms n
      WHERE n.subtest_id = u.id
        AND (
          n.organization_id IS NULL
          OR n.organization_id = (SELECT caller_org_id FROM caller)
        )
        AND n.age_min_months <= p_age_months
        AND n.age_max_months >= p_age_months
        AND (n.gender = p_gender OR n.gender = 'Mixed')
      LIMIT 1
    ) AS has_applicable_norms
  FROM unnest(p_subtest_ids) AS u(id)
  WHERE (SELECT ok FROM guard);
$function$;

CREATE OR REPLACE FUNCTION public.compute_score(
  p_subtest_id text,
  p_raw_score real,
  p_age_months integer,
  p_gender text DEFAULT 'Mixed'::text,
  p_class_level text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_current_user_onboarded() THEN
    RETURN jsonb_build_object(
      'raw', p_raw_score,
      'standard', NULL,
      'percentile', NULL,
      'zScore', NULL,
      'norm_found', false,
      'method', 'NONE',
      'warnings', ARRAY['onboarding_required']
    );
  END IF;

  IF NOT public.check_norm_query_rate_limit(
    p_subtest_id,
    p_age_months,
    p_raw_score,
    'compute_score'
  ) THEN
    RETURN jsonb_build_object(
      'raw', p_raw_score,
      'standard', NULL,
      'percentile', NULL,
      'zScore', NULL,
      'norm_found', false,
      'method', 'NONE',
      'warnings', ARRAY['rate_limited']
    );
  END IF;

  RETURN public.compute_score_core(
    p_subtest_id,
    p_raw_score,
    p_age_months,
    p_gender,
    p_class_level
  );
END;
$function$;
