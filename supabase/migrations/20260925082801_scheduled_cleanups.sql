-- Scheduled cleanups (docs/TECH_DEBT.md P1-4, P1-8, P2-8).
--
-- 1. Portal questionnaires: nothing purged them (the purge-pending edge function
--    was never deployed and targeted a status nobody writes). Encrypted family
--    answers must not stay on the server forever.
-- 2. Generation sessions left 'pending' (report_bio succeeded but the diagnostic
--    never came) kept the credit consumed forever: refund them.
-- 3. ai_request_log (rate-limit journal) was never purged.

-- 1. Portal questionnaires ----------------------------------------------------
CREATE OR REPLACE FUNCTION public.purge_pending_questionnaires(
  p_pending_retention interval DEFAULT interval '14 days',
  p_completed_retention interval DEFAULT interval '30 days'
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $function$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM public.pending_questionnaires
  WHERE (coalesce(status, 'pending') = 'pending' AND created_at < now() - p_pending_retention)
     OR (status = 'completed' AND created_at < now() - p_completed_retention);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.purge_pending_questionnaires(interval, interval) FROM PUBLIC, anon, authenticated;

-- 2. Abandoned generation sessions --------------------------------------------
-- The reuse window of a session is GENERATION_REUSE_WINDOW_MINUTES (20 min) in the
-- edge function; sessions older than 30 minutes can no longer be used.
CREATE OR REPLACE FUNCTION public.sweep_stale_generations(p_older_than interval DEFAULT interval '30 minutes')
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $function$
DECLARE
  v_row record;
  v_count integer := 0;
BEGIN
  FOR v_row IN
    SELECT id, user_id FROM public.generation_log
    WHERE status = 'pending' AND created_at < now() - p_older_than
  LOOP
    IF public.finalize_generation_internal(v_row.id, v_row.user_id, false, 'ABANDONED_SESSION') THEN
      v_count := v_count + 1;
    END IF;
  END LOOP;
  RETURN v_count;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.sweep_stale_generations(interval) FROM PUBLIC, anon, authenticated;

-- 3. Rate-limit journal ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.purge_ai_request_log(p_retention interval DEFAULT interval '2 days')
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $function$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM public.ai_request_log WHERE created_at < now() - p_retention;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.purge_ai_request_log(interval) FROM PUBLIC, anon, authenticated;

-- Schedules (cron.schedule upserts by job name) ---------------------------------
SELECT cron.schedule('purge_pending_questionnaires', '15 3 * * *', $$SELECT public.purge_pending_questionnaires();$$);
SELECT cron.schedule('sweep_stale_generations', '*/15 * * * *', $$SELECT public.sweep_stale_generations();$$);
SELECT cron.schedule('purge_ai_request_log', '30 3 * * *', $$SELECT public.purge_ai_request_log();$$);
