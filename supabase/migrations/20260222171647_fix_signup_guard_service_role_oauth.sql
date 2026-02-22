-- Signup guard fix:
-- - keep blocking direct email signup via /auth/v1/signup
-- - allow OAuth providers (non-email)
-- - allow service-role/admin mediated signup through secured Edge function

CREATE OR REPLACE FUNCTION public.enforce_edge_signup_channel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_provider text := lower(coalesce(NEW.raw_app_meta_data ->> 'provider', ''));
  v_role text := lower(coalesce(current_setting('request.jwt.claim.role', true), ''));
BEGIN
  -- Fallback for runtimes exposing the full claims object only.
  IF v_role = '' THEN
    BEGIN
      v_role := lower(
        coalesce((current_setting('request.jwt.claims', true)::jsonb ->> 'role'), '')
      );
    EXCEPTION
      WHEN others THEN
        v_role := '';
    END;
  END IF;

  -- OAuth / SSO providers are allowed (google, apple, github, etc.).
  -- Email/password remains gated below.
  IF v_provider <> '' AND v_provider <> 'email' THEN
    RETURN NEW;
  END IF;

  -- Secured signup Edge function runs with service role credentials.
  IF v_role IN ('service_role', 'supabase_admin') THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'DIRECT_SIGNUP_DISABLED: use secured signup edge endpoint';
END;
$function$;
