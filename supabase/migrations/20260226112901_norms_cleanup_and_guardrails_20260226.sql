-- Cleanup existing norm inconsistencies and harden ingest/lookup behavior.
-- Goals:
-- 1) remove malformed rows currently poisoning conversions
-- 2) prevent exact duplicate rows at DB level
-- 3) make LOOKUP selection deterministic when ranges overlap (threshold-style tables)
-- 4) harden admin bundle save path to only persist usable norms

BEGIN;

-- 1) Cleanup existing malformed rows

-- Remove exact duplicates (same semantic key), keep first row.
WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY
        subtest_id,
        organization_id,
        age_min_months,
        age_max_months,
        gender,
        raw_min,
        raw_max,
        mean,
        sd,
        standard_score,
        percentile
      ORDER BY id
    ) AS rn
  FROM public.official_norms
)
DELETE FROM public.official_norms n
USING ranked r
WHERE n.id = r.id
  AND r.rn > 1;

-- Drop rows with missing/invalid age span.
DELETE FROM public.official_norms
WHERE age_min_months IS NULL
   OR age_max_months IS NULL
   OR age_min_months > age_max_months;

-- Drop rows with incoherent raw interval shape.
DELETE FROM public.official_norms
WHERE (raw_min IS NULL) <> (raw_max IS NULL)
   OR (raw_min IS NOT NULL AND raw_max IS NOT NULL AND raw_min > raw_max);

-- Drop impossible percentile values.
DELETE FROM public.official_norms
WHERE percentile IS NOT NULL
  AND (percentile < 0 OR percentile > 100);

-- Drop invalid parametric stats.
DELETE FROM public.official_norms
WHERE (mean IS NULL AND sd IS NOT NULL)
   OR (mean IS NOT NULL AND (sd IS NULL OR sd <= 0));

-- For numeric LOOKUP subtests, rows without any target score are unusable and
-- create false "has_norms" positives in Step2.
DELETE FROM public.official_norms n
USING public.official_subtests s
WHERE s.id = n.subtest_id
  AND upper(coalesce(s.computation_mode, 'LOOKUP')) = 'LOOKUP'
  AND lower(coalesce(s.input_model, 'numeric_4mode')) = 'numeric_4mode'
  AND n.standard_score IS NULL
  AND n.percentile IS NULL
  AND n.mean IS NULL
  AND n.sd IS NULL;

-- 2) DB guardrails (column-level)

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'official_norms_age_bounds_chk'
      AND conrelid = 'public.official_norms'::regclass
  ) THEN
    ALTER TABLE public.official_norms
      ADD CONSTRAINT official_norms_age_bounds_chk
      CHECK (
        age_min_months IS NOT NULL
        AND age_max_months IS NOT NULL
        AND age_min_months <= age_max_months
      );
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'official_norms_raw_bounds_chk'
      AND conrelid = 'public.official_norms'::regclass
  ) THEN
    ALTER TABLE public.official_norms
      ADD CONSTRAINT official_norms_raw_bounds_chk
      CHECK (
        (raw_min IS NULL AND raw_max IS NULL)
        OR (raw_min IS NOT NULL AND raw_max IS NOT NULL AND raw_min <= raw_max)
      );
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'official_norms_percentile_range_chk'
      AND conrelid = 'public.official_norms'::regclass
  ) THEN
    ALTER TABLE public.official_norms
      ADD CONSTRAINT official_norms_percentile_range_chk
      CHECK (
        percentile IS NULL OR (percentile >= 0 AND percentile <= 100)
      );
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'official_norms_mean_sd_consistency_chk'
      AND conrelid = 'public.official_norms'::regclass
  ) THEN
    ALTER TABLE public.official_norms
      ADD CONSTRAINT official_norms_mean_sd_consistency_chk
      CHECK (
        (mean IS NULL AND sd IS NULL)
        OR (mean IS NOT NULL AND sd IS NOT NULL AND sd > 0)
      );
  END IF;
END;
$$;

-- Block future exact duplicates (including NULL-equal keys).
CREATE UNIQUE INDEX IF NOT EXISTS official_norms_exact_unique_idx
  ON public.official_norms (
    subtest_id,
    organization_id,
    age_min_months,
    age_max_months,
    gender,
    raw_min,
    raw_max,
    mean,
    sd,
    standard_score,
    percentile
  ) NULLS NOT DISTINCT;

-- 3) Deterministic LOOKUP selection in compute_score_core
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
  v_scale_mean real;
  v_scale_sd real;
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

  -- Resolve direction once (used by both PARAMETRIC and LOOKUP tie-breaks).
  v_direction := lower(coalesce(v_subtest.raw_direction, 'auto'));
  IF v_direction NOT IN ('higher_better', 'lower_better') THEN
    v_direction := CASE
      WHEN lower(coalesce(v_subtest.name, '')) ~ '(temps|latence|erreur|fautes|qualite|duree|delai)'
        THEN 'lower_better'
      ELSE 'higher_better'
    END;
    v_warnings := array_append(v_warnings, 'direction_auto_applied');
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
    ELSIF v_subtest.score_type = 'stanine' THEN
      v_standard := 5 + (v_z * 2);
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
    FROM public.official_norms n
    WHERE n.subtest_id = v_effective_subtest_id
      AND (n.organization_id IS NULL OR n.organization_id = v_caller_org_id)
      AND n.age_min_months <= p_age_months
      AND n.age_max_months >= p_age_months
      AND n.raw_min <= p_raw_score
      AND n.raw_max >= p_raw_score
      AND (n.gender = p_gender OR n.gender = 'Mixed')
    ORDER BY
      CASE WHEN n.organization_id = v_caller_org_id THEN 0 ELSE 1 END,
      CASE WHEN n.gender = p_gender THEN 0 ELSE 1 END,
      CASE WHEN n.raw_min IS NULL OR n.raw_max IS NULL THEN 1 ELSE 0 END,
      CASE
        WHEN n.raw_min IS NOT NULL AND n.raw_max IS NOT NULL THEN (n.raw_max - n.raw_min)
        ELSE NULL
      END ASC NULLS LAST,
      CASE WHEN v_direction = 'lower_better' THEN n.raw_min ELSE NULL END DESC NULLS LAST,
      CASE WHEN v_direction = 'higher_better' THEN n.raw_max ELSE NULL END ASC NULLS LAST,
      n.id ASC
    LIMIT 1;

    IF FOUND THEN
      IF v_norm.standard_score IS NOT NULL AND v_subtest.score_type IS NOT NULL THEN
        IF v_subtest.score_type = 'standard' THEN
          v_scale_mean := 100.0; v_scale_sd := 15.0;
        ELSIF v_subtest.score_type = 'scaled' THEN
          v_scale_mean := 10.0; v_scale_sd := 3.0;
        ELSIF v_subtest.score_type = 'sten' THEN
          v_scale_mean := 5.5; v_scale_sd := 2.0;
        ELSIF v_subtest.score_type = 'stanine' THEN
          v_scale_mean := 5.0; v_scale_sd := 2.0;
        ELSIF v_subtest.score_type IN ('t_score', 't-score') THEN
          v_scale_mean := 50.0; v_scale_sd := 10.0;
        ELSE
          v_scale_mean := NULL; v_scale_sd := NULL;
        END IF;

        IF v_scale_mean IS NOT NULL AND v_scale_sd IS NOT NULL THEN
          v_z := (v_norm.standard_score - v_scale_mean) / v_scale_sd;
        END IF;
      END IF;

      RETURN jsonb_build_object(
        'raw', p_raw_score,
        'standard', v_norm.standard_score,
        'percentile', v_norm.percentile,
        'zScore', CASE WHEN v_z IS NULL THEN NULL ELSE round(v_z::numeric, 2) END,
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
      FROM public.official_norms n
      WHERE n.subtest_id = v_effective_subtest_id
        AND (n.organization_id IS NULL OR n.organization_id = v_caller_org_id)
        AND n.age_min_months <= p_age_months
        AND n.age_max_months >= p_age_months
        AND n.raw_min IS NULL
        AND n.raw_max IS NULL
        AND (n.gender = p_gender OR n.gender = 'Mixed')
      ORDER BY
        CASE WHEN n.organization_id = v_caller_org_id THEN 0 ELSE 1 END,
        CASE
          WHEN v_direction = 'lower_better' THEN n.standard_score
          ELSE NULL
        END DESC NULLS LAST,
        CASE
          WHEN v_direction = 'higher_better' THEN n.standard_score
          ELSE NULL
        END ASC NULLS LAST,
        n.id ASC
      LIMIT 1;

      IF FOUND THEN
        IF v_floor_norm.standard_score IS NOT NULL AND v_subtest.score_type IS NOT NULL THEN
          IF v_subtest.score_type = 'standard' THEN
            v_scale_mean := 100.0; v_scale_sd := 15.0;
          ELSIF v_subtest.score_type = 'scaled' THEN
            v_scale_mean := 10.0; v_scale_sd := 3.0;
          ELSIF v_subtest.score_type = 'sten' THEN
            v_scale_mean := 5.5; v_scale_sd := 2.0;
          ELSIF v_subtest.score_type = 'stanine' THEN
            v_scale_mean := 5.0; v_scale_sd := 2.0;
          ELSIF v_subtest.score_type IN ('t_score', 't-score') THEN
            v_scale_mean := 50.0; v_scale_sd := 10.0;
          ELSE
            v_scale_mean := NULL; v_scale_sd := NULL;
          END IF;

          IF v_scale_mean IS NOT NULL AND v_scale_sd IS NOT NULL THEN
            v_z := (v_floor_norm.standard_score - v_scale_mean) / v_scale_sd;
          END IF;
        END IF;

        RETURN jsonb_build_object(
          'raw', p_raw_score,
          'standard', v_floor_norm.standard_score,
          'percentile', v_floor_norm.percentile,
          'zScore', CASE WHEN v_z IS NULL THEN NULL ELSE round(v_z::numeric, 2) END,
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

-- 4) Harden admin bundle writer against malformed rows and duplicates.
CREATE OR REPLACE FUNCTION public.admin_save_test_bundle(p_payload jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_test jsonb;
  v_test_id text;
  v_org_id uuid;
  v_subtests jsonb;
  v_norms jsonb;
  v_sub jsonb;
  v_sub_name text;
  v_sub_abbreviation text;
BEGIN
  IF NOT check_is_admin() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  v_test := COALESCE(p_payload->'test', '{}'::jsonb);
  v_test_id := COALESCE(v_test->>'id', '');

  IF v_test_id = '' THEN
    RAISE EXCEPTION 'Test id missing';
  END IF;

  v_org_id := NULL;
  IF (v_test ? 'organization_id') THEN
    v_org_id := NULLIF(v_test->>'organization_id', '')::uuid;
  END IF;

  INSERT INTO official_tests (id, name, category_id, version, author, organization_id)
  VALUES (
    v_test_id,
    COALESCE(v_test->>'name', ''),
    COALESCE(v_test->>'category_id', ''),
    COALESCE(v_test->>'version', '1.0'),
    COALESCE(v_test->>'author', ''),
    v_org_id
  )
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    category_id = EXCLUDED.category_id,
    version = EXCLUDED.version,
    author = EXCLUDED.author,
    organization_id = EXCLUDED.organization_id;

  v_subtests := COALESCE(p_payload->'subtests', '[]'::jsonb);
  FOR v_sub IN SELECT * FROM jsonb_array_elements(v_subtests)
  LOOP
    IF COALESCE(v_sub->>'id', '') = '' THEN
      RAISE EXCEPTION 'Subtest id missing';
    END IF;

    v_sub_name := COALESCE(v_sub->>'name', '');
    v_sub_abbreviation := NULLIF(
      upper(regexp_replace(trim(COALESCE(v_sub->>'abbreviation', '')), '\s+', ' ', 'g')),
      ''
    );

    IF v_sub_abbreviation IS NULL
       AND v_sub_name ~ '\(([A-Z0-9][A-Z0-9&/ -]{0,19})\)\s*$' THEN
      v_sub_abbreviation := upper(regexp_replace(trim((regexp_match(v_sub_name, '\(([A-Z0-9][A-Z0-9&/ -]{0,19})\)\s*$'))[1]), '\s+', ' ', 'g'));
      v_sub_name := trim(regexp_replace(v_sub_name, '\s*\(([A-Z0-9][A-Z0-9&/ -]{0,19})\)\s*$', ''));
    END IF;

    INSERT INTO official_subtests (
      id,
      test_id,
      name,
      abbreviation,
      unit,
      score_type,
      computation_mode,
      input_model,
      input_config,
      organization_id
    )
    VALUES (
      v_sub->>'id',
      v_test_id,
      v_sub_name,
      v_sub_abbreviation,
      COALESCE(v_sub->>'unit', 'pts'),
      COALESCE(NULLIF(v_sub->>'score_type', ''), 'none'),
      COALESCE(NULLIF(v_sub->>'computation_mode', ''), 'LOOKUP'),
      COALESCE(NULLIF(v_sub->>'input_model', ''), 'numeric_4mode'),
      COALESCE(v_sub->'input_config', '{}'::jsonb),
      COALESCE(NULLIF(v_sub->>'organization_id', '')::uuid, v_org_id)
    )
    ON CONFLICT (id) DO UPDATE SET
      test_id = EXCLUDED.test_id,
      name = EXCLUDED.name,
      abbreviation = EXCLUDED.abbreviation,
      unit = EXCLUDED.unit,
      score_type = EXCLUDED.score_type,
      computation_mode = EXCLUDED.computation_mode,
      input_model = EXCLUDED.input_model,
      input_config = EXCLUDED.input_config,
      organization_id = EXCLUDED.organization_id;
  END LOOP;

  DELETE FROM official_norms
  WHERE subtest_id IN (
    SELECT (s->>'id')::text
    FROM jsonb_array_elements(v_subtests) s
    WHERE COALESCE(s->>'id', '') <> ''
  );

  v_norms := COALESCE(p_payload->'norms', '[]'::jsonb);
  IF jsonb_array_length(v_norms) > 0 THEN
    WITH raw_norms AS (
      SELECT
        n->>'subtest_id' AS subtest_id,
        COALESCE(NULLIF(n->>'organization_id', '')::uuid, v_org_id) AS organization_id,
        NULLIF(n->>'age_min_months', '')::integer AS age_min_months,
        NULLIF(n->>'age_max_months', '')::integer AS age_max_months,
        COALESCE(NULLIF(n->>'gender', ''), 'Mixed') AS gender,
        NULLIF(n->>'raw_min', '')::real AS raw_min,
        NULLIF(n->>'raw_max', '')::real AS raw_max,
        NULLIF(n->>'mean', '')::real AS mean,
        NULLIF(n->>'sd', '')::real AS sd,
        NULLIF(n->>'standard_score', '')::real AS standard_score,
        NULLIF(n->>'percentile', '')::real AS percentile
      FROM jsonb_array_elements(v_norms) n
      WHERE COALESCE(n->>'subtest_id', '') <> ''
        AND (n->>'subtest_id') IN (
          SELECT (s->>'id')::text
          FROM jsonb_array_elements(v_subtests) s
          WHERE COALESCE(s->>'id', '') <> ''
        )
    ),
    enriched AS (
      SELECT
        r.subtest_id,
        r.organization_id,
        r.age_min_months,
        r.age_max_months,
        r.gender,
        r.raw_min,
        r.raw_max,
        r.mean,
        r.sd,
        r.standard_score,
        r.percentile,
        upper(COALESCE(s.computation_mode, 'LOOKUP')) AS computation_mode,
        lower(COALESCE(s.input_model, 'numeric_4mode')) AS input_model
      FROM raw_norms r
      JOIN official_subtests s ON s.id = r.subtest_id
    ),
    valid AS (
      SELECT DISTINCT
        e.subtest_id,
        e.organization_id,
        e.age_min_months,
        e.age_max_months,
        e.gender,
        e.raw_min,
        e.raw_max,
        e.mean,
        e.sd,
        e.standard_score,
        e.percentile
      FROM enriched e
      WHERE e.age_min_months IS NOT NULL
        AND e.age_max_months IS NOT NULL
        AND e.age_min_months <= e.age_max_months
        AND (
          (e.raw_min IS NULL AND e.raw_max IS NULL)
          OR (e.raw_min IS NOT NULL AND e.raw_max IS NOT NULL AND e.raw_min <= e.raw_max)
        )
        AND (e.percentile IS NULL OR (e.percentile >= 0 AND e.percentile <= 100))
        AND (
          (e.mean IS NULL AND e.sd IS NULL)
          OR (e.mean IS NOT NULL AND e.sd IS NOT NULL AND e.sd > 0)
        )
        AND (
          (e.computation_mode = 'PARAMETRIC' AND e.mean IS NOT NULL AND e.sd IS NOT NULL)
          OR
          (e.computation_mode <> 'PARAMETRIC' AND (
            e.input_model <> 'numeric_4mode'
            OR e.standard_score IS NOT NULL
            OR e.percentile IS NOT NULL
          ))
        )
    )
    INSERT INTO official_norms (
      subtest_id,
      organization_id,
      age_min_months,
      age_max_months,
      gender,
      raw_min,
      raw_max,
      mean,
      sd,
      standard_score,
      percentile
    )
    SELECT
      subtest_id,
      organization_id,
      age_min_months,
      age_max_months,
      gender,
      raw_min,
      raw_max,
      mean,
      sd,
      standard_score,
      percentile
    FROM valid
    ON CONFLICT DO NOTHING;
  END IF;
END;
$function$;

COMMIT;
