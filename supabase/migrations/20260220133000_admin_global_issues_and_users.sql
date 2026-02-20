-- Global admin backlog + user management RPCs
-- Also fixes insight anomaly detection by using score-type-aware thresholds.

CREATE OR REPLACE FUNCTION public.admin_list_issue_backlog()
RETURNS TABLE(
  test_id text,
  test_name text,
  organization_id uuid,
  subtest_count integer,
  missing_ambiguous_tags integer,
  duplicate_subtest_excess integer,
  duplicate_norm_groups integer,
  duplicate_norm_excess integer,
  quality_flag_count integer,
  total_issues integer
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
  WITH test_base AS (
    SELECT
      t.id AS test_id,
      t.name AS test_name,
      t.organization_id,
      COUNT(s.id)::integer AS subtest_count
    FROM public.official_tests t
    LEFT JOIN public.official_subtests s ON s.test_id = t.id
    GROUP BY t.id, t.name, t.organization_id
  ),
  prepared_subtests AS (
    SELECT
      s.id,
      s.test_id,
      norm_subtest_name(
        COALESCE(
          NULLIF(trim(regexp_replace(s.name, '\s*\([^()]{1,80}\)\s*$', '')), ''),
          s.name
        )
      ) AS base_name_key,
      public.normalize_subtest_abbreviation_tag(
        COALESCE(s.abbreviation, public.extract_trailing_tag(s.name))
      ) AS resolved_abbreviation
    FROM public.official_subtests s
  ),
  ambiguous_groups AS (
    SELECT
      ps.test_id,
      ps.base_name_key
    FROM prepared_subtests ps
    GROUP BY ps.test_id, ps.base_name_key
    HAVING COUNT(*) > 1
  ),
  missing_tags AS (
    SELECT
      ps.test_id,
      COUNT(*)::integer AS missing_ambiguous_tags
    FROM prepared_subtests ps
    JOIN ambiguous_groups ag
      ON ag.test_id = ps.test_id
     AND ag.base_name_key = ps.base_name_key
    WHERE ps.resolved_abbreviation IS NULL
    GROUP BY ps.test_id
  ),
  duplicate_subtests AS (
    SELECT
      grouped.test_id,
      COALESCE(SUM(grouped.cnt - 1), 0)::integer AS duplicate_subtest_excess
    FROM (
      SELECT
        ps.test_id,
        ps.base_name_key,
        COALESCE(ps.resolved_abbreviation, '') AS abbreviation_key,
        COUNT(*) AS cnt
      FROM prepared_subtests ps
      GROUP BY ps.test_id, ps.base_name_key, COALESCE(ps.resolved_abbreviation, '')
      HAVING COUNT(*) > 1
    ) grouped
    GROUP BY grouped.test_id
  ),
  duplicate_norms AS (
    SELECT
      grouped.test_id,
      COUNT(*)::integer AS duplicate_norm_groups,
      COALESCE(SUM(grouped.cnt - 1), 0)::integer AS duplicate_norm_excess
    FROM (
      SELECT
        s.test_id,
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
        COUNT(*) AS cnt
      FROM public.official_norms n
      JOIN public.official_subtests s ON s.id = n.subtest_id
      GROUP BY
        s.test_id,
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
      HAVING COUNT(*) > 1
    ) grouped
    GROUP BY grouped.test_id
  ),
  quality_flags AS (
    SELECT
      tb.test_id,
      COALESCE(q.cnt, 0)::integer AS quality_flag_count
    FROM test_base tb
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS cnt
      FROM public.admin_norm_quality_check(tb.test_id, NULL)
    ) q ON TRUE
  )
  SELECT
    tb.test_id,
    tb.test_name,
    tb.organization_id,
    tb.subtest_count,
    COALESCE(mt.missing_ambiguous_tags, 0) AS missing_ambiguous_tags,
    COALESCE(ds.duplicate_subtest_excess, 0) AS duplicate_subtest_excess,
    COALESCE(dn.duplicate_norm_groups, 0) AS duplicate_norm_groups,
    COALESCE(dn.duplicate_norm_excess, 0) AS duplicate_norm_excess,
    COALESCE(qf.quality_flag_count, 0) AS quality_flag_count,
    (
      COALESCE(mt.missing_ambiguous_tags, 0)
      + COALESCE(ds.duplicate_subtest_excess, 0)
      + COALESCE(dn.duplicate_norm_excess, 0)
      + COALESCE(qf.quality_flag_count, 0)
    )::integer AS total_issues
  FROM test_base tb
  LEFT JOIN missing_tags mt ON mt.test_id = tb.test_id
  LEFT JOIN duplicate_subtests ds ON ds.test_id = tb.test_id
  LEFT JOIN duplicate_norms dn ON dn.test_id = tb.test_id
  LEFT JOIN quality_flags qf ON qf.test_id = tb.test_id
  WHERE (
    COALESCE(mt.missing_ambiguous_tags, 0)
    + COALESCE(ds.duplicate_subtest_excess, 0)
    + COALESCE(dn.duplicate_norm_excess, 0)
    + COALESCE(qf.quality_flag_count, 0)
  ) > 0
  ORDER BY total_issues DESC, tb.test_name ASC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_list_users()
RETURNS TABLE(
  user_id uuid,
  email text,
  first_name text,
  last_name text,
  is_admin boolean,
  credits integer,
  organization_id uuid,
  organization_name text,
  organization_role text,
  subscription_plan text,
  subscription_status text,
  trial_ends_at timestamptz,
  current_period_end timestamptz,
  monthly_extraction_quota integer,
  created_at timestamptz
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
    p.id AS user_id,
    p.email,
    p.first_name,
    p.last_name,
    COALESCE(p.is_admin, false) AS is_admin,
    COALESCE(p.credits, 0) AS credits,
    om.organization_id,
    org.name AS organization_name,
    om.role AS organization_role,
    COALESCE(sub.plan_id, 'free') AS subscription_plan,
    COALESCE(sub.status, 'inactive') AS subscription_status,
    sub.trial_ends_at,
    sub.current_period_end,
    COALESCE(sub.monthly_extraction_quota, 100) AS monthly_extraction_quota,
    p.created_at
  FROM public.practitioners p
  LEFT JOIN public.organization_members om ON om.user_id = p.id
  LEFT JOIN public.organizations org ON org.id = om.organization_id
  LEFT JOIN LATERAL (
    SELECT
      s.plan_id,
      s.status,
      s.trial_ends_at,
      s.current_period_end,
      s.monthly_extraction_quota
    FROM public.subscriptions s
    WHERE s.user_id = p.id
    ORDER BY s.created_at DESC NULLS LAST
    LIMIT 1
  ) sub ON TRUE
  ORDER BY p.created_at DESC, p.email ASC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_update_user(
  p_user_id uuid,
  p_is_admin boolean DEFAULT NULL,
  p_credits integer DEFAULT NULL,
  p_plan_id text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_trial_ends_at timestamptz DEFAULT NULL,
  p_current_period_end timestamptz DEFAULT NULL,
  p_monthly_extraction_quota integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_subscription_id uuid;
  v_existing_trial_ends_at timestamptz;
  v_existing_current_period_end timestamptz;
BEGIN
  IF NOT check_is_admin() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.practitioners WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'user_not_found' USING ERRCODE = '42704';
  END IF;

  IF p_credits IS NOT NULL AND p_credits < 0 THEN
    RAISE EXCEPTION 'credits must be >= 0';
  END IF;

  IF p_monthly_extraction_quota IS NOT NULL AND p_monthly_extraction_quota < 0 THEN
    RAISE EXCEPTION 'monthly_extraction_quota must be >= 0';
  END IF;

  IF p_plan_id IS NOT NULL AND p_plan_id NOT IN ('free', 'essential', 'performance', 'expert') THEN
    RAISE EXCEPTION 'invalid_plan_id';
  END IF;

  IF p_status IS NOT NULL AND p_status NOT IN ('active', 'trialing', 'canceled', 'past_due', 'inactive') THEN
    RAISE EXCEPTION 'invalid_subscription_status';
  END IF;

  UPDATE public.practitioners
  SET
    is_admin = COALESCE(p_is_admin, is_admin),
    credits = COALESCE(p_credits, credits)
  WHERE id = p_user_id;

  IF p_plan_id IS NOT NULL
     OR p_status IS NOT NULL
     OR p_trial_ends_at IS NOT NULL
     OR p_current_period_end IS NOT NULL
     OR p_monthly_extraction_quota IS NOT NULL THEN

    SELECT
      s.id,
      s.trial_ends_at,
      s.current_period_end
    INTO
      v_subscription_id,
      v_existing_trial_ends_at,
      v_existing_current_period_end
    FROM public.subscriptions s
    WHERE s.user_id = p_user_id
    ORDER BY s.created_at DESC NULLS LAST
    LIMIT 1;

    IF v_subscription_id IS NULL THEN
      INSERT INTO public.subscriptions (
        user_id,
        plan_id,
        status,
        trial_ends_at,
        current_period_end,
        monthly_extraction_quota
      ) VALUES (
        p_user_id,
        COALESCE(p_plan_id, 'free'),
        COALESCE(p_status, 'inactive'),
        p_trial_ends_at,
        p_current_period_end,
        COALESCE(p_monthly_extraction_quota, 100)
      );
    ELSE
      UPDATE public.subscriptions
      SET
        plan_id = COALESCE(p_plan_id, plan_id),
        status = COALESCE(p_status, status),
        trial_ends_at = COALESCE(p_trial_ends_at, v_existing_trial_ends_at),
        current_period_end = COALESCE(p_current_period_end, v_existing_current_period_end),
        monthly_extraction_quota = COALESCE(p_monthly_extraction_quota, monthly_extraction_quota)
      WHERE id = v_subscription_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'user_id', p_user_id
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_insight_extreme_alerts(
  p_min_samples integer DEFAULT 10,
  p_min_extreme_rate real DEFAULT 5
)
RETURNS TABLE(
  test_id text,
  test_name text,
  total_samples integer,
  extreme_samples integer,
  extreme_rate real
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
  WITH scored AS (
    SELECT
      i.test_id,
      t.name AS test_name,
      s.score_type,
      i.computed_standard::real AS score
    FROM public.contribution_insights i
    JOIN public.official_subtests s ON s.id = i.subtest_id
    JOIN public.official_tests t ON t.id = i.test_id
    WHERE i.computed_standard IS NOT NULL
  ),
  flagged AS (
    SELECT
      sc.test_id,
      sc.test_name,
      CASE
        WHEN sc.score_type = 'standard' THEN sc.score < 55 OR sc.score > 145
        WHEN sc.score_type = 'scaled' THEN sc.score < 1 OR sc.score > 19
        WHEN sc.score_type IN ('t-score', 't_score', 't score') THEN sc.score < 20 OR sc.score > 80
        WHEN sc.score_type = 'sten' THEN sc.score < 1 OR sc.score > 10
        WHEN sc.score_type = 'percentile' THEN sc.score < 0 OR sc.score > 100
        ELSE FALSE
      END AS is_extreme
    FROM scored sc
    WHERE sc.score_type IN ('standard', 'scaled', 't-score', 't_score', 't score', 'sten', 'percentile')
  )
  SELECT
    f.test_id,
    f.test_name,
    COUNT(*)::integer AS total_samples,
    COUNT(*) FILTER (WHERE f.is_extreme)::integer AS extreme_samples,
    ROUND(
      (COUNT(*) FILTER (WHERE f.is_extreme)::numeric / NULLIF(COUNT(*), 0)::numeric) * 100,
      1
    )::real AS extreme_rate
  FROM flagged f
  GROUP BY f.test_id, f.test_name
  HAVING COUNT(*) >= GREATEST(p_min_samples, 1)
     AND (
       (COUNT(*) FILTER (WHERE f.is_extreme)::numeric / NULLIF(COUNT(*), 0)::numeric) * 100
     ) >= p_min_extreme_rate
  ORDER BY extreme_rate DESC, total_samples DESC, test_name ASC;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.admin_list_issue_backlog() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_users() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_user(uuid, boolean, integer, text, text, timestamptz, timestamptz, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_insight_extreme_alerts(integer, real) TO authenticated;
