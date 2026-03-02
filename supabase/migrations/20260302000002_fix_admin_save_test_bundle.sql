-- =============================================================================
-- Migration: Fix admin_save_test_bundle RPC
-- Date: 2026-03-02
--
-- Issues fixed:
--   1. Subtest upsert missing 5 columns:
--      raw_direction, source_subtest_id, is_override_clone,
--      always_show_raw, raw_display_decimals
--   2. Norm handling was destructive: DELETE all norms for ALL subtests
--      in the bundle, even if no norms were provided in the payload.
--      Fixed: only delete norms for subtests that have new norms in payload.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.admin_save_test_bundle(p_payload jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_test                jsonb;
  v_test_id             text;
  v_org_id              uuid;
  v_subtests            jsonb;
  v_norms               jsonb;
  v_sub                 jsonb;
  v_sub_name            text;
  v_sub_abbreviation    text;
BEGIN
  IF NOT check_is_admin() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  v_test    := COALESCE(p_payload->'test', '{}'::jsonb);
  v_test_id := COALESCE(v_test->>'id', '');

  IF v_test_id = '' THEN
    RAISE EXCEPTION 'Test id missing';
  END IF;

  v_org_id := NULL;
  IF (v_test ? 'organization_id') THEN
    v_org_id := NULLIF(v_test->>'organization_id', '')::uuid;
  END IF;

  -- Upsert test record
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
    name            = EXCLUDED.name,
    category_id     = EXCLUDED.category_id,
    version         = EXCLUDED.version,
    author          = EXCLUDED.author,
    organization_id = EXCLUDED.organization_id;

  -- Upsert all subtests — now includes ALL relevant columns
  v_subtests := COALESCE(p_payload->'subtests', '[]'::jsonb);
  FOR v_sub IN SELECT * FROM jsonb_array_elements(v_subtests)
  LOOP
    IF COALESCE(v_sub->>'id', '') = '' THEN
      RAISE EXCEPTION 'Subtest id missing';
    END IF;

    v_sub_name := COALESCE(v_sub->>'name', '');

    -- Auto-extract abbreviation from parenthetical suffix e.g. "Foo (GEC)"
    v_sub_abbreviation := NULLIF(
      upper(regexp_replace(trim(COALESCE(v_sub->>'abbreviation', '')), '\s+', ' ', 'g')),
      ''
    );
    IF v_sub_abbreviation IS NULL
       AND v_sub_name ~ '\(([A-Z0-9][A-Z0-9&/ -]{0,19})\)\s*$' THEN
      v_sub_abbreviation := upper(regexp_replace(
        trim((regexp_match(v_sub_name, '\(([A-Z0-9][A-Z0-9&/ -]{0,19})\)\s*$'))[1]),
        '\s+', ' ', 'g'
      ));
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
      organization_id,
      raw_direction,
      source_subtest_id,
      is_override_clone,
      always_show_raw,
      raw_display_decimals
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
      COALESCE(NULLIF(v_sub->>'organization_id', '')::uuid, v_org_id),
      COALESCE(NULLIF(v_sub->>'raw_direction', ''), 'auto'),
      NULLIF(v_sub->>'source_subtest_id', ''),
      COALESCE((v_sub->>'is_override_clone')::boolean, false),
      COALESCE((v_sub->>'always_show_raw')::boolean, false),
      NULLIF(v_sub->>'raw_display_decimals', '')::integer
    )
    ON CONFLICT (id) DO UPDATE SET
      test_id              = EXCLUDED.test_id,
      name                 = EXCLUDED.name,
      abbreviation         = EXCLUDED.abbreviation,
      unit                 = EXCLUDED.unit,
      score_type           = EXCLUDED.score_type,
      computation_mode     = EXCLUDED.computation_mode,
      input_model          = EXCLUDED.input_model,
      input_config         = EXCLUDED.input_config,
      organization_id      = EXCLUDED.organization_id,
      raw_direction        = EXCLUDED.raw_direction,
      source_subtest_id    = EXCLUDED.source_subtest_id,
      is_override_clone    = EXCLUDED.is_override_clone,
      always_show_raw      = EXCLUDED.always_show_raw,
      raw_display_decimals = EXCLUDED.raw_display_decimals;
  END LOOP;

  -- Safe norm handling:
  -- Only delete norms for subtests that actually have NEW norms in the payload.
  -- Subtests with no norms in the payload keep their existing norm data.
  v_norms := COALESCE(p_payload->'norms', '[]'::jsonb);

  IF jsonb_array_length(v_norms) > 0 THEN
    -- Delete existing norms only for subtests being re-submitted
    DELETE FROM official_norms
    WHERE subtest_id IN (
      SELECT DISTINCT (n->>'subtest_id')::text
      FROM jsonb_array_elements(v_norms) n
      WHERE COALESCE(n->>'subtest_id', '') <> ''
        AND (n->>'subtest_id') IN (
          SELECT s->>'id' FROM jsonb_array_elements(v_subtests) s
          WHERE COALESCE(s->>'id', '') <> ''
        )
    );

    -- Insert norms with validation
    WITH raw_norms AS (
      SELECT
        n->>'subtest_id'                                      AS subtest_id,
        COALESCE(NULLIF(n->>'organization_id', '')::uuid, v_org_id) AS organization_id,
        NULLIF(n->>'age_min_months', '')::integer             AS age_min_months,
        NULLIF(n->>'age_max_months', '')::integer             AS age_max_months,
        COALESCE(NULLIF(n->>'gender', ''), 'Mixed')           AS gender,
        NULLIF(n->>'raw_min', '')::real                       AS raw_min,
        NULLIF(n->>'raw_max', '')::real                       AS raw_max,
        NULLIF(n->>'mean', '')::real                          AS mean,
        NULLIF(n->>'sd', '')::real                            AS sd,
        NULLIF(n->>'standard_score', '')::real                AS standard_score,
        NULLIF(n->>'percentile', '')::real                    AS percentile
      FROM jsonb_array_elements(v_norms) n
      WHERE COALESCE(n->>'subtest_id', '') <> ''
        AND (n->>'subtest_id') IN (
          SELECT s->>'id' FROM jsonb_array_elements(v_subtests) s
          WHERE COALESCE(s->>'id', '') <> ''
        )
    ),
    valid AS (
      SELECT DISTINCT
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
        r.percentile
      FROM raw_norms r
      -- Join to verify subtest exists (also gets computation_mode for validation)
      JOIN official_subtests s ON s.id = r.subtest_id
      WHERE r.age_min_months IS NOT NULL
        AND r.age_max_months IS NOT NULL
        AND r.age_min_months <= r.age_max_months
        AND (
          r.raw_min IS NULL AND r.raw_max IS NULL
          OR (r.raw_min IS NOT NULL AND r.raw_max IS NOT NULL AND r.raw_min <= r.raw_max)
        )
        AND (r.percentile IS NULL OR (r.percentile >= 0 AND r.percentile <= 100))
        AND (
          r.mean IS NULL AND r.sd IS NULL
          OR (r.mean IS NOT NULL AND r.sd IS NOT NULL AND r.sd > 0)
        )
        -- At least one score or norm type must be present
        AND (
          r.mean IS NOT NULL          -- PARAMETRIC
          OR r.standard_score IS NOT NULL  -- LOOKUP with NS
          OR r.percentile IS NOT NULL      -- LOOKUP with percentile
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
$$;
