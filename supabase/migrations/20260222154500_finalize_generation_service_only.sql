BEGIN;

CREATE OR REPLACE FUNCTION public.finalize_generation_internal(
  p_generation_id uuid,
  p_user_id uuid,
  p_success boolean,
  p_error_code text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_log public.generation_log%ROWTYPE;
  v_is_admin boolean;
  v_plan_id text;
  v_status text;
BEGIN
  IF p_user_id IS NULL OR p_generation_id IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT *
  INTO v_log
  FROM public.generation_log
  WHERE id = p_generation_id
    AND user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND OR v_log.status <> 'pending' THEN
    RETURN FALSE;
  END IF;

  IF p_success THEN
    UPDATE public.generation_log
    SET status = 'completed',
        error_code = NULL
    WHERE id = p_generation_id;
    RETURN TRUE;
  END IF;

  UPDATE public.generation_log
  SET status = 'failed',
      refunded_at = now(),
      error_code = p_error_code
  WHERE id = p_generation_id;

  SELECT p.is_admin
  INTO v_is_admin
  FROM public.practitioners p
  WHERE p.id = p_user_id;

  SELECT s.plan_id, s.status
  INTO v_plan_id, v_status
  FROM public.subscriptions s
  WHERE s.user_id = p_user_id
  LIMIT 1;

  IF COALESCE(v_is_admin, false)
     OR (v_plan_id = 'expert' AND v_status = 'active') THEN
    UPDATE public.generation_log
    SET status = 'refunded'
    WHERE id = p_generation_id;
    RETURN TRUE;
  END IF;

  PERFORM set_config('app.internal_operation', 'true', true);
  UPDATE public.practitioners
  SET credits = credits + 1
  WHERE id = p_user_id;
  PERFORM set_config('app.internal_operation', 'false', true);

  UPDATE public.generation_log
  SET status = 'refunded'
  WHERE id = p_generation_id;

  RETURN TRUE;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.finalize_generation(uuid, boolean, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_generation(uuid, boolean, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.finalize_generation_internal(uuid, uuid, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_generation_internal(uuid, uuid, boolean, text) TO service_role;

COMMIT;
