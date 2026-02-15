
-- ============================================================
-- RPC: find_similar_tests
-- Cross-scope fuzzy test name matching using pg_trgm
-- Returns public tests + user's org private tests sorted by similarity
-- ============================================================

CREATE OR REPLACE FUNCTION public.find_similar_tests(
  p_name text,
  p_threshold float DEFAULT 0.3
)
RETURNS TABLE(
  id text,
  name text,
  organization_id uuid,
  similarity_score float,
  subtests_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org_id uuid;
  v_norm text;
BEGIN
  -- Get caller's org (NULL if no org, which is fine)
  SELECT om.organization_id INTO v_org_id
  FROM organization_members om
  WHERE om.user_id = auth.uid()
  LIMIT 1;

  v_norm := norm_name(p_name);

  RETURN QUERY
    SELECT
      t.id,
      t.name,
      t.organization_id,
      similarity(norm_name(t.name), v_norm)::float AS similarity_score,
      (SELECT count(*) FROM official_subtests s WHERE s.test_id = t.id) AS subtests_count
    FROM official_tests t
    WHERE
      -- Visibility: public OR user's org
      (t.organization_id IS NULL OR t.organization_id = v_org_id)
      -- Fuzzy threshold
      AND similarity(norm_name(t.name), v_norm) > p_threshold
    ORDER BY similarity_score DESC
    LIMIT 10;
END;
$function$;
;
