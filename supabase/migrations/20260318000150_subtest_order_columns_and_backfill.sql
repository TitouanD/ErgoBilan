-- =============================================================================
-- Migration: Add explicit subtest ordering columns + deterministic backfill
-- Date: 2026-03-18
-- Goal: Make subtest order configurable in DB (no static frontend list)
-- =============================================================================

-- 1) Schema: explicit ordering columns on official_subtests
ALTER TABLE public.official_subtests
  ADD COLUMN IF NOT EXISTS display_group_order integer,
  ADD COLUMN IF NOT EXISTS display_order integer;

-- 2) Backfill display_group_order from existing config when available
UPDATE public.official_subtests
SET display_group_order = COALESCE(
  display_group_order,
  CASE
    WHEN jsonb_typeof(input_config) = 'object'
      AND (input_config ? 'groupOrder')
      AND (input_config->>'groupOrder') ~ '^\d+$'
    THEN (input_config->>'groupOrder')::int
    ELSE NULL
  END
)
WHERE display_group_order IS NULL;

-- 3) Backfill display_order deterministically for ALL rows without explicit order
-- Priority:
--   a) input_config.orderIndex
--   b) number parsed from name ("Subtest 3", "3.")
--   c) alphabetical stable fallback within test
WITH base AS (
  SELECT
    st.id,
    st.test_id,
    st.name,
    COALESCE(
      st.display_group_order,
      CASE
        WHEN jsonb_typeof(st.input_config) = 'object'
          AND (st.input_config ? 'groupOrder')
          AND (st.input_config->>'groupOrder') ~ '^\d+$'
        THEN (st.input_config->>'groupOrder')::int
        ELSE 900
      END
    ) AS resolved_group_order,
    COALESCE(
      CASE
        WHEN jsonb_typeof(st.input_config) = 'object'
          AND (st.input_config ? 'orderIndex')
          AND (st.input_config->>'orderIndex') ~ '^\d+$'
        THEN (st.input_config->>'orderIndex')::int
        ELSE NULL
      END,
      CASE
        WHEN regexp_match(lower(st.name), '(?:subtest|sous[- ]?test)\s*(\d{1,3})') IS NOT NULL
        THEN ((regexp_match(lower(st.name), '(?:subtest|sous[- ]?test)\s*(\d{1,3})'))[1])::int
        WHEN regexp_match(st.name, '^(\d{1,3})[\).\-\s]') IS NOT NULL
        THEN ((regexp_match(st.name, '^(\d{1,3})[\).\-\s]'))[1])::int
        ELSE 999
      END
    ) AS resolved_item_order
  FROM public.official_subtests st
), ranked AS (
  SELECT
    b.id,
    ROW_NUMBER() OVER (
      PARTITION BY b.test_id
      ORDER BY b.resolved_group_order, b.resolved_item_order, lower(b.name), b.id
    ) AS computed_display_order
  FROM base b
)
UPDATE public.official_subtests st
SET display_order = r.computed_display_order
FROM ranked r
WHERE st.id = r.id
  AND st.display_order IS NULL;

-- 4) Hard guardrail: ensure display_order filled for all rows
WITH ranked_fallback AS (
  SELECT
    st.id,
    ROW_NUMBER() OVER (PARTITION BY st.test_id ORDER BY lower(st.name), st.id) AS fallback_order
  FROM public.official_subtests st
  WHERE st.display_order IS NULL
)
UPDATE public.official_subtests st
SET display_order = rf.fallback_order
FROM ranked_fallback rf
WHERE st.id = rf.id;

-- 5) Keep compatibility: expose new columns in unified subtests view
CREATE OR REPLACE VIEW public.view_unified_subtests AS
 WITH caller AS (
         SELECT om.organization_id AS caller_org_id
           FROM organization_members om
          WHERE om.user_id = auth.uid()
         LIMIT 1
        ), visible_subtests AS (
         SELECT s_1.id,
            s_1.test_id,
            s_1.name,
            s_1.unit,
            s_1.score_type,
            s_1.computation_mode,
            s_1.created_at,
            s_1.organization_id,
            s_1.input_model,
            s_1.input_config,
            s_1.abbreviation,
            s_1.raw_direction,
            s_1.source_subtest_id,
            s_1.is_override_clone,
            s_1.always_show_raw,
            s_1.raw_display_decimals,
            s_1.display_group_order,
            s_1.display_order,
            t.organization_id AS test_organization_id,
            ( SELECT caller.caller_org_id
                   FROM caller) AS caller_org_id
           FROM official_subtests s_1
             JOIN official_tests t ON t.id = s_1.test_id
          WHERE is_current_user_onboarded() AND (t.organization_id IS NULL OR check_is_member_of(t.organization_id)) AND (s_1.organization_id IS NULL OR check_is_member_of(s_1.organization_id))
        )
 SELECT id,
    test_id,
    name,
    unit,
    score_type,
    computation_mode,
    input_model,
    input_config,
    abbreviation,
    raw_direction,
    source_subtest_id,
    is_override_clone,
    always_show_raw,
    raw_display_decimals,
    display_group_order,
    display_order
   FROM visible_subtests s
  WHERE organization_id = caller_org_id OR organization_id IS NULL AND NOT (EXISTS ( SELECT 1
           FROM visible_subtests c
          WHERE c.organization_id = s.caller_org_id AND c.is_override_clone = true AND c.source_subtest_id = s.id));

-- 6) Optional helper index for stable fetch + admin operations
CREATE INDEX IF NOT EXISTS idx_official_subtests_test_display_order
  ON public.official_subtests (test_id, display_group_order, display_order, name);
