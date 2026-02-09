-- Migration: Signup rate limit hardening + cleanup
-- Date: 2026-02-09

BEGIN;

-- Enable RLS and revoke direct access
ALTER TABLE public.signup_rate_limit_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.signup_rate_limit_log FROM PUBLIC;
REVOKE ALL ON TABLE public.signup_rate_limit_log FROM anon, authenticated;

-- Update function to bypass RLS safely (still SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public.check_signup_rate_limit(
  p_ip_hash text,
  p_email_hash text DEFAULT NULL,
  p_max_per_hour integer DEFAULT 5
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET row_security = off
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

-- Cleanup function (manual or scheduled)
CREATE OR REPLACE FUNCTION public.purge_signup_rate_limit_log(
  p_retention_hours integer DEFAULT 24
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET row_security = off
AS $function$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM public.signup_rate_limit_log
  WHERE created_at < now() - make_interval(hours => p_retention_hours);

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$function$;

REVOKE ALL ON FUNCTION public.purge_signup_rate_limit_log(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.purge_signup_rate_limit_log(integer) TO service_role;

COMMIT;

-- Optional: schedule cleanup if pg_cron is available (safe to ignore if not)
DO $$
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'pg_cron not available (insufficient privilege), skipping schedule.';
  END;

  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
      IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge_signup_rl') THEN
        PERFORM cron.schedule('purge_signup_rl', '0 * * * *', $cron$SELECT public.purge_signup_rate_limit_log();$cron$);
      END IF;
    END IF;
  END IF;
EXCEPTION WHEN undefined_table THEN
  RAISE NOTICE 'pg_cron not available, skipping purge job.';
END $$;
