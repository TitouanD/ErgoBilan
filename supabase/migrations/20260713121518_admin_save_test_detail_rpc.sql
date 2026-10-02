CREATE OR REPLACE FUNCTION public.admin_save_test_detail(
  p_test_id text,
  p_test_data jsonb,
  p_subtests jsonb,
  p_deleted_subtest_ids text[] DEFAULT '{}'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_sub jsonb;
BEGIN
  IF NOT check_is_admin() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  -- Update test metadata
  UPDATE official_tests
  SET
    name        = p_test_data->>'name',
    category_id = p_test_data->>'category_id',
    author      = p_test_data->>'author',
    version     = p_test_data->>'version'
  WHERE id = p_test_id;

  -- Delete removed subtests
  IF array_length(p_deleted_subtest_ids, 1) > 0 THEN
    DELETE FROM official_subtests WHERE id = ANY(p_deleted_subtest_ids);
  END IF;

  -- Upsert subtests
  IF p_subtests IS NOT NULL AND jsonb_array_length(p_subtests) > 0 THEN
    FOR v_sub IN SELECT * FROM jsonb_array_elements(p_subtests) LOOP
      INSERT INTO official_subtests (
        id, test_id, name, abbreviation, unit, score_type, computation_mode,
        input_model, input_config, raw_direction, always_show_raw,
        raw_display_decimals, display_order, display_group_order, organization_id
      ) VALUES (
        v_sub->>'id',
        v_sub->>'test_id',
        v_sub->>'name',
        v_sub->>'abbreviation',
        v_sub->>'unit',
        COALESCE(v_sub->>'score_type', 'standard'),
        COALESCE(v_sub->>'computation_mode', 'NONE'),
        v_sub->>'input_model',
        v_sub->'input_config',
        v_sub->>'raw_direction',
        COALESCE((v_sub->>'always_show_raw')::boolean, false),
        (v_sub->>'raw_display_decimals')::integer,
        (v_sub->>'display_order')::integer,
        (v_sub->>'display_group_order')::integer,
        (v_sub->>'organization_id')::uuid
      )
      ON CONFLICT (id) DO UPDATE SET
        name                = EXCLUDED.name,
        abbreviation        = EXCLUDED.abbreviation,
        unit                = EXCLUDED.unit,
        score_type          = EXCLUDED.score_type,
        computation_mode    = EXCLUDED.computation_mode,
        input_model         = EXCLUDED.input_model,
        input_config        = EXCLUDED.input_config,
        raw_direction       = EXCLUDED.raw_direction,
        always_show_raw     = EXCLUDED.always_show_raw,
        raw_display_decimals = EXCLUDED.raw_display_decimals,
        display_order       = EXCLUDED.display_order,
        display_group_order = EXCLUDED.display_group_order;
    END LOOP;
  END IF;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.admin_save_test_detail(text, jsonb, jsonb, text[]) TO authenticated;;
