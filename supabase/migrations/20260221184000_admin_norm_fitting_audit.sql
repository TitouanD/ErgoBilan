-- Global dataset + persisted dismissals for admin norm fitting audit.
-- No fitting math is executed in SQL: this only exposes data and override persistence.

CREATE TABLE IF NOT EXISTS public.admin_norm_fitting_issue_overrides (
  issue_key text PRIMARY KEY,
  test_id text NOT NULL REFERENCES public.official_tests(id) ON DELETE CASCADE,
  subtest_id text NOT NULL REFERENCES public.official_subtests(id) ON DELETE CASCADE,
  issue_code text NOT NULL,
  dismissed boolean NOT NULL DEFAULT true,
  reason text NULL,
  dismissed_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  dismissed_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.admin_norm_fitting_issue_overrides ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.admin_list_norm_fitting_dataset(
  p_scope text DEFAULT 'all',
  p_test_id text DEFAULT NULL::text,
  p_subtest_id text DEFAULT NULL::text
)
RETURNS TABLE(
  test_id text,
  test_name text,
  organization_id uuid,
  subtest_id text,
  subtest_name text,
  score_type text,
  computation_mode text,
  norm_id uuid,
  age_min_months integer,
  age_max_months integer,
  gender text,
  raw_min real,
  raw_max real,
  mean real,
  sd real,
  standard_score real,
  percentile real
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
  SELECT
    t.id AS test_id,
    t.name AS test_name,
    t.organization_id,
    s.id AS subtest_id,
    s.name AS subtest_name,
    s.score_type,
    s.computation_mode,
    n.id AS norm_id,
    n.age_min_months,
    n.age_max_months,
    n.gender,
    n.raw_min,
    n.raw_max,
    n.mean,
    n.sd,
    n.standard_score,
    n.percentile
  FROM public.official_norms n
  JOIN public.official_subtests s ON s.id = n.subtest_id
  JOIN public.official_tests t ON t.id = s.test_id
  WHERE (
      lower(COALESCE(p_scope, 'all')) = 'all'
      OR (lower(p_scope) = 'public' AND t.organization_id IS NULL)
      OR (lower(p_scope) = 'private' AND t.organization_id IS NOT NULL)
    )
    AND (p_test_id IS NULL OR t.id = p_test_id)
    AND (p_subtest_id IS NULL OR s.id = p_subtest_id)
  ORDER BY t.name ASC, s.name ASC, n.age_min_months NULLS FIRST, n.raw_min NULLS FIRST, n.id ASC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_list_norm_fitting_issue_overrides(
  p_test_id text DEFAULT NULL::text,
  p_subtest_id text DEFAULT NULL::text
)
RETURNS TABLE(
  issue_key text,
  test_id text,
  subtest_id text,
  issue_code text,
  dismissed boolean,
  reason text,
  dismissed_by uuid,
  dismissed_at timestamptz,
  updated_at timestamptz
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
  SELECT
    o.issue_key,
    o.test_id,
    o.subtest_id,
    o.issue_code,
    o.dismissed,
    o.reason,
    o.dismissed_by,
    o.dismissed_at,
    o.updated_at
  FROM public.admin_norm_fitting_issue_overrides o
  WHERE (p_test_id IS NULL OR o.test_id = p_test_id)
    AND (p_subtest_id IS NULL OR o.subtest_id = p_subtest_id)
  ORDER BY o.updated_at DESC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_set_norm_fitting_issue_dismissed(
  p_issue_key text,
  p_test_id text,
  p_subtest_id text,
  p_issue_code text,
  p_dismissed boolean DEFAULT true,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT check_is_admin() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  IF COALESCE(trim(p_issue_key), '') = ''
    OR COALESCE(trim(p_test_id), '') = ''
    OR COALESCE(trim(p_subtest_id), '') = ''
    OR COALESCE(trim(p_issue_code), '') = '' THEN
    RAISE EXCEPTION 'issue_key, test_id, subtest_id and issue_code are required';
  END IF;

  IF p_dismissed THEN
    INSERT INTO public.admin_norm_fitting_issue_overrides (
      issue_key,
      test_id,
      subtest_id,
      issue_code,
      dismissed,
      reason,
      dismissed_by,
      dismissed_at,
      updated_at
    )
    VALUES (
      p_issue_key,
      p_test_id,
      p_subtest_id,
      p_issue_code,
      true,
      NULLIF(trim(p_reason), ''),
      auth.uid(),
      now(),
      now()
    )
    ON CONFLICT (issue_key)
    DO UPDATE SET
      test_id = EXCLUDED.test_id,
      subtest_id = EXCLUDED.subtest_id,
      issue_code = EXCLUDED.issue_code,
      dismissed = true,
      reason = EXCLUDED.reason,
      dismissed_by = auth.uid(),
      dismissed_at = now(),
      updated_at = now();
  ELSE
    DELETE FROM public.admin_norm_fitting_issue_overrides
    WHERE issue_key = p_issue_key;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'issue_key', p_issue_key,
    'dismissed', p_dismissed
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.admin_list_norm_fitting_dataset(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_norm_fitting_issue_overrides(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_norm_fitting_issue_dismissed(text, text, text, text, boolean, text) TO authenticated;
