-- Relax signup trigger (dev-compatible) and enforce onboarding/PIN before
-- allowing credit consumption and extraction access.

-- 1) Do not hard-block auth provider signup at INSERT time.
--    Rationale: Auth trigger context does not expose reliable request claims
--    to distinguish /auth/v1/signup from /auth/v1/admin/users.
--    Enforcement is moved to post-auth onboarding gates below.
CREATE OR REPLACE FUNCTION public.enforce_edge_signup_channel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN NEW;
END;
$function$;

-- 2) Central helper: user is onboarded only after PIN material is configured.
CREATE OR REPLACE FUNCTION public.is_practitioner_pin_configured(
  p_user_id uuid
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
SET row_security TO 'off'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.practitioners p
    WHERE p.id = p_user_id
      AND p.encryption_salt IS NOT NULL
      AND p.encryption_validator IS NOT NULL
      AND p.encryption_salt <> 'pending'
      AND p.encryption_validator <> 'pending'
  );
$function$;

REVOKE ALL ON FUNCTION public.is_practitioner_pin_configured(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_practitioner_pin_configured(uuid) TO service_role;

-- 3) Block generation credit flow until PIN/onboarding is configured.
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

  IF NOT public.is_practitioner_pin_configured(v_user_id) THEN
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

-- 4) Block extraction entitlement until PIN/onboarding is configured.
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

  IF NOT public.is_practitioner_pin_configured(p_user_id) THEN
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
