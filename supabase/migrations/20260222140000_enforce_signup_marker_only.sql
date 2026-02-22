-- Enforce strict signup marker now that signup edge v10 injects app_metadata.signup_channel.

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
