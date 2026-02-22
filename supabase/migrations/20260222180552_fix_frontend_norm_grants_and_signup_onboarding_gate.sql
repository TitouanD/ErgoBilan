-- Restore frontend-safe catalog/norm access after hardening
-- while keeping base norm tables private.
-- Also enforce email signup marker so email/password users must come
-- through the secured signup edge flow.

CREATE OR REPLACE FUNCTION public.enforce_edge_signup_channel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_provider text := lower(coalesce(NEW.raw_app_meta_data ->> 'provider', ''));
  v_signup_channel text := lower(coalesce(NEW.raw_app_meta_data ->> 'signup_channel', ''));
BEGIN
  -- OAuth/SSO providers are allowed and still gated by onboarding RLS.
  IF v_provider <> '' AND v_provider <> 'email' THEN
    RETURN NEW;
  END IF;

  -- Email/password accounts must be minted by the secured edge flow.
  IF v_signup_channel = 'edge_signup_v1' THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'DIRECT_SIGNUP_DISABLED: use secured signup edge endpoint';
END;
$function$;

CREATE OR REPLACE FUNCTION public.is_current_user_onboarded()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
SET row_security TO 'off'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.practitioners p
    JOIN auth.users u ON u.id = p.id
    WHERE p.id = auth.uid()
      AND p.encryption_salt IS NOT NULL
      AND p.encryption_validator IS NOT NULL
      AND p.encryption_salt <> 'pending'
      AND p.encryption_validator <> 'pending'
  );
$function$;

CREATE OR REPLACE VIEW public.view_unified_catalog
WITH (security_invoker = false)
AS
SELECT
  t.id,
  t.name AS label,
  t.category_id,
  c.label AS category_label,
  c.icon_key,
  c.sort_order,
  (
    SELECT count(*)
    FROM public.official_subtests s
    WHERE public.is_current_user_onboarded()
      AND s.test_id = t.id
      AND (s.organization_id IS NULL OR public.check_is_member_of(s.organization_id))
  ) AS subtests_count
FROM public.official_tests t
JOIN public.official_categories c ON c.id = t.category_id
WHERE public.is_current_user_onboarded()
  AND (t.organization_id IS NULL OR public.check_is_member_of(t.organization_id));

CREATE OR REPLACE VIEW public.view_unified_subtests
WITH (security_invoker = false)
AS
SELECT
  s.id,
  s.test_id,
  s.name,
  s.unit,
  s.score_type,
  s.computation_mode,
  s.input_model,
  s.input_config,
  s.abbreviation
FROM public.official_subtests s
JOIN public.official_tests t ON t.id = s.test_id
WHERE public.is_current_user_onboarded()
  AND (t.organization_id IS NULL OR public.check_is_member_of(t.organization_id))
  AND (s.organization_id IS NULL OR public.check_is_member_of(s.organization_id));

GRANT SELECT ON TABLE public.view_unified_catalog TO authenticated;
GRANT SELECT ON TABLE public.view_unified_subtests TO authenticated;

GRANT EXECUTE ON FUNCTION public.compute_score(text, real, integer, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_norms_availability(text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_norms_applicability(text[], integer, text) TO authenticated;

DO $$
DECLARE
  fn record;
BEGIN
  FOR fn IN
    SELECT
      n.nspname AS schema_name,
      p.proname AS function_name,
      pg_get_function_identity_arguments(p.oid) AS identity_args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('bootstrap_practitioner_for_user', 'bootstrap_org_for_user')
  LOOP
    EXECUTE format(
      'GRANT EXECUTE ON FUNCTION %I.%I(%s) TO authenticated',
      fn.schema_name,
      fn.function_name,
      fn.identity_args
    );
  END LOOP;
END;
$$;
