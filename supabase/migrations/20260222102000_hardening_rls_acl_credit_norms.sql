-- P0/P1 hardening: credit flow, ACL allowlist, norms anti-scraping, edge-facing RPC safety.

BEGIN;

-- ------------------------------------------------------------
-- 0) Pruning of clearly obsolete exposed RPCs
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.refund_credit(uuid);
DROP FUNCTION IF EXISTS public.check_core_rpc_signatures();

-- ------------------------------------------------------------
-- 1) Credit flow hardening: immutable generation_log for clients
-- ------------------------------------------------------------
ALTER TABLE public.generation_log
  ADD COLUMN IF NOT EXISTS error_code text;

UPDATE public.generation_log
SET status = CASE
  WHEN status = 'consumed' THEN 'pending'
  WHEN status = 'completed' THEN 'completed'
  WHEN status = 'failed' THEN 'failed'
  WHEN status = 'refunded' THEN 'refunded'
  WHEN refunded_at IS NOT NULL THEN 'refunded'
  ELSE 'completed'
END;

ALTER TABLE public.generation_log
  ALTER COLUMN status SET DEFAULT 'pending';

DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.generation_log'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE public.generation_log DROP CONSTRAINT %I', c.conname);
  END LOOP;
END
$$;

ALTER TABLE public.generation_log
  ADD CONSTRAINT generation_log_status_check
  CHECK (status IN ('pending', 'completed', 'failed', 'refunded'));

CREATE INDEX IF NOT EXISTS generation_log_user_created_at_idx
  ON public.generation_log (user_id, created_at DESC);

DROP POLICY IF EXISTS own_generation_logs ON public.generation_log;
DROP POLICY IF EXISTS generation_log_select_own ON public.generation_log;
CREATE POLICY generation_log_select_own
  ON public.generation_log
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- ------------------------------------------------------------
-- 2) Practitioner and membership RLS policy split
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Users can manage own profile" ON public.practitioners;
DROP POLICY IF EXISTS practitioners_select_own ON public.practitioners;
DROP POLICY IF EXISTS practitioners_update_own ON public.practitioners;

CREATE POLICY practitioners_select_own
  ON public.practitioners
  FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

CREATE POLICY practitioners_update_own
  ON public.practitioners
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS update_own_key ON public.organization_members;
DROP POLICY IF EXISTS update_own_member_key ON public.organization_members;
CREATE POLICY update_own_member_key
  ON public.organization_members
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.protect_organization_member_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role
     AND auth.uid() = OLD.user_id
     AND NOT public.check_is_admin() THEN
    RAISE EXCEPTION 'SECURITY_VIOLATION: role updates are not allowed for self-service membership updates.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_protect_organization_member_role ON public.organization_members;
CREATE TRIGGER tr_protect_organization_member_role
  BEFORE UPDATE ON public.organization_members
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_organization_member_role();

-- ------------------------------------------------------------
-- 3) Admin-only policies for override tables (RLS already enabled)
-- ------------------------------------------------------------
DROP POLICY IF EXISTS admin_only_manage_norm_issue_overrides ON public.admin_norm_issue_overrides;
CREATE POLICY admin_only_manage_norm_issue_overrides
  ON public.admin_norm_issue_overrides
  FOR ALL
  TO authenticated
  USING (public.check_is_admin())
  WITH CHECK (public.check_is_admin());

DROP POLICY IF EXISTS admin_only_manage_norm_fitting_issue_overrides ON public.admin_norm_fitting_issue_overrides;
CREATE POLICY admin_only_manage_norm_fitting_issue_overrides
  ON public.admin_norm_fitting_issue_overrides
  FOR ALL
  TO authenticated
  USING (public.check_is_admin())
  WITH CHECK (public.check_is_admin());

-- ------------------------------------------------------------
-- 4) Credit RPCs: atomic consume + server-side finalize
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.consume_credit()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_credits integer;
  v_is_admin boolean;
  v_plan_id text;
  v_status text;
  v_gen_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT p.credits, p.is_admin
  INTO v_credits, v_is_admin
  FROM public.practitioners p
  WHERE p.id = v_user_id
  FOR UPDATE;

  SELECT s.plan_id, s.status
  INTO v_plan_id, v_status
  FROM public.subscriptions s
  WHERE s.user_id = v_user_id
  LIMIT 1;

  IF COALESCE(v_is_admin, false)
     OR (v_plan_id = 'expert' AND v_status = 'active') THEN
    INSERT INTO public.generation_log (user_id, status)
    VALUES (v_user_id, 'pending')
    RETURNING id INTO v_gen_id;
    RETURN v_gen_id;
  END IF;

  IF NOT public.check_paid_access() THEN
    RETURN NULL;
  END IF;

  IF COALESCE(v_credits, 0) <= 0 THEN
    RETURN NULL;
  END IF;

  PERFORM set_config('app.internal_operation', 'true', true);
  UPDATE public.practitioners
  SET credits = credits - 1
  WHERE id = v_user_id
    AND credits > 0;
  PERFORM set_config('app.internal_operation', 'false', true);

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.generation_log (user_id, status)
  VALUES (v_user_id, 'pending')
  RETURNING id INTO v_gen_id;

  RETURN v_gen_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_generation(
  p_generation_id uuid,
  p_success boolean,
  p_error_code text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_log public.generation_log%ROWTYPE;
  v_is_admin boolean;
  v_plan_id text;
  v_status text;
BEGIN
  IF v_user_id IS NULL OR p_generation_id IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT *
  INTO v_log
  FROM public.generation_log
  WHERE id = p_generation_id
    AND user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  IF v_log.status <> 'pending' THEN
    RETURN FALSE;
  END IF;

  IF p_success THEN
    UPDATE public.generation_log
    SET status = 'completed',
        error_code = NULL
    WHERE id = p_generation_id;
    RETURN TRUE;
  END IF;

  UPDATE public.generation_log
  SET status = 'failed',
      refunded_at = now(),
      error_code = p_error_code
  WHERE id = p_generation_id;

  SELECT p.is_admin
  INTO v_is_admin
  FROM public.practitioners p
  WHERE p.id = v_user_id;

  SELECT s.plan_id, s.status
  INTO v_plan_id, v_status
  FROM public.subscriptions s
  WHERE s.user_id = v_user_id
  LIMIT 1;

  IF COALESCE(v_is_admin, false)
     OR (v_plan_id = 'expert' AND v_status = 'active') THEN
    UPDATE public.generation_log
    SET status = 'refunded'
    WHERE id = p_generation_id;
    RETURN TRUE;
  END IF;

  PERFORM set_config('app.internal_operation', 'true', true);
  UPDATE public.practitioners
  SET credits = credits + 1
  WHERE id = v_user_id;
  PERFORM set_config('app.internal_operation', 'false', true);

  UPDATE public.generation_log
  SET status = 'refunded'
  WHERE id = p_generation_id;

  RETURN TRUE;
END;
$$;

-- ------------------------------------------------------------
-- 5) Norm scraping protections
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.norm_query_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subtest_id text NOT NULL,
  age_months integer,
  raw_score real,
  source text NOT NULL DEFAULT 'compute_score',
  blocked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.norm_query_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS norm_query_log_select_own ON public.norm_query_log;
CREATE POLICY norm_query_log_select_own
  ON public.norm_query_log
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS norm_query_log_admin_read ON public.norm_query_log;
CREATE POLICY norm_query_log_admin_read
  ON public.norm_query_log
  FOR SELECT
  TO authenticated
  USING (public.check_is_admin());

CREATE INDEX IF NOT EXISTS norm_query_log_user_created_idx
  ON public.norm_query_log (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS norm_query_log_user_subtest_created_idx
  ON public.norm_query_log (user_id, subtest_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.check_norm_query_rate_limit(
  p_subtest_id text,
  p_age_months integer,
  p_raw_score real,
  p_source text DEFAULT 'compute_score',
  p_per_minute integer DEFAULT 20,
  p_per_hour integer DEFAULT 200,
  p_per_day integer DEFAULT 800,
  p_distinct_subtests_per_hour integer DEFAULT 40
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
SET row_security TO off
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_count_minute integer;
  v_count_hour integer;
  v_count_day integer;
  v_distinct_subtests_hour integer;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT COUNT(*)
  INTO v_count_minute
  FROM public.norm_query_log
  WHERE user_id = v_user_id
    AND created_at >= now() - interval '1 minute';

  SELECT COUNT(*)
  INTO v_count_hour
  FROM public.norm_query_log
  WHERE user_id = v_user_id
    AND created_at >= now() - interval '1 hour';

  SELECT COUNT(*)
  INTO v_count_day
  FROM public.norm_query_log
  WHERE user_id = v_user_id
    AND created_at >= now() - interval '1 day';

  SELECT COUNT(DISTINCT subtest_id)
  INTO v_distinct_subtests_hour
  FROM public.norm_query_log
  WHERE user_id = v_user_id
    AND created_at >= now() - interval '1 hour';

  IF v_count_minute >= p_per_minute
     OR v_count_hour >= p_per_hour
     OR v_count_day >= p_per_day
     OR v_distinct_subtests_hour >= p_distinct_subtests_per_hour THEN
    INSERT INTO public.norm_query_log (user_id, subtest_id, age_months, raw_score, source, blocked)
    VALUES (v_user_id, p_subtest_id, p_age_months, p_raw_score, p_source, true);
    RETURN FALSE;
  END IF;

  INSERT INTO public.norm_query_log (user_id, subtest_id, age_months, raw_score, source, blocked)
  VALUES (v_user_id, p_subtest_id, p_age_months, p_raw_score, p_source, false);

  RETURN TRUE;
END;
$$;

-- Wrap existing compute_score logic so anti-scraping checks run first.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'compute_score'
      AND pg_get_function_identity_arguments(p.oid) = 'p_subtest_id text, p_raw_score real, p_age_months integer, p_gender text, p_class_level text'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'compute_score_core'
      AND pg_get_function_identity_arguments(p.oid) = 'p_subtest_id text, p_raw_score real, p_age_months integer, p_gender text, p_class_level text'
  ) THEN
    ALTER FUNCTION public.compute_score(text, real, integer, text, text)
      RENAME TO compute_score_core;
  END IF;
END
$$;

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
SET search_path TO public
AS $$
BEGIN
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
$$;

CREATE OR REPLACE FUNCTION public.check_norms_availability(p_subtest_ids text[])
RETURNS TABLE(subtest_id text, has_norms boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
  WITH caller AS (
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
  FROM unnest(p_subtest_ids) AS u(id);
$$;

-- ------------------------------------------------------------
-- 6) Extraction access rules + rate-limits aligned with paid plans
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.check_extraction_rate_limit(integer);

CREATE OR REPLACE FUNCTION public.check_extraction_access()
RETURNS TABLE(
  has_access boolean,
  extraction_quota integer,
  extractions_this_month integer,
  remaining_quota integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
SET row_security TO off
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_status text;
  v_plan_id text;
  v_quota integer;
  v_count_this_month integer;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN QUERY SELECT false, 0, 0, 0;
    RETURN;
  END IF;

  SELECT s.status, s.plan_id, COALESCE(s.monthly_extraction_quota, 100)
  INTO v_status, v_plan_id, v_quota
  FROM public.subscriptions s
  WHERE s.user_id = v_user_id
  LIMIT 1;

  IF v_status IS DISTINCT FROM 'active'
     OR v_plan_id NOT IN ('essential', 'performance', 'expert') THEN
    RETURN QUERY SELECT false, 0, 0, 0;
    RETURN;
  END IF;

  SELECT COUNT(*)
  INTO v_count_this_month
  FROM public.extraction_log e
  WHERE e.user_id = v_user_id
    AND e.created_at >= date_trunc('month', now())
    AND e.status = 'completed';

  RETURN QUERY SELECT
    true,
    v_quota,
    v_count_this_month,
    GREATEST(v_quota - v_count_this_month, 0);
END;
$$;

CREATE OR REPLACE FUNCTION public.check_extraction_rate_limit(
  p_max_per_hour integer DEFAULT 20,
  p_max_per_day integer DEFAULT 60
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
SET row_security TO off
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_count_hour integer;
  v_count_day integer;
  v_access record;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_access
  FROM public.check_extraction_access()
  LIMIT 1;

  IF v_access IS NULL
     OR v_access.has_access IS DISTINCT FROM true
     OR COALESCE(v_access.remaining_quota, 0) <= 0 THEN
    RETURN false;
  END IF;

  SELECT COUNT(*)
  INTO v_count_hour
  FROM public.extraction_log
  WHERE user_id = v_user_id
    AND created_at >= now() - interval '1 hour';

  IF v_count_hour >= p_max_per_hour THEN
    RETURN false;
  END IF;

  SELECT COUNT(*)
  INTO v_count_day
  FROM public.extraction_log
  WHERE user_id = v_user_id
    AND created_at >= now() - interval '1 day';

  IF v_count_day >= p_max_per_day THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$$;

-- ------------------------------------------------------------
-- 7) Views hardened as invoker-only and auth-only grants
-- ------------------------------------------------------------
ALTER VIEW public.view_unified_catalog SET (security_invoker = true);
ALTER VIEW public.view_unified_subtests SET (security_invoker = true);

-- ------------------------------------------------------------
-- 8) Normalize SECURITY DEFINER search_path when missing
-- ------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT n.nspname AS schema_name,
           p.proname,
           pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND p.proconfig IS NULL
  LOOP
    EXECUTE format(
      'ALTER FUNCTION %I.%I(%s) SET search_path TO public',
      r.schema_name,
      r.proname,
      r.args
    );
  END LOOP;
END
$$;

-- ------------------------------------------------------------
-- 9) Global ACL reset + explicit allowlist grants
-- ------------------------------------------------------------
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;

DO $$
BEGIN
  BEGIN
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Could not alter default privileges for role postgres: %', SQLERRM;
  END;
END
$$;

-- Table/view allowlist
GRANT SELECT, UPDATE ON TABLE public.practitioners TO authenticated;
GRANT SELECT ON TABLE public.subscriptions TO authenticated;
GRANT SELECT ON TABLE public.organization_members TO authenticated;
GRANT UPDATE (encrypted_org_key) ON TABLE public.organization_members TO authenticated;
GRANT SELECT ON TABLE public.generation_log TO authenticated;
GRANT SELECT, INSERT ON TABLE public.extraction_log TO authenticated;
GRANT SELECT ON TABLE public.view_unified_catalog TO authenticated;
GRANT SELECT ON TABLE public.view_unified_subtests TO authenticated;
GRANT SELECT ON TABLE public.official_categories TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.patients TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.drafts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.patient_assessments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.patient_followups TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.pending_questionnaires TO authenticated;
GRANT SELECT, INSERT ON TABLE public.contribution_insights TO authenticated;
GRANT SELECT ON TABLE public.norm_query_log TO authenticated;

-- Keep tokenized family portal path only
GRANT SELECT, UPDATE ON TABLE public.pending_questionnaires TO anon;

-- Sequence usage for authenticated inserts on serial-backed tables
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- RPC/function allowlist for authenticated user flows
GRANT EXECUTE ON FUNCTION public.bootstrap_practitioner_for_user(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bootstrap_org_for_user(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.consume_credit() TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_generation(uuid, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.compute_score(text, real, integer, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_norms_availability(text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_norms_applicability(text[], integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_extraction_access() TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_extraction_rate_limit(integer, integer) TO authenticated;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS fn_signature
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND (
        p.proname LIKE 'admin_%'
        OR p.proname IN (
          'attach_subtests_to_test',
          'find_private_test_by_name',
          'find_similar_tests',
          'create_private_test',
          'merge_private_test'
        )
      )
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.fn_signature);
  END LOOP;
END
$$;

-- Service-role-only maintenance/auth helpers
GRANT EXECUTE ON FUNCTION public.check_signup_rate_limit(text, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.purge_signup_rate_limit_log(integer) TO service_role;

COMMIT;
