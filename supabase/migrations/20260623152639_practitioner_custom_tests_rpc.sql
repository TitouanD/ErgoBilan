-- practitioner_save_custom_test: lets practitioners add org-private tests.
-- SECURITY DEFINER to bypass RLS. Forces organization_id from session.
-- No admin check. No delegation to admin_save_test_bundle.

CREATE OR REPLACE FUNCTION public.practitioner_save_custom_test(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_org_id     uuid;
    v_test_id    text;
    v_test       jsonb;
    v_subtests   jsonb;
    v_sub        jsonb;
    v_sub_idx    integer := 0;
    v_abbr       text;
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

    INSERT INTO public.official_tests (id, name, category_id, organization_id, version, author)
    VALUES (
        v_test_id,
        COALESCE(NULLIF(TRIM(v_test->>'name'), ''), 'Test personnalise'),
        COALESCE(NULLIF(v_test->>'category_id', ''), 'autre'),
        v_org_id,
        '1.0',
        'practitioner'
    );

    v_subtests := COALESCE(payload->'subtests', '[]'::jsonb);
    FOR v_sub IN SELECT * FROM jsonb_array_elements(v_subtests)
    LOOP
        v_abbr := NULLIF(TRIM(UPPER(COALESCE(v_sub->>'abbreviation', ''))), '');
        IF v_abbr IS NOT NULL AND v_abbr !~ '^[A-Z0-9][A-Z0-9&/ -]{0,19}$' THEN
            v_abbr := NULL;
        END IF;

        INSERT INTO public.official_subtests (
            id, test_id, name, abbreviation, score_type,
            input_model, organization_id, display_order, unit
        )
        VALUES (
            gen_random_uuid()::text,
            v_test_id,
            COALESCE(NULLIF(TRIM(v_sub->>'name'), ''), 'Epreuve'),
            v_abbr,
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

REVOKE ALL ON FUNCTION public.practitioner_save_custom_test(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.practitioner_save_custom_test(jsonb) TO authenticated;;
