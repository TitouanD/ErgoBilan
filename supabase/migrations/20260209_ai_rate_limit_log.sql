-- Migration: AI request rate limiting (per-request log)
-- Date: 2026-02-09
-- Purpose: enforce strict per-request rate limiting for AI calls.

BEGIN;

CREATE TABLE IF NOT EXISTS public.ai_request_log (
  id         bigserial PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ai_request_log ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS ai_request_log_user_idx
  ON public.ai_request_log (user_id, created_at DESC);

-- Lock down direct access; the SECURITY DEFINER function will insert.
REVOKE ALL ON TABLE public.ai_request_log FROM PUBLIC;
REVOKE ALL ON TABLE public.ai_request_log FROM anon, authenticated;

-- Replace rate limit function to use per-request log.
CREATE OR REPLACE FUNCTION public.check_rate_limit(p_max_per_hour integer DEFAULT 10)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET row_security = off
AS $function$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.ai_request_log
  WHERE user_id = auth.uid()
    AND created_at > now() - interval '1 hour';

  IF v_count >= p_max_per_hour THEN
    RETURN false;
  END IF;

  INSERT INTO public.ai_request_log (user_id)
  VALUES (auth.uid());

  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.check_rate_limit(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(integer) TO authenticated;

COMMIT;
