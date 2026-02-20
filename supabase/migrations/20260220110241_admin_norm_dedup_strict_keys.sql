-- Make norm duplicate scan/dedup truly "perfect duplicate" based on full norm row,
-- and keep organization scope isolated.

CREATE OR REPLACE FUNCTION public.admin_find_duplicate_norms(
  p_subtest_id text DEFAULT NULL::text,
  p_test_id text DEFAULT NULL::text
)
RETURNS TABLE(
  subtest_id text,
  subtest_name text,
  duplicate_group_count bigint,
  total_excess_rows bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT check_is_admin() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    WITH norm_groups AS (
      SELECT
        n.subtest_id,
        n.organization_id,
        n.age_min_months,
        n.age_max_months,
        n.gender,
        n.raw_min,
        n.raw_max,
        n.mean,
        n.sd,
        n.standard_score,
        n.percentile,
        count(*) AS cnt
      FROM public.official_norms n
      JOIN public.official_subtests s ON s.id = n.subtest_id
      WHERE (p_subtest_id IS NULL OR n.subtest_id = p_subtest_id)
        AND (p_test_id IS NULL OR s.test_id = p_test_id)
      GROUP BY
        n.subtest_id,
        n.organization_id,
        n.age_min_months,
        n.age_max_months,
        n.gender,
        n.raw_min,
        n.raw_max,
        n.mean,
        n.sd,
        n.standard_score,
        n.percentile
      HAVING count(*) > 1
    )
    SELECT
      ng.subtest_id,
      s.name AS subtest_name,
      count(*)::bigint AS duplicate_group_count,
      sum(ng.cnt - 1)::bigint AS total_excess_rows
    FROM norm_groups ng
    JOIN public.official_subtests s ON s.id = ng.subtest_id
    GROUP BY ng.subtest_id, s.name
    ORDER BY total_excess_rows DESC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_deduplicate_norms(
  p_subtest_id text DEFAULT NULL::text,
  p_test_id text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_deleted bigint;
BEGIN
  IF NOT check_is_admin() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  WITH ranked AS (
    SELECT
      n.id,
      row_number() OVER (
        PARTITION BY
          n.subtest_id,
          n.organization_id,
          n.age_min_months,
          n.age_max_months,
          n.gender,
          n.raw_min,
          n.raw_max,
          n.mean,
          n.sd,
          n.standard_score,
          n.percentile
        ORDER BY n.id
      ) AS rn
    FROM public.official_norms n
    JOIN public.official_subtests s ON s.id = n.subtest_id
    WHERE (p_subtest_id IS NULL OR n.subtest_id = p_subtest_id)
      AND (p_test_id IS NULL OR s.test_id = p_test_id)
  )
  DELETE FROM public.official_norms
  WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN jsonb_build_object('deleted', v_deleted);
END;
$function$;
