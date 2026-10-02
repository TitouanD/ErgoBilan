
-- Fix: admin_update_user was silently discarding credit changes because
-- enforce_practitioner_defaults trigger reverts credits when auth.role()='authenticated',
-- even for SECURITY DEFINER functions (auth.role() reads from JWT, not session_user).
-- Adding app.internal_operation bypass (same pattern as consume_credit_for_user).

CREATE OR REPLACE FUNCTION public.admin_update_user(
  p_user_id uuid,
  p_is_admin boolean DEFAULT NULL,
  p_credits integer DEFAULT NULL,
  p_plan_id text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_trial_ends_at timestamptz DEFAULT NULL,
  p_current_period_end timestamptz DEFAULT NULL,
  p_monthly_extraction_quota integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_subscription_id uuid;
  v_existing_trial_ends_at timestamptz;
  v_existing_current_period_end timestamptz;
BEGIN
  IF NOT check_is_admin() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.practitioners WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'user_not_found' USING ERRCODE = '42704';
  END IF;

  IF p_credits IS NOT NULL AND p_credits < 0 THEN
    RAISE EXCEPTION 'credits must be >= 0';
  END IF;

  IF p_monthly_extraction_quota IS NOT NULL AND p_monthly_extraction_quota < 0 THEN
    RAISE EXCEPTION 'monthly_extraction_quota must be >= 0';
  END IF;

  IF p_plan_id IS NOT NULL AND p_plan_id NOT IN ('free', 'essential', 'performance', 'expert') THEN
    RAISE EXCEPTION 'invalid_plan_id';
  END IF;

  IF p_status IS NOT NULL AND p_status NOT IN ('active', 'trialing', 'canceled', 'past_due', 'inactive') THEN
    RAISE EXCEPTION 'invalid_subscription_status';
  END IF;

  -- Bypass trigger protection for admin operations (same pattern as consume_credit_for_user)
  PERFORM set_config('app.internal_operation', 'true', true);

  UPDATE public.practitioners
  SET
    is_admin = COALESCE(p_is_admin, is_admin),
    credits  = COALESCE(p_credits, credits)
  WHERE id = p_user_id;

  PERFORM set_config('app.internal_operation', 'false', true);

  IF p_plan_id IS NOT NULL
     OR p_status IS NOT NULL
     OR p_trial_ends_at IS NOT NULL
     OR p_current_period_end IS NOT NULL
     OR p_monthly_extraction_quota IS NOT NULL THEN

    SELECT
      s.id,
      s.trial_ends_at,
      s.current_period_end
    INTO
      v_subscription_id,
      v_existing_trial_ends_at,
      v_existing_current_period_end
    FROM public.subscriptions s
    WHERE s.user_id = p_user_id
    ORDER BY s.created_at DESC NULLS LAST
    LIMIT 1;

    IF v_subscription_id IS NULL THEN
      INSERT INTO public.subscriptions (
        user_id,
        plan_id,
        status,
        trial_ends_at,
        current_period_end,
        monthly_extraction_quota
      ) VALUES (
        p_user_id,
        COALESCE(p_plan_id, 'free'),
        COALESCE(p_status, 'inactive'),
        p_trial_ends_at,
        p_current_period_end,
        COALESCE(p_monthly_extraction_quota, 100)
      );
    ELSE
      UPDATE public.subscriptions
      SET
        plan_id              = COALESCE(p_plan_id, plan_id),
        status               = COALESCE(p_status, status),
        trial_ends_at        = COALESCE(p_trial_ends_at, v_existing_trial_ends_at),
        current_period_end   = COALESCE(p_current_period_end, v_existing_current_period_end),
        monthly_extraction_quota = COALESCE(p_monthly_extraction_quota, monthly_extraction_quota)
      WHERE id = v_subscription_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'user_id', p_user_id
  );
END;
$$;
;
