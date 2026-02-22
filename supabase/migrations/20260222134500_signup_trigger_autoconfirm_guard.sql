-- Keep direct signup blocked while preserving current edge signup behavior.
-- Direct /auth signup is autoconfirmed (mailer_autoconfirm=true) and should be rejected.
-- Edge signup creates unconfirmed users (email_confirm=false) and remains allowed.

CREATE OR REPLACE FUNCTION public.enforce_edge_signup_channel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF COALESCE(NEW.raw_app_meta_data ->> 'signup_channel', '') = 'edge_signup_v1' THEN
    RETURN NEW;
  END IF;

  IF NEW.email_confirmed_at IS NULL THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'DIRECT_SIGNUP_DISABLED: use secured signup edge endpoint';
END;
$function$;
