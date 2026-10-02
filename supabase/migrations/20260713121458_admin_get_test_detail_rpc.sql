CREATE OR REPLACE FUNCTION public.admin_get_test_detail(p_test_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_test jsonb;
  v_subtests jsonb;
BEGIN
  IF NOT check_is_admin() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  SELECT to_jsonb(t) INTO v_test
  FROM official_tests t
  WHERE t.id = p_test_id;

  IF v_test IS NULL THEN
    RAISE EXCEPTION 'test not found' USING ERRCODE = '02000';
  END IF;

  SELECT jsonb_agg(to_jsonb(s) ORDER BY s.display_order, s.name) INTO v_subtests
  FROM official_subtests s
  WHERE s.test_id = p_test_id;

  RETURN jsonb_build_object(
    'test', v_test,
    'subtests', COALESCE(v_subtests, '[]'::jsonb)
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.admin_get_test_detail(text) TO authenticated;;
