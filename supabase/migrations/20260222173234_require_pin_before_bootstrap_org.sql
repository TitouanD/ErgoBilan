-- Prevent org/subscription bootstrap before PIN onboarding is completed.

CREATE OR REPLACE FUNCTION public.bootstrap_org_for_user(
  p_user_id uuid,
  p_org_name text DEFAULT 'Mon Cabinet'::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org_id uuid;
  v_has_sub boolean;
BEGIN
  IF auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'Forbidden: you can only bootstrap your own organisation';
  END IF;

  IF NOT public.is_current_user_onboarded() THEN
    RAISE EXCEPTION 'Forbidden: complete PIN setup before bootstrapping organisation';
  END IF;

  SELECT organization_id
  INTO v_org_id
  FROM public.organization_members
  WHERE user_id = p_user_id
  LIMIT 1;

  IF v_org_id IS NULL THEN
    INSERT INTO public.organizations (name)
    VALUES (p_org_name)
    RETURNING id INTO v_org_id;

    INSERT INTO public.organization_members (organization_id, user_id, role)
    VALUES (v_org_id, p_user_id, 'owner');
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.subscriptions
    WHERE user_id = p_user_id
  )
  INTO v_has_sub;

  IF NOT v_has_sub THEN
    INSERT INTO public.subscriptions (user_id, plan_id, status, trial_ends_at)
    VALUES (
      p_user_id,
      'free',
      'trialing',
      now() + interval '14 days'
    );
  END IF;

  RETURN v_org_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.bootstrap_org_for_user(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bootstrap_org_for_user(uuid, text) TO authenticated, service_role;
