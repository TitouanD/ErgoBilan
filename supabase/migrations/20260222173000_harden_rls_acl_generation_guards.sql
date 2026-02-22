-- Security hardening: ACL drift prevention, generation session locking,
-- stronger anti-abuse guards on LLM/norm extraction paths.

-- 1) Practitioner/subscription invariants.

UPDATE public.practitioners
SET credits = 3
WHERE credits IS NULL;

UPDATE public.practitioners
SET is_admin = false
WHERE is_admin IS NULL;

ALTER TABLE public.practitioners
  ALTER COLUMN credits SET DEFAULT 3,
  ALTER COLUMN credits SET NOT NULL,
  ALTER COLUMN is_admin SET DEFAULT false,
  ALTER COLUMN is_admin SET NOT NULL;

ALTER TABLE public.practitioners
  DROP CONSTRAINT IF EXISTS practitioners_credits_non_negative;

ALTER TABLE public.practitioners
  ADD CONSTRAINT practitioners_credits_non_negative
  CHECK (credits >= 0);

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY user_id
      ORDER BY created_at DESC NULLS LAST, id DESC
    ) AS rn
  FROM public.subscriptions
)
DELETE FROM public.subscriptions s
USING ranked r
WHERE s.id = r.id
  AND r.rn > 1;

UPDATE public.subscriptions
SET plan_id = 'free'
WHERE plan_id IS NULL;

UPDATE public.subscriptions
SET status = 'inactive'
WHERE status IS NULL;

UPDATE public.subscriptions
SET monthly_extraction_quota = 100
WHERE monthly_extraction_quota IS NULL;

ALTER TABLE public.subscriptions
  ALTER COLUMN plan_id SET DEFAULT 'free',
  ALTER COLUMN plan_id SET NOT NULL,
  ALTER COLUMN status SET DEFAULT 'trialing',
  ALTER COLUMN status SET NOT NULL,
  ALTER COLUMN monthly_extraction_quota SET DEFAULT 100,
  ALTER COLUMN monthly_extraction_quota SET NOT NULL;

ALTER TABLE public.subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_plan_id_allowed;

ALTER TABLE public.subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_status_allowed;

ALTER TABLE public.subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_monthly_extraction_quota_non_negative;

ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_plan_id_allowed
  CHECK (plan_id = ANY (ARRAY['free'::text, 'essential'::text, 'performance'::text, 'expert'::text]));

ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_status_allowed
  CHECK (status = ANY (ARRAY['active'::text, 'trialing'::text, 'canceled'::text, 'past_due'::text, 'inactive'::text]));

ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_monthly_extraction_quota_non_negative
  CHECK (monthly_extraction_quota >= 0 AND monthly_extraction_quota <= 100000);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.subscriptions'::regclass
      AND conname = 'subscriptions_user_id_unique'
  ) THEN
    ALTER TABLE public.subscriptions
      ADD CONSTRAINT subscriptions_user_id_unique UNIQUE (user_id);
  END IF;
END;
$$;

-- 2) Existing object ACL cleanup + default ACL hardening.

DO $$
BEGIN
  BEGIN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'Insufficient privilege while revoking table ACLs from anon/authenticated.';
  END;

  BEGIN
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'Insufficient privilege while revoking sequence ACLs from anon/authenticated.';
  END;
END;
$$;

DO $$
DECLARE
  role_name text;
BEGIN
  FOR role_name IN SELECT unnest(ARRAY['postgres'::text, 'supabase_admin'::text]) LOOP
    BEGIN
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated, PUBLIC',
        role_name
      );
    EXCEPTION
      WHEN insufficient_privilege THEN
        RAISE NOTICE 'Insufficient privilege while hardening default TABLE ACL for role %.', role_name;
      WHEN undefined_object THEN
        RAISE NOTICE 'Role % not found while hardening default TABLE ACL.', role_name;
    END;

    BEGIN
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated, PUBLIC',
        role_name
      );
    EXCEPTION
      WHEN insufficient_privilege THEN
        RAISE NOTICE 'Insufficient privilege while hardening default FUNCTION ACL for role %.', role_name;
      WHEN undefined_object THEN
        RAISE NOTICE 'Role % not found while hardening default FUNCTION ACL.', role_name;
    END;

    BEGIN
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated, PUBLIC',
        role_name
      );
    EXCEPTION
      WHEN insufficient_privilege THEN
        RAISE NOTICE 'Insufficient privilege while hardening default SEQUENCE ACL for role %.', role_name;
      WHEN undefined_object THEN
        RAISE NOTICE 'Role % not found while hardening default SEQUENCE ACL.', role_name;
    END;
  END LOOP;
END;
$$;

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
        has_function_privilege('anon', p.oid, 'EXECUTE')
        OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
      )
  LOOP
    BEGIN
      EXECUTE format(
        'REVOKE EXECUTE ON FUNCTION %I.%I(%s) FROM PUBLIC, anon, authenticated',
        fn.schema_name,
        fn.function_name,
        fn.identity_args
      );
    EXCEPTION
      WHEN insufficient_privilege THEN
        RAISE NOTICE 'Insufficient privilege while revoking execute on %.%(%)', fn.schema_name, fn.function_name, fn.identity_args;
    END;
  END LOOP;
END;
$$;

-- 3) Single-use generation session claim (anti-race on expensive Gemini calls).

CREATE OR REPLACE FUNCTION public.claim_generation_session(
  p_generation_id uuid,
  p_user_id uuid,
  p_lock_ttl_seconds integer DEFAULT 300
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_now timestamptz := now();
  v_current_error text;
  v_lock_epoch bigint;
  v_lock_ts timestamptz;
  v_lock_token text;
  v_updated integer := 0;
BEGIN
  IF p_generation_id IS NULL OR p_user_id IS NULL THEN
    RETURN false;
  END IF;

  IF p_lock_ttl_seconds IS NULL OR p_lock_ttl_seconds < 30 THEN
    p_lock_ttl_seconds := 300;
  END IF;

  SELECT gl.error_code
  INTO v_current_error
  FROM public.generation_log gl
  WHERE gl.id = p_generation_id
    AND gl.user_id = p_user_id
    AND gl.status = 'pending'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_current_error IS NOT NULL AND v_current_error LIKE 'LOCK:%' THEN
    BEGIN
      v_lock_epoch := split_part(v_current_error, ':', 2)::bigint;
      v_lock_ts := to_timestamp(v_lock_epoch);
    EXCEPTION
      WHEN others THEN
        v_lock_ts := NULL;
    END;

    IF v_lock_ts IS NOT NULL
       AND v_lock_ts > (v_now - make_interval(secs => p_lock_ttl_seconds)) THEN
      RETURN false;
    END IF;
  END IF;

  v_lock_token := format(
    'LOCK:%s:%s',
    extract(epoch from v_now)::bigint,
    replace(gen_random_uuid()::text, '-', '')
  );

  UPDATE public.generation_log gl
  SET error_code = v_lock_token
  WHERE gl.id = p_generation_id
    AND gl.user_id = p_user_id
    AND gl.status = 'pending'
    AND (
      (v_current_error IS NULL AND gl.error_code IS NULL)
      OR gl.error_code = v_current_error
    );

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_generation_session(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_generation_session(uuid, uuid, integer) TO service_role;

-- 4) Harden anti-abuse helper RPCs.

CREATE OR REPLACE FUNCTION public.check_rate_limit(p_max_per_hour integer DEFAULT 10)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET row_security TO 'off'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_count integer;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN false;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('ai_rate_limit:' || v_user_id::text));

  SELECT count(*)
  INTO v_count
  FROM public.ai_request_log
  WHERE user_id = v_user_id
    AND created_at > now() - interval '1 hour';

  IF v_count >= p_max_per_hour THEN
    RETURN false;
  END IF;

  INSERT INTO public.ai_request_log (user_id)
  VALUES (v_user_id);

  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.check_extraction_rate_limit(
  p_max_per_hour integer DEFAULT 20,
  p_max_per_day integer DEFAULT 60
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET row_security TO 'off'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_count_hour integer;
  v_count_day integer;
  v_access record;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('extraction_rate_limit:' || v_user_id::text));

  SELECT *
  INTO v_access
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
$function$;

CREATE OR REPLACE FUNCTION public.check_norm_query_rate_limit(
  p_subtest_id text,
  p_age_months integer,
  p_raw_score real,
  p_source text DEFAULT 'compute_score'::text,
  p_per_minute integer DEFAULT 20,
  p_per_hour integer DEFAULT 200,
  p_per_day integer DEFAULT 800,
  p_distinct_subtests_per_hour integer DEFAULT 40
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET row_security TO 'off'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_count_minute integer;
  v_count_hour integer;
  v_count_day integer;
  v_distinct_subtests_hour integer;
  v_distinct_points_per_subtest_hour integer;
  v_distinct_point_threshold integer := 60;
BEGIN
  IF v_user_id IS NULL OR p_subtest_id IS NULL OR length(trim(p_subtest_id)) = 0 THEN
    RETURN false;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('norm_rate_limit:' || v_user_id::text || ':' || trim(p_subtest_id)));

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

  SELECT COUNT(
    DISTINCT concat_ws(
      ':',
      COALESCE(age_months::text, 'na'),
      COALESCE(raw_score::text, 'na')
    )
  )
  INTO v_distinct_points_per_subtest_hour
  FROM public.norm_query_log
  WHERE user_id = v_user_id
    AND subtest_id = p_subtest_id
    AND created_at >= now() - interval '1 hour';

  IF v_count_minute >= p_per_minute
     OR v_count_hour >= p_per_hour
     OR v_count_day >= p_per_day
     OR v_distinct_subtests_hour >= p_distinct_subtests_per_hour
     OR v_distinct_points_per_subtest_hour >= v_distinct_point_threshold THEN
    INSERT INTO public.norm_query_log (user_id, subtest_id, age_months, raw_score, source, blocked)
    VALUES (v_user_id, p_subtest_id, p_age_months, p_raw_score, p_source, true);
    RETURN false;
  END IF;

  INSERT INTO public.norm_query_log (user_id, subtest_id, age_months, raw_score, source, blocked)
  VALUES (v_user_id, p_subtest_id, p_age_months, p_raw_score, p_source, false);

  RETURN true;
END;
$function$;

-- 5) Service-only wrappers for edge functions (explicit user context, no client RPC exposure).

CREATE OR REPLACE FUNCTION public.check_rate_limit_for_user(
  p_user_id uuid,
  p_max_per_hour integer DEFAULT 10
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET row_security TO 'off'
AS $function$
DECLARE
  v_count integer;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN false;
  END IF;

  IF p_max_per_hour IS NULL OR p_max_per_hour < 1 THEN
    p_max_per_hour := 10;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('ai_rate_limit:' || p_user_id::text));

  SELECT count(*)
  INTO v_count
  FROM public.ai_request_log
  WHERE user_id = p_user_id
    AND created_at > now() - interval '1 hour';

  IF v_count >= p_max_per_hour THEN
    RETURN false;
  END IF;

  INSERT INTO public.ai_request_log (user_id)
  VALUES (p_user_id);

  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.check_extraction_access_for_user(
  p_user_id uuid
)
RETURNS TABLE(
  has_access boolean,
  extraction_quota integer,
  extractions_this_month integer,
  remaining_quota integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET row_security TO 'off'
AS $function$
DECLARE
  v_status text;
  v_plan_id text;
  v_quota integer;
  v_count_this_month integer;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN QUERY SELECT false, 0, 0, 0;
    RETURN;
  END IF;

  SELECT s.status, s.plan_id, COALESCE(s.monthly_extraction_quota, 100)
  INTO v_status, v_plan_id, v_quota
  FROM public.subscriptions s
  WHERE s.user_id = p_user_id
  ORDER BY s.created_at DESC NULLS LAST, s.id DESC
  LIMIT 1;

  IF v_status IS DISTINCT FROM 'active'
     OR v_plan_id NOT IN ('essential', 'performance', 'expert') THEN
    RETURN QUERY SELECT false, 0, 0, 0;
    RETURN;
  END IF;

  SELECT COUNT(*)
  INTO v_count_this_month
  FROM public.extraction_log e
  WHERE e.user_id = p_user_id
    AND e.created_at >= date_trunc('month', now())
    AND e.status = 'completed';

  RETURN QUERY SELECT
    true,
    v_quota,
    v_count_this_month,
    GREATEST(v_quota - v_count_this_month, 0);
END;
$function$;

CREATE OR REPLACE FUNCTION public.check_extraction_rate_limit_for_user(
  p_user_id uuid,
  p_max_per_hour integer DEFAULT 20,
  p_max_per_day integer DEFAULT 60
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET row_security TO 'off'
AS $function$
DECLARE
  v_count_hour integer;
  v_count_day integer;
  v_access record;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN false;
  END IF;

  IF p_max_per_hour IS NULL OR p_max_per_hour < 1 THEN
    p_max_per_hour := 20;
  END IF;
  IF p_max_per_day IS NULL OR p_max_per_day < 1 THEN
    p_max_per_day := 60;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('extraction_rate_limit:' || p_user_id::text));

  SELECT *
  INTO v_access
  FROM public.check_extraction_access_for_user(p_user_id)
  LIMIT 1;

  IF v_access IS NULL
     OR v_access.has_access IS DISTINCT FROM true
     OR COALESCE(v_access.remaining_quota, 0) <= 0 THEN
    RETURN false;
  END IF;

  SELECT COUNT(*)
  INTO v_count_hour
  FROM public.extraction_log
  WHERE user_id = p_user_id
    AND created_at >= now() - interval '1 hour';

  IF v_count_hour >= p_max_per_hour THEN
    RETURN false;
  END IF;

  SELECT COUNT(*)
  INTO v_count_day
  FROM public.extraction_log
  WHERE user_id = p_user_id
    AND created_at >= now() - interval '1 day';

  IF v_count_day >= p_max_per_day THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.consume_credit_for_user(
  p_user_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET row_security TO 'off'
AS $function$
DECLARE
  v_user_id uuid := p_user_id;
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

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT s.plan_id, s.status
  INTO v_plan_id, v_status
  FROM public.subscriptions s
  WHERE s.user_id = v_user_id
  ORDER BY s.created_at DESC NULLS LAST, s.id DESC
  LIMIT 1;

  IF COALESCE(v_is_admin, false) THEN
    INSERT INTO public.generation_log (user_id, status)
    VALUES (v_user_id, 'pending')
    RETURNING id INTO v_gen_id;
    RETURN v_gen_id;
  END IF;

  IF COALESCE(v_status, 'inactive') NOT IN ('active', 'trialing') THEN
    RETURN NULL;
  END IF;

  IF v_plan_id = 'expert' AND v_status = 'active' THEN
    INSERT INTO public.generation_log (user_id, status)
    VALUES (v_user_id, 'pending')
    RETURNING id INTO v_gen_id;
    RETURN v_gen_id;
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
$function$;

REVOKE ALL ON FUNCTION public.check_rate_limit(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(integer) TO service_role;

REVOKE ALL ON FUNCTION public.check_extraction_rate_limit(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_extraction_rate_limit(integer, integer) TO service_role;

REVOKE ALL ON FUNCTION public.check_extraction_access() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_extraction_access() TO service_role;

REVOKE ALL ON FUNCTION public.check_norm_query_rate_limit(text, integer, real, text, integer, integer, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_norm_query_rate_limit(text, integer, real, text, integer, integer, integer, integer) TO service_role;

REVOKE ALL ON FUNCTION public.consume_credit() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_credit() TO service_role;

REVOKE ALL ON FUNCTION public.check_rate_limit_for_user(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_rate_limit_for_user(uuid, integer) TO service_role;

REVOKE ALL ON FUNCTION public.check_extraction_access_for_user(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_extraction_access_for_user(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.check_extraction_rate_limit_for_user(uuid, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_extraction_rate_limit_for_user(uuid, integer, integer) TO service_role;

REVOKE ALL ON FUNCTION public.consume_credit_for_user(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_credit_for_user(uuid) TO service_role;
