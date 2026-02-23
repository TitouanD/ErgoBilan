-- Allow native Supabase Auth email/password signups.
-- Onboarding and app access remain protected by existing PIN/onboarding gates.

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
