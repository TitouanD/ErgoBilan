-- ============================================================
-- Step 1a: Drop + recreate view_unified_subtests
-- ============================================================
DROP VIEW IF EXISTS public.view_unified_subtests;

CREATE VIEW public.view_unified_subtests AS
WITH caller AS (
    SELECT om.organization_id AS caller_org_id
    FROM organization_members om
    WHERE om.user_id = auth.uid()
    LIMIT 1
), visible_subtests AS (
    SELECT
        s_1.id,
        s_1.test_id,
        s_1.name,
        s_1.unit,
        s_1.score_type,
        s_1.computation_mode,
        s_1.organization_id,
        s_1.input_model,
        s_1.input_config,
        s_1.display_group_order,
        s_1.display_order,
        (SELECT caller.caller_org_id FROM caller) AS caller_org_id
    FROM official_subtests s_1
    JOIN official_tests t ON t.id = s_1.test_id
    WHERE
        is_current_user_onboarded()
        AND (t.organization_id IS NULL OR check_is_member_of(t.organization_id))
        AND (s_1.organization_id IS NULL OR check_is_member_of(s_1.organization_id))
)
SELECT
    id,
    test_id,
    name,
    unit,
    score_type,
    computation_mode,
    input_model,
    input_config,
    display_group_order,
    display_order
FROM visible_subtests s
WHERE organization_id = caller_org_id OR organization_id IS NULL;

GRANT SELECT ON public.view_unified_subtests TO authenticated;

-- ============================================================
-- Step 1b: Drop + recreate view_unified_catalog
--          (had same dead is_override_clone / source_subtest_id
--           filter in the subtests_count subquery)
-- ============================================================
DROP VIEW IF EXISTS public.view_unified_catalog;

CREATE VIEW public.view_unified_catalog AS
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
            FROM organization_members om
            WHERE om.user_id = auth.uid()
            LIMIT 1
        )
        SELECT count(*)
        FROM official_subtests s
        WHERE
            is_current_user_onboarded()
            AND s.test_id = t.id
            AND (s.organization_id IS NULL OR check_is_member_of(s.organization_id))
            AND (
                s.organization_id = (SELECT caller.caller_org_id FROM caller)
                OR s.organization_id IS NULL
            )
    ) AS subtests_count
FROM official_tests t
JOIN official_categories c ON c.id = t.category_id
WHERE
    is_current_user_onboarded()
    AND (t.organization_id IS NULL OR check_is_member_of(t.organization_id));

GRANT SELECT ON public.view_unified_catalog TO authenticated;

-- ============================================================
-- Step 2: Recreate admin_save_test_detail without dead columns
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_save_test_detail(
    p_test_id text,
    p_test_data jsonb,
    p_subtests jsonb,
    p_deleted_subtest_ids text[] DEFAULT '{}'::text[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_sub jsonb;
BEGIN
  IF NOT check_is_admin() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  UPDATE official_tests
  SET
    name        = p_test_data->>'name',
    category_id = p_test_data->>'category_id',
    author      = p_test_data->>'author',
    version     = p_test_data->>'version'
  WHERE id = p_test_id;

  IF array_length(p_deleted_subtest_ids, 1) > 0 THEN
    DELETE FROM official_subtests WHERE id = ANY(p_deleted_subtest_ids);
  END IF;

  IF p_subtests IS NOT NULL AND jsonb_array_length(p_subtests) > 0 THEN
    FOR v_sub IN SELECT * FROM jsonb_array_elements(p_subtests) LOOP
      INSERT INTO official_subtests (
        id, test_id, name, unit, score_type, computation_mode,
        input_model, input_config, display_order, display_group_order, organization_id
      ) VALUES (
        v_sub->>'id',
        v_sub->>'test_id',
        v_sub->>'name',
        v_sub->>'unit',
        COALESCE(v_sub->>'score_type', 'standard'),
        COALESCE(v_sub->>'computation_mode', 'NONE'),
        v_sub->>'input_model',
        v_sub->'input_config',
        (v_sub->>'display_order')::integer,
        (v_sub->>'display_group_order')::integer,
        (v_sub->>'organization_id')::uuid
      )
      ON CONFLICT (id) DO UPDATE SET
        name                = EXCLUDED.name,
        unit                = EXCLUDED.unit,
        score_type          = EXCLUDED.score_type,
        computation_mode    = EXCLUDED.computation_mode,
        input_model         = EXCLUDED.input_model,
        input_config        = EXCLUDED.input_config,
        display_order       = EXCLUDED.display_order,
        display_group_order = EXCLUDED.display_group_order;
    END LOOP;
  END IF;
END;
$$;

-- ============================================================
-- Step 3: Recreate practitioner_save_custom_test without
--         abbreviation (column being dropped)
-- ============================================================
CREATE OR REPLACE FUNCTION public.practitioner_save_custom_test(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_org_id     uuid;
    v_test_id    text;
    v_test       jsonb;
    v_subtests   jsonb;
    v_sub        jsonb;
    v_sub_idx    integer := 0;
    v_category   text;
BEGIN
    SELECT organization_id INTO v_org_id
    FROM public.organization_members
    WHERE user_id = auth.uid()
    LIMIT 1;

    IF v_org_id IS NULL THEN
        RAISE EXCEPTION 'Aucune organisation trouvee pour cet utilisateur';
    END IF;

    v_test    := COALESCE(payload->'test', '{}'::jsonb);
    v_test_id := gen_random_uuid()::text;

    SELECT id INTO v_category
    FROM public.official_categories
    WHERE id = NULLIF(TRIM(v_test->>'category_id'), '')
    LIMIT 1;
    v_category := COALESCE(v_category, 'autre');

    INSERT INTO public.official_tests (id, name, category_id, organization_id, version, author)
    VALUES (
        v_test_id,
        COALESCE(NULLIF(TRIM(v_test->>'name'), ''), 'Test personnalise'),
        v_category,
        v_org_id,
        '1.0',
        'practitioner'
    );

    v_subtests := COALESCE(payload->'subtests', '[]'::jsonb);
    FOR v_sub IN SELECT * FROM jsonb_array_elements(v_subtests)
    LOOP
        INSERT INTO public.official_subtests (
            id, test_id, name, score_type,
            input_model, organization_id, display_order, unit
        )
        VALUES (
            gen_random_uuid()::text,
            v_test_id,
            COALESCE(NULLIF(TRIM(v_sub->>'name'), ''), 'Epreuve'),
            COALESCE(NULLIF(v_sub->>'score_type', ''), 'none'),
            COALESCE(NULLIF(v_sub->>'input_model', ''), 'numeric_4mode'),
            v_org_id,
            v_sub_idx,
            'pts'
        );
        v_sub_idx := v_sub_idx + 1;
    END LOOP;

    RETURN jsonb_build_object('test_id', v_test_id, 'org_id', v_org_id::text);
END;
$$;

-- ============================================================
-- Step 4: Drop the 6 dead columns
-- ============================================================
ALTER TABLE public.official_subtests
    DROP COLUMN IF EXISTS abbreviation,
    DROP COLUMN IF EXISTS raw_direction,
    DROP COLUMN IF EXISTS always_show_raw,
    DROP COLUMN IF EXISTS raw_display_decimals,
    DROP COLUMN IF EXISTS source_subtest_id,
    DROP COLUMN IF EXISTS is_override_clone;

-- ============================================================
-- Step 5: Strip dead keys from input_config JSONB
-- ============================================================
UPDATE public.official_subtests
SET input_config = input_config
    - 'defaultMetric'
    - 'aggregationHint'
    - 'formScope'
    - 'rawDirectionHint'
WHERE
    input_config ? 'defaultMetric'
    OR input_config ? 'aggregationHint'
    OR input_config ? 'formScope'
    OR input_config ? 'rawDirectionHint';;
