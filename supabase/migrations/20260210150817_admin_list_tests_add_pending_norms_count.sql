
-- Drop and recreate admin_list_tests to include pending norms count
DROP FUNCTION IF EXISTS admin_list_tests(text);

CREATE FUNCTION admin_list_tests(p_scope text DEFAULT 'public')
RETURNS TABLE(
  id text,
  name text,
  category_id text,
  organization_id uuid,
  created_at timestamptz,
  subtest_count bigint,
  pending_norms_count bigint
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
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
      (
        SELECT count(*)
        FROM official_norms n
        JOIN official_subtests s ON s.id = n.subtest_id
        WHERE s.test_id = t.id AND n.organization_id IS NOT NULL
      ) AS pending_norms_count
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
$$;
;
