-- ============================================================
-- Migration: admin_get_ai_health_stats RPC (2026-03-04)
--
-- Replaces the fully-mocked MOCK_AI_STATS in services/admin.ts
-- with real data from the generation_log table.
--
-- generation_log columns used:
--   created_at  – timestamp of the AI generation request
--   status      – 'success' | 'error' | etc.
--   error_code  – non-null when the request failed
--
-- Returns last 30 days of per-day aggregates so the frontend
-- can render both 7-day and 30-day views without another round-trip.
-- ============================================================

CREATE OR REPLACE FUNCTION public.admin_get_ai_health_stats()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_daily      jsonb;
  v_total_req  bigint;
  v_total_err  bigint;
BEGIN
  -- Admin-only guard
  IF NOT public.check_is_admin() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  -- Per-day aggregates for the last 30 days
  SELECT
    jsonb_agg(
      jsonb_build_object(
        'date',     to_char(day_bucket, 'DD/MM'),
        'requests', COALESCE(req_count, 0),
        'errors',   COALESCE(err_count, 0)
      )
      ORDER BY day_bucket ASC
    )
  INTO v_daily
  FROM (
    SELECT
      date_trunc('day', created_at AT TIME ZONE 'UTC') AS day_bucket,
      COUNT(*)                                          AS req_count,
      COUNT(*) FILTER (WHERE error_code IS NOT NULL)   AS err_count
    FROM public.generation_log
    WHERE created_at >= NOW() - INTERVAL '30 days'
    GROUP BY date_trunc('day', created_at AT TIME ZONE 'UTC')
  ) agg;

  -- Overall totals for the same window
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE error_code IS NOT NULL)
  INTO v_total_req, v_total_err
  FROM public.generation_log
  WHERE created_at >= NOW() - INTERVAL '30 days';

  RETURN jsonb_build_object(
    'daily',          COALESCE(v_daily, '[]'::jsonb),
    'total_requests', COALESCE(v_total_req, 0),
    'total_errors',   COALESCE(v_total_err, 0),
    'error_rate_pct', CASE
                        WHEN COALESCE(v_total_req, 0) = 0 THEN 0
                        ELSE ROUND((v_total_err::numeric / v_total_req::numeric) * 100, 1)
                      END
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.admin_get_ai_health_stats() TO authenticated;
