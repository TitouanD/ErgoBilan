-- Restore execute grants for helper functions used by frontend-facing views/policies.
REVOKE ALL ON FUNCTION public.check_is_member_of(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_is_member_of(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.check_is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_is_admin() TO authenticated, service_role;
