-- Restore execute grants required by restrictive onboarding policies.
REVOKE ALL ON FUNCTION public.is_current_user_onboarded() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_current_user_onboarded() TO authenticated, service_role;
