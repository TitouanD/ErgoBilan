-- Step 2 score reliability hardening:
-- - raw direction support (auto/higher/lower)
-- - organization override clones for subtests
-- - explicit norms status RPC
-- - compute_score_core direction-aware parametric scoring
-- - unified subtests view prefers org override clones
-- - issue backlog enriched with zero-norm and low-confidence counters

ALTER TABLE public.official_subtests
  ADD COLUMN IF NOT EXISTS raw_direction text NOT NULL DEFAULT 'auto',
  ADD COLUMN IF NOT EXISTS source_subtest_id text NULL,
  ADD COLUMN IF NOT EXISTS is_override_clone boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'official_subtests_raw_direction_check'
      AND conrelid = 'public.official_subtests'::regclass
  ) THEN
    ALTER TABLE public.official_subtests
      ADD CONSTRAINT official_subtests_raw_direction_check
      CHECK (raw_direction IN ('auto', 'higher_better', 'lower_better'));
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS official_subtests_org_source_override_uniq_idx
  ON public.official_subtests (organization_id, source_subtest_id)
  WHERE source_subtest_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.subtest_direction_override_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_subtest_id text NOT NULL,
  effective_subtest_id text NOT NULL,
  organization_id uuid NOT NULL,
  previous_raw_direction text,
  new_raw_direction text NOT NULL,
  reason text,
  changed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.subtest_direction_override_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS subtest_direction_override_events_admin_read ON public.subtest_direction_override_events;
CREATE POLICY subtest_direction_override_events_admin_read
  ON public.subtest_direction_override_events
  FOR SELECT
  TO authenticated
  USING (public.check_is_admin());

DROP POLICY IF EXISTS subtest_direction_override_events_insert_system ON public.subtest_direction_override_events;
CREATE POLICY subtest_direction_override_events_insert_system
  ON public.subtest_direction_override_events
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE OR REPLACE FUNCTION public.resolve_effective_subtest_id(
  p_subtest_id text,
  p_org_id uuid
)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH input_subtest AS (
    SELECT id, organization_id, source_subtest_id
    FROM public.official_subtests
    WHERE id = p_subtest_id
    LIMIT 1
  ),
  clone_for_input AS (
    SELECT c.id
    FROM public.official_subtests c
    WHERE c.organization_id = p_org_id
      AND c.is_override_clone = true
      AND c.source_subtest_id = p_subtest_id
    ORDER BY c.created_at DESC, c.id DESC
    LIMIT 1
  ),
  clone_for_source AS (
    SELECT c.id
    FROM input_subtest i
    JOIN public.official_subtests c
      ON c.organization_id = p_org_id
     AND c.is_override_clone = true
     AND c.source_subtest_id = i.source_subtest_id
    ORDER BY c.created_at DESC, c.id DESC
    LIMIT 1
  )
  SELECT COALESCE(
    (SELECT id FROM clone_for_input),
    (SELECT id FROM clone_for_source),
    p_subtest_id
  );
$function$;

CREATE OR REPLACE FUNCTION public.admin_create_or_update_subtest_override_clone(
  p_source_subtest_id text,
  p_raw_direction text,
  p_reason text DEFAULT NULL
)
RETURNS TABLE(
  effective_subtest_id text,
  created boolean,
  updated_norms_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_org_id uuid;
  v_user_id uuid := auth.uid();
  v_source public.official_subtests%ROWTYPE;
  v_clone public.official_subtests%ROWTYPE;
  v_clone_id text;
  v_previous_direction text;
  v_new_direction text := lower(trim(coalesce(p_raw_direction, '')));
  v_inserted_norms integer := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  IF v_new_direction NOT IN ('higher_better', 'lower_better', 'auto') THEN
    RAISE EXCEPTION 'invalid raw direction: %', p_raw_direction USING ERRCODE = '22023';
  END IF;

  SELECT om.organization_id
    INTO v_caller_org_id
  FROM public.organization_members om
  WHERE om.user_id = v_user_id
  LIMIT 1;

  IF v_caller_org_id IS NULL THEN
    RAISE EXCEPTION 'organization not found for caller' USING ERRCODE = '42501';
  END IF;

  SELECT *
    INTO v_source
  FROM public.official_subtests s
  WHERE s.id = p_source_subtest_id
    AND (s.organization_id IS NULL OR s.organization_id = v_caller_org_id)
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'subtest not found or not accessible: %', p_source_subtest_id USING ERRCODE = '42501';
  END IF;

  -- If the source is already an org-scoped subtest (private), update in place.
  IF v_source.organization_id = v_caller_org_id THEN
    v_previous_direction := coalesce(v_source.raw_direction, 'auto');

    UPDATE public.official_subtests
    SET raw_direction = v_new_direction
    WHERE id = v_source.id;

    INSERT INTO public.subtest_direction_override_events(
      source_subtest_id,
      effective_subtest_id,
      organization_id,
      previous_raw_direction,
      new_raw_direction,
      reason,
      changed_by
    )
    VALUES (
      coalesce(v_source.source_subtest_id, v_source.id),
      v_source.id,
      v_caller_org_id,
      v_previous_direction,
      v_new_direction,
      p_reason,
      v_user_id
    );

    RETURN QUERY
    SELECT v_source.id, false, 0;
    RETURN;
  END IF;

  -- Public source -> upsert org override clone keyed by (org, source_subtest_id)
  SELECT *
    INTO v_clone
  FROM public.official_subtests c
  WHERE c.organization_id = v_caller_org_id
    AND c.source_subtest_id = v_source.id
    AND c.is_override_clone = true
  ORDER BY c.created_at DESC, c.id DESC
  LIMIT 1;

  IF FOUND THEN
    v_previous_direction := coalesce(v_clone.raw_direction, 'auto');
    UPDATE public.official_subtests
    SET raw_direction = v_new_direction
    WHERE id = v_clone.id;

    INSERT INTO public.subtest_direction_override_events(
      source_subtest_id,
      effective_subtest_id,
      organization_id,
      previous_raw_direction,
      new_raw_direction,
      reason,
      changed_by
    )
    VALUES (
      v_source.id,
      v_clone.id,
      v_caller_org_id,
      v_previous_direction,
      v_new_direction,
      p_reason,
      v_user_id
    );

    RETURN QUERY
    SELECT v_clone.id, false, 0;
    RETURN;
  END IF;

  v_clone_id := format(
    '%s__ovr_%s',
    v_source.id,
    substring(replace(gen_random_uuid()::text, '-', ''), 1, 8)
  );

  INSERT INTO public.official_subtests(
    id,
    test_id,
    name,
    unit,
    score_type,
    computation_mode,
    created_at,
    organization_id,
    input_model,
    input_config,
    abbreviation,
    raw_direction,
    source_subtest_id,
    is_override_clone
  )
  VALUES (
    v_clone_id,
    v_source.test_id,
    v_source.name,
    v_source.unit,
    v_source.score_type,
    v_source.computation_mode,
    now(),
    v_caller_org_id,
    v_source.input_model,
    coalesce(v_source.input_config, '{}'::jsonb),
    v_source.abbreviation,
    v_new_direction,
    v_source.id,
    true
  );

  INSERT INTO public.official_norms(
    subtest_id,
    age_min_months,
    age_max_months,
    gender,
    mean,
    sd,
    raw_min,
    raw_max,
    standard_score,
    percentile,
    organization_id
  )
  SELECT
    v_clone_id,
    n.age_min_months,
    n.age_max_months,
    n.gender,
    n.mean,
    n.sd,
    n.raw_min,
    n.raw_max,
    n.standard_score,
    n.percentile,
    v_caller_org_id
  FROM public.official_norms n
  WHERE n.subtest_id = v_source.id
    AND (n.organization_id IS NULL OR n.organization_id = v_source.organization_id);

  GET DIAGNOSTICS v_inserted_norms = ROW_COUNT;

  INSERT INTO public.subtest_direction_override_events(
    source_subtest_id,
    effective_subtest_id,
    organization_id,
    previous_raw_direction,
    new_raw_direction,
    reason,
    changed_by
  )
  VALUES (
    v_source.id,
    v_clone_id,
    v_caller_org_id,
    coalesce(v_source.raw_direction, 'auto'),
    v_new_direction,
    p_reason,
    v_user_id
  );

  RETURN QUERY
  SELECT v_clone_id, true, v_inserted_norms;
END;
$function$;

CREATE OR REPLACE FUNCTION public.check_norms_status(
  p_subtest_ids text[],
  p_age_months integer,
  p_gender text DEFAULT 'Mixed'
)
RETURNS TABLE(
  subtest_id text,
  has_norms boolean,
  has_applicable_norms boolean,
  status_code text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_onboarded boolean := public.is_current_user_onboarded();
  v_caller_org_id uuid;
  v_input_subtest_id text;
  v_effective_subtest_id text;
  v_has_access boolean;
  v_has_norms boolean;
  v_has_applicable boolean;
BEGIN
  SELECT om.organization_id
    INTO v_caller_org_id
  FROM public.organization_members om
  WHERE om.user_id = auth.uid()
  LIMIT 1;

  FOREACH v_input_subtest_id IN ARRAY p_subtest_ids LOOP
    IF NOT v_onboarded THEN
      subtest_id := v_input_subtest_id;
      has_norms := false;
      has_applicable_norms := false;
      status_code := 'onboarding_required';
      RETURN NEXT;
      CONTINUE;
    END IF;

    v_effective_subtest_id := public.resolve_effective_subtest_id(v_input_subtest_id, v_caller_org_id);

    SELECT EXISTS (
      SELECT 1
      FROM public.official_subtests s
      WHERE s.id = v_effective_subtest_id
        AND (s.organization_id IS NULL OR s.organization_id = v_caller_org_id)
    ) INTO v_has_access;

    IF NOT v_has_access THEN
      subtest_id := v_input_subtest_id;
      has_norms := false;
      has_applicable_norms := false;
      status_code := 'access_restricted';
      RETURN NEXT;
      CONTINUE;
    END IF;

    SELECT EXISTS (
      SELECT 1
      FROM public.official_norms n
      WHERE n.subtest_id = v_effective_subtest_id
        AND (n.organization_id IS NULL OR n.organization_id = v_caller_org_id)
      LIMIT 1
    ) INTO v_has_norms;

    SELECT EXISTS (
      SELECT 1
      FROM public.official_norms n
      WHERE n.subtest_id = v_effective_subtest_id
        AND (n.organization_id IS NULL OR n.organization_id = v_caller_org_id)
        AND n.age_min_months <= p_age_months
        AND n.age_max_months >= p_age_months
        AND (n.gender = p_gender OR n.gender = 'Mixed')
      LIMIT 1
    ) INTO v_has_applicable;

    subtest_id := v_input_subtest_id;
    has_norms := v_has_norms;
    has_applicable_norms := v_has_applicable;
    status_code := CASE
      WHEN NOT v_has_norms THEN 'no_norms'
      WHEN v_has_applicable THEN 'ok'
      ELSE 'no_applicable_age_gender'
    END;
    RETURN NEXT;
  END LOOP;
END;
$function$;

CREATE OR REPLACE VIEW public.view_unified_subtests
WITH (security_invoker = false)
AS
WITH caller AS (
  SELECT om.organization_id AS caller_org_id
  FROM public.organization_members om
  WHERE om.user_id = auth.uid()
  LIMIT 1
),
visible_subtests AS (
  SELECT
    s.*,
    t.organization_id AS test_organization_id,
    (SELECT caller_org_id FROM caller) AS caller_org_id
  FROM public.official_subtests s
  JOIN public.official_tests t ON t.id = s.test_id
  WHERE public.is_current_user_onboarded()
    AND (t.organization_id IS NULL OR public.check_is_member_of(t.organization_id))
    AND (s.organization_id IS NULL OR public.check_is_member_of(s.organization_id))
)
SELECT
  s.id,
  s.test_id,
  s.name,
  s.unit,
  s.score_type,
  s.computation_mode,
  s.input_model,
  s.input_config,
  s.abbreviation,
  s.raw_direction,
  s.source_subtest_id,
  s.is_override_clone
FROM visible_subtests s
WHERE
  s.organization_id = s.caller_org_id
  OR (
    s.organization_id IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM visible_subtests c
      WHERE c.organization_id = s.caller_org_id
        AND c.is_override_clone = true
        AND c.source_subtest_id = s.id
    )
  );

CREATE OR REPLACE VIEW public.view_unified_catalog
WITH (security_invoker = false)
AS
SELECT
  t.id,
  t.name AS label,
  t.category_id,
  c.label AS category_label,
  c.icon_key,
  c.sort_order,
  (
    WITH caller AS (
      SELECT om.organization_id AS caller_org_id
      FROM public.organization_members om
      WHERE om.user_id = auth.uid()
      LIMIT 1
    )
    SELECT count(*)
    FROM public.official_subtests s
    WHERE public.is_current_user_onboarded()
      AND s.test_id = t.id
      AND (s.organization_id IS NULL OR public.check_is_member_of(s.organization_id))
      AND (
        s.organization_id = (SELECT caller_org_id FROM caller)
        OR (
          s.organization_id IS NULL
          AND NOT EXISTS (
            SELECT 1
            FROM public.official_subtests csub
            WHERE csub.organization_id = (SELECT caller_org_id FROM caller)
              AND csub.is_override_clone = true
              AND csub.source_subtest_id = s.id
          )
        )
      )
  ) AS subtests_count
FROM public.official_tests t
JOIN public.official_categories c ON c.id = t.category_id
WHERE public.is_current_user_onboarded()
  AND (t.organization_id IS NULL OR public.check_is_member_of(t.organization_id));

CREATE OR REPLACE FUNCTION public.compute_score_core(
  p_subtest_id text,
  p_raw_score real,
  p_age_months integer,
  p_gender text DEFAULT 'Mixed'::text,
  p_class_level text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_org_id uuid;
  v_effective_subtest_id text;
  v_subtest record;
  v_norm record;
  v_floor_norm record;
  v_method text;
  v_z real;
  v_standard real;
  v_percentile real;
  v_lowest_raw_min real;
  v_direction text;
  v_warnings text[] := ARRAY[]::text[];
BEGIN
  SELECT om.organization_id INTO v_caller_org_id
  FROM organization_members om
  WHERE om.user_id = auth.uid()
  LIMIT 1;

  v_effective_subtest_id := public.resolve_effective_subtest_id(p_subtest_id, v_caller_org_id);

  SELECT * INTO v_subtest
  FROM public.official_subtests
  WHERE id = v_effective_subtest_id
    AND (organization_id IS NULL OR organization_id = v_caller_org_id)
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'raw', p_raw_score,
      'standard', NULL,
      'percentile', NULL,
      'zScore', NULL,
      'norm_found', false,
      'method', 'NONE',
      'warnings', ARRAY['subtest_not_found']
    );
  END IF;

  IF v_subtest.id <> p_subtest_id AND coalesce(v_subtest.is_override_clone, false) THEN
    v_warnings := array_append(v_warnings, 'direction_override_clone_applied');
  END IF;

  IF lower(coalesce(v_subtest.score_type, 'none')) = 'none' THEN
    v_warnings := array_append(v_warnings, 'score_type_unset');
    RETURN jsonb_build_object(
      'raw', p_raw_score,
      'standard', NULL,
      'percentile', NULL,
      'zScore', NULL,
      'norm_found', false,
      'method', 'NONE',
      'warnings', v_warnings
    );
  END IF;

  v_method := upper(COALESCE(v_subtest.computation_mode, 'LOOKUP'));

  IF v_method = 'PARAMETRIC' THEN
    SELECT * INTO v_norm
    FROM public.official_norms
    WHERE subtest_id = v_effective_subtest_id
      AND (organization_id IS NULL OR organization_id = v_caller_org_id)
      AND age_min_months <= p_age_months
      AND age_max_months >= p_age_months
      AND (gender = p_gender OR gender = 'Mixed')
      AND mean IS NOT NULL
      AND sd IS NOT NULL
      AND sd > 0
    ORDER BY
      CASE WHEN organization_id = v_caller_org_id THEN 0 ELSE 1 END,
      CASE WHEN gender = p_gender THEN 0 ELSE 1 END
    LIMIT 1;

    IF NOT FOUND THEN
      RETURN jsonb_build_object(
        'raw', p_raw_score,
        'standard', NULL,
        'percentile', NULL,
        'zScore', NULL,
        'norm_found', false,
        'method', 'PARAMETRIC',
        'warnings', array_append(v_warnings, 'no_norm')
      );
    END IF;

    v_direction := lower(coalesce(v_subtest.raw_direction, 'auto'));
    IF v_direction NOT IN ('higher_better', 'lower_better') THEN
      v_direction := CASE
        WHEN lower(coalesce(v_subtest.name, '')) ~ '(temps|latence|erreur|fautes|qualite|qualité|duree|durée|delai|délai)'
          THEN 'lower_better'
        ELSE 'higher_better'
      END;
      v_warnings := array_append(v_warnings, 'direction_auto_applied');
    END IF;

    IF v_direction = 'lower_better' THEN
      v_z := (v_norm.mean - p_raw_score) / v_norm.sd;
    ELSE
      v_z := (p_raw_score - v_norm.mean) / v_norm.sd;
    END IF;

    IF v_subtest.score_type = 'standard' THEN
      v_standard := 100 + (v_z * 15);
    ELSIF v_subtest.score_type = 'scaled' THEN
      v_standard := 10 + (v_z * 3);
    ELSIF v_subtest.score_type = 'sten' THEN
      v_standard := 5.5 + (v_z * 2);
    ELSIF v_subtest.score_type IN ('t_score', 't-score') THEN
      v_standard := 50 + (v_z * 10);
    ELSIF v_subtest.score_type = 'percentile' THEN
      v_standard := NULL;
    ELSE
      v_standard := 100 + (v_z * 15);
    END IF;

    v_percentile := (0.5 * (1.0 + erf(v_z / sqrt(2.0)))) * 100;

    RETURN jsonb_build_object(
      'raw', p_raw_score,
      'standard', CASE WHEN v_standard IS NULL THEN NULL ELSE round(v_standard::numeric, 1) END,
      'percentile', round(v_percentile::numeric, 1),
      'zScore', round(v_z::numeric, 2),
      'norm_found', true,
      'method', 'PARAMETRIC',
      'warnings', v_warnings
    );
  END IF;

  IF v_method = 'LOOKUP' THEN
    SELECT * INTO v_norm
    FROM public.official_norms
    WHERE subtest_id = v_effective_subtest_id
      AND (organization_id IS NULL OR organization_id = v_caller_org_id)
      AND age_min_months <= p_age_months
      AND age_max_months >= p_age_months
      AND raw_min <= p_raw_score
      AND raw_max >= p_raw_score
      AND (gender = p_gender OR gender = 'Mixed')
    ORDER BY
      CASE WHEN organization_id = v_caller_org_id THEN 0 ELSE 1 END,
      CASE WHEN gender = p_gender THEN 0 ELSE 1 END
    LIMIT 1;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'raw', p_raw_score,
        'standard', v_norm.standard_score,
        'percentile', v_norm.percentile,
        'zScore', NULL,
        'norm_found', true,
        'method', 'LOOKUP',
        'warnings', v_warnings
      );
    END IF;

    SELECT min(n.raw_min) INTO v_lowest_raw_min
    FROM public.official_norms n
    WHERE n.subtest_id = v_effective_subtest_id
      AND (n.organization_id IS NULL OR n.organization_id = v_caller_org_id)
      AND n.age_min_months <= p_age_months
      AND n.age_max_months >= p_age_months
      AND (n.gender = p_gender OR n.gender = 'Mixed')
      AND n.raw_min IS NOT NULL;

    IF v_lowest_raw_min IS NOT NULL AND p_raw_score < v_lowest_raw_min THEN
      SELECT * INTO v_floor_norm
      FROM public.official_norms
      WHERE subtest_id = v_effective_subtest_id
        AND (organization_id IS NULL OR organization_id = v_caller_org_id)
        AND age_min_months <= p_age_months
        AND age_max_months >= p_age_months
        AND raw_min IS NULL
        AND raw_max IS NULL
        AND (gender = p_gender OR gender = 'Mixed')
      ORDER BY
        CASE WHEN organization_id = v_caller_org_id THEN 0 ELSE 1 END,
        standard_score ASC NULLS LAST
      LIMIT 1;

      IF FOUND THEN
        RETURN jsonb_build_object(
          'raw', p_raw_score,
          'standard', v_floor_norm.standard_score,
          'percentile', v_floor_norm.percentile,
          'zScore', NULL,
          'norm_found', true,
          'method', 'LOOKUP',
          'warnings', array_append(v_warnings, 'floor_score')
        );
      END IF;
    END IF;

    RETURN jsonb_build_object(
      'raw', p_raw_score,
      'standard', NULL,
      'percentile', NULL,
      'zScore', NULL,
      'norm_found', false,
      'method', 'LOOKUP',
      'warnings', array_append(v_warnings, 'no_norm')
    );
  END IF;

  RETURN jsonb_build_object(
    'raw', p_raw_score,
    'standard', NULL,
    'percentile', NULL,
    'zScore', NULL,
    'norm_found', false,
    'method', 'NONE',
    'warnings', array_append(v_warnings, 'unsupported_mode')
  );
END;
$function$;

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
  zero_norm_subtests_count integer,
  low_confidence_score_type_count integer,
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
  ),
  zero_norm_subtests AS (
    SELECT
      s.test_id,
      COUNT(*)::integer AS zero_norm_subtests_count
    FROM public.official_subtests s
    LEFT JOIN (
      SELECT n.subtest_id, COUNT(*) AS norms_count
      FROM public.official_norms n
      GROUP BY n.subtest_id
    ) nc ON nc.subtest_id = s.id
    WHERE COALESCE(nc.norms_count, 0) = 0
    GROUP BY s.test_id
  ),
  subtest_detection_confidence AS (
    SELECT
      s.test_id,
      s.id AS subtest_id,
      CASE
        WHEN COALESCE(s.input_config->>'score_type_detection_confidence', '') ~ '^[0-9]+(\.[0-9]+)?$'
          THEN (s.input_config->>'score_type_detection_confidence')::double precision
        ELSE NULL
      END AS detection_confidence,
      UPPER(COALESCE(s.computation_mode, 'LOOKUP')) AS computation_mode,
      LOWER(COALESCE(s.score_type, 'none')) AS score_type
    FROM public.official_subtests s
  ),
  low_confidence_types AS (
    SELECT
      sc.test_id,
      COUNT(*)::integer AS low_confidence_score_type_count
    FROM subtest_detection_confidence sc
    WHERE sc.score_type = 'none'
      OR (
        sc.detection_confidence IS NOT NULL
        AND (
          (sc.computation_mode = 'PARAMETRIC' AND sc.detection_confidence < 0.85)
          OR (sc.computation_mode <> 'PARAMETRIC' AND sc.detection_confidence < 0.80)
        )
      )
    GROUP BY sc.test_id
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
    COALESCE(zn.zero_norm_subtests_count, 0) AS zero_norm_subtests_count,
    COALESCE(lc.low_confidence_score_type_count, 0) AS low_confidence_score_type_count,
    (
      COALESCE(mt.missing_ambiguous_tags, 0)
      + COALESCE(ds.duplicate_subtest_excess, 0)
      + COALESCE(dn.duplicate_norm_excess, 0)
      + COALESCE(qf.quality_flag_count, 0)
      + COALESCE(zn.zero_norm_subtests_count, 0)
      + COALESCE(lc.low_confidence_score_type_count, 0)
    )::integer AS total_issues
  FROM test_base tb
  LEFT JOIN missing_tags mt ON mt.test_id = tb.test_id
  LEFT JOIN duplicate_subtests ds ON ds.test_id = tb.test_id
  LEFT JOIN duplicate_norms dn ON dn.test_id = tb.test_id
  LEFT JOIN quality_flags qf ON qf.test_id = tb.test_id
  LEFT JOIN zero_norm_subtests zn ON zn.test_id = tb.test_id
  LEFT JOIN low_confidence_types lc ON lc.test_id = tb.test_id
  WHERE (
    COALESCE(mt.missing_ambiguous_tags, 0)
    + COALESCE(ds.duplicate_subtest_excess, 0)
    + COALESCE(dn.duplicate_norm_excess, 0)
    + COALESCE(qf.quality_flag_count, 0)
    + COALESCE(zn.zero_norm_subtests_count, 0)
    + COALESCE(lc.low_confidence_score_type_count, 0)
  ) > 0
  ORDER BY total_issues DESC, tb.test_name ASC;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.resolve_effective_subtest_id(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_create_or_update_subtest_override_clone(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_norms_status(text[], integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.compute_score_core(text, real, integer, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_issue_backlog() TO authenticated;

GRANT SELECT ON TABLE public.view_unified_catalog TO authenticated;
GRANT SELECT ON TABLE public.view_unified_subtests TO authenticated;
