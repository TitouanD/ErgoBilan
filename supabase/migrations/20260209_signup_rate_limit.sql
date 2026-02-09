-- Migration: Signup rate limiting (IP-based)

CREATE TABLE IF NOT EXISTS public.signup_rate_limit_log (
    id bigserial PRIMARY KEY,
    ip_hash text NOT NULL,
    email_hash text,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS signup_rate_limit_ip_idx
  ON public.signup_rate_limit_log (ip_hash, created_at DESC);

CREATE INDEX IF NOT EXISTS signup_rate_limit_email_idx
  ON public.signup_rate_limit_log (email_hash, created_at DESC);

CREATE OR REPLACE FUNCTION public.check_signup_rate_limit(
  p_ip_hash text,
  p_email_hash text DEFAULT NULL,
  p_max_per_hour integer DEFAULT 5
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer;
BEGIN
  IF p_ip_hash IS NULL OR length(p_ip_hash) < 8 THEN
    RETURN false;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.signup_rate_limit_log
  WHERE ip_hash = p_ip_hash
    AND created_at > now() - interval '1 hour';

  IF v_count >= p_max_per_hour THEN
    RETURN false;
  END IF;

  INSERT INTO public.signup_rate_limit_log (ip_hash, email_hash)
  VALUES (p_ip_hash, p_email_hash);

  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.check_signup_rate_limit(text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_signup_rate_limit(text, text, integer) TO anon, authenticated;
