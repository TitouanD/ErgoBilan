-- P0 security hotfixes: credit flow, default ACLs, signup bypass hardening, catalog access restore

-- ---------------------------------------------------------------------------
-- 1) Fix credit consumption logic (remove dangling check_paid_access dependency)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.consume_credit()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT s.plan_id, s.status
  INTO v_plan_id, v_status
  FROM public.subscriptions s
  WHERE s.user_id = v_user_id
  LIMIT 1;

  -- Admin bypass: no credit decrement, but still create an auditable generation session.
  IF COALESCE(v_is_admin, false) THEN
    INSERT INTO public.generation_log (user_id, status)
    VALUES (v_user_id, 'pending')
    RETURNING id INTO v_gen_id;
    RETURN v_gen_id;
  END IF;

  -- Server-side access gate: only active/trialing subscriptions may generate.
  IF COALESCE(v_status, 'inactive') NOT IN ('active', 'trialing') THEN
    RETURN NULL;
  END IF;

  -- Active expert plan: unlimited generations, still tracked in generation_log.
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

-- ---------------------------------------------------------------------------
-- 2) Restore catalog read path for security_invoker views (without exposing norms)
-- ---------------------------------------------------------------------------
GRANT SELECT ON TABLE public.official_tests TO authenticated;
GRANT SELECT ON TABLE public.official_subtests TO authenticated;

-- ---------------------------------------------------------------------------
-- 3) Tighten anon portal table grants to minimum required columns
-- ---------------------------------------------------------------------------
REVOKE ALL ON TABLE public.pending_questionnaires FROM anon;
GRANT SELECT (id, status, family_encrypted_data) ON TABLE public.pending_questionnaires TO anon;
GRANT UPDATE (status, family_encrypted_data) ON TABLE public.pending_questionnaires TO anon;

-- ---------------------------------------------------------------------------
-- 4) Remove leftover sequence grants for non-privileged roles
-- ---------------------------------------------------------------------------
REVOKE ALL ON SEQUENCE public.ai_request_log_id_seq FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.signup_rate_limit_log_id_seq FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5) Fix default ACL drift (supabase_admin was still auto-granting anon/authenticated)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  BEGIN
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
      REVOKE ALL ON TABLES FROM anon, authenticated;
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
      REVOKE ALL ON FUNCTIONS FROM anon, authenticated;
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
      REVOKE ALL ON SEQUENCES FROM anon, authenticated;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Could not alter default privileges for role postgres: %', SQLERRM;
  END;

  BEGIN
    ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
      REVOKE ALL ON TABLES FROM anon, authenticated;
    ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
      REVOKE ALL ON FUNCTIONS FROM anon, authenticated;
    ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
      REVOKE ALL ON SEQUENCES FROM anon, authenticated;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Could not alter default privileges for role supabase_admin: %', SQLERRM;
  END;
END
$$;

-- ---------------------------------------------------------------------------
-- 6) Block direct Auth signup bypass: require edge marker in app metadata
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_edge_signup_channel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF COALESCE(NEW.raw_app_meta_data ->> 'signup_channel', '') <> 'edge_signup_v1' THEN
    RAISE EXCEPTION 'DIRECT_SIGNUP_DISABLED: use secured signup edge endpoint';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS tr_enforce_edge_signup_channel ON auth.users;
CREATE TRIGGER tr_enforce_edge_signup_channel
BEFORE INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.enforce_edge_signup_channel();
