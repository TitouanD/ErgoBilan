-- Client-facing RPC permissions and hygiene (docs/TECH_DEBT.md P1-1, P1-3, P0-8).
--
-- 1. practitioner_save_custom_test was not executable by `authenticated`:
--    creating a custom test failed with "permission denied".
-- 2. Admin RPCs were executable by `anon` (guarded by check_is_admin(), but
--    there is no reason to expose them).
-- 3. get_contextual_recommendations / upsert_recommendation target the dropped
--    table recommendation_crowd and are unused.
-- 4. search_path fixed on the functions touched by this migration (other
--    functions, e.g. enforce_public_acl_on_ddl, are left for a later audit).

-- 1. Custom tests
ALTER FUNCTION public.practitioner_save_custom_test(jsonb) SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.practitioner_save_custom_test(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.practitioner_save_custom_test(jsonb) TO authenticated;

-- 2. Admin RPCs: signed-in users only (each one still checks check_is_admin()).
REVOKE EXECUTE ON FUNCTION public.admin_get_ai_health_stats() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_get_test_detail(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_save_test_detail(text, jsonb, jsonb, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_ai_health_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_test_detail(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_save_test_detail(text, jsonb, jsonb, text[]) TO authenticated;

-- admin_save_test_detail: unknown scale / standard input model / empty config by
-- default (columns are NOT NULL; 'standard' as default turned NS 8 into z ≈ -6).
CREATE OR REPLACE FUNCTION public.admin_save_test_detail(
  p_test_id text,
  p_test_data jsonb,
  p_subtests jsonb,
  p_deleted_subtest_ids text[] DEFAULT '{}'::text[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
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
        id, test_id, name, unit, score_type,
        input_model, input_config, display_order, display_group_order, organization_id
      ) VALUES (
        v_sub->>'id',
        v_sub->>'test_id',
        v_sub->>'name',
        v_sub->>'unit',
        COALESCE(NULLIF(v_sub->>'score_type', ''), 'none'),
        COALESCE(NULLIF(v_sub->>'input_model', ''), 'numeric_4mode'),
        COALESCE(NULLIF(v_sub->'input_config', 'null'::jsonb), '{}'::jsonb),
        (v_sub->>'display_order')::integer,
        (v_sub->>'display_group_order')::integer,
        (v_sub->>'organization_id')::uuid
      )
      ON CONFLICT (id) DO UPDATE SET
        name                = EXCLUDED.name,
        unit                = EXCLUDED.unit,
        score_type          = EXCLUDED.score_type,
        input_model         = EXCLUDED.input_model,
        input_config        = EXCLUDED.input_config,
        display_order       = EXCLUDED.display_order,
        display_group_order = EXCLUDED.display_group_order;
    END LOOP;
  END IF;
END;
$function$;

-- 3. Dead RPCs (their table recommendation_crowd no longer exists)
DROP FUNCTION IF EXISTS public.get_contextual_recommendations(text[], integer);
DROP FUNCTION IF EXISTS public.upsert_recommendation(text, text[]);
