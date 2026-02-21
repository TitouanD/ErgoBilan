CREATE OR REPLACE FUNCTION public.admin_merge_subtests(
  p_source_ids text[],
  p_target_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_migrated_norms bigint := 0;
  v_rows bigint;
  v_target_name text;
  v_target_test_id text;
  v_target_abbreviation text;
  v_source_id text;
  v_source_test_id text;
  v_source_abbreviation text;
BEGIN
  IF NOT check_is_admin() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  SELECT
    s.name,
    s.test_id,
    public.normalize_subtest_abbreviation_tag(COALESCE(s.abbreviation, public.extract_trailing_tag(s.name)))
  INTO
    v_target_name,
    v_target_test_id,
    v_target_abbreviation
  FROM public.official_subtests s
  WHERE s.id = p_target_id;

  IF v_target_name IS NULL THEN
    RAISE EXCEPTION 'Target subtest not found: %', p_target_id;
  END IF;

  FOREACH v_source_id IN ARRAY p_source_ids LOOP
    IF v_source_id = p_target_id THEN
      CONTINUE;
    END IF;

    SELECT
      s.test_id,
      public.normalize_subtest_abbreviation_tag(COALESCE(s.abbreviation, public.extract_trailing_tag(s.name)))
    INTO
      v_source_test_id,
      v_source_abbreviation
    FROM public.official_subtests s
    WHERE s.id = v_source_id;

    IF v_source_test_id IS NULL THEN
      RAISE EXCEPTION 'Source subtest not found: %', v_source_id;
    END IF;

    IF v_source_test_id <> v_target_test_id THEN
      RAISE EXCEPTION 'Cannot merge subtests across tests: % -> %', v_source_id, p_target_id;
    END IF;

    -- Allow merge when one side has no abbreviation tag.
    -- Still protect against conflicting explicit tags.
    IF COALESCE(v_source_abbreviation, '') <> COALESCE(v_target_abbreviation, '')
       AND COALESCE(v_source_abbreviation, '') <> ''
       AND COALESCE(v_target_abbreviation, '') <> '' THEN
      RAISE EXCEPTION
        'Cannot merge subtests with different abbreviation tags (% vs %)',
        COALESCE(v_source_abbreviation, '<none>'),
        COALESCE(v_target_abbreviation, '<none>');
    END IF;

    UPDATE public.official_norms
    SET subtest_id = p_target_id
    WHERE subtest_id = v_source_id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_migrated_norms := v_migrated_norms + v_rows;

    DELETE FROM public.official_subtests WHERE id = v_source_id;
  END LOOP;

  RETURN jsonb_build_object(
    'merged_subtests', array_length(p_source_ids, 1),
    'migrated_norms', v_migrated_norms,
    'target_name', v_target_name
  );
END;
$function$;

