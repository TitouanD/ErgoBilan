-- Required for security_invoker catalog path and RLS predicates using helper functions.
GRANT EXECUTE ON FUNCTION public.check_is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_is_member_of(uuid) TO authenticated;
