BEGIN;

CREATE OR REPLACE FUNCTION public.check_core_rpc_signatures()
RETURNS TABLE(function_name text, expected_args text, actual_args text, ok boolean)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH expected(function_name, expected_args) AS (
    VALUES
      ('compute_score', 'text, real, integer, text, text'),
      ('admin_get_test_bundle', 'text'),
      ('admin_save_test_bundle', 'jsonb'),
      ('create_private_test', 'jsonb'),
      ('merge_private_test', 'text, jsonb'),
      ('attach_subtests_to_test', 'text, jsonb')
  ),
  actual AS (
    SELECT p.proname::text AS function_name, oidvectortypes(p.proargtypes) AS actual_args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'compute_score',
        'admin_get_test_bundle',
        'admin_save_test_bundle',
        'create_private_test',
        'merge_private_test',
        'attach_subtests_to_test'
      )
  )
  SELECT
    e.function_name,
    e.expected_args,
    a.actual_args,
    (a.actual_args = e.expected_args) AS ok
  FROM expected e
  LEFT JOIN actual a USING (function_name)
  ORDER BY e.function_name;
$$;

GRANT EXECUTE ON FUNCTION public.check_core_rpc_signatures() TO authenticated, service_role;

COMMIT;;
