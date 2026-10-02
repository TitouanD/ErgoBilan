CREATE OR REPLACE FUNCTION public.admin_list_tests(p_scope text DEFAULT 'public'::text)
RETURNS TABLE(id text, name text, category_id text, organization_id uuid, created_at timestamp with time zone, subtest_count bigint, pending_norms_count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT check_is_admin() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    SELECT
      t.id,
      t.name,
      t.category_id,
      t.organization_id,
      t.created_at,
      (SELECT count(*) FROM official_subtests s WHERE s.test_id = t.id) AS subtest_count,
      0::bigint AS pending_norms_count
    FROM official_tests t
    WHERE (
      CASE
        WHEN p_scope = 'public' THEN t.organization_id IS NULL
        WHEN p_scope = 'private' THEN t.organization_id IS NOT NULL
        ELSE TRUE
      END
    )
    ORDER BY t.created_at DESC;
END;
$function$;;
