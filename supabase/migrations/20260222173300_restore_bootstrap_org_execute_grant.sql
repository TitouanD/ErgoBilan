-- Restore explicit execute grants after function replacement.
REVOKE ALL ON FUNCTION public.bootstrap_org_for_user(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bootstrap_org_for_user(uuid, text) TO authenticated, service_role;
