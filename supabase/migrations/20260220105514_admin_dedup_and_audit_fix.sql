-- Fix admin audit action check for subtest promotion and
-- make subtest deduplication abbreviation-aware.

ALTER TABLE public.admin_audit_log
  DROP CONSTRAINT IF EXISTS admin_audit_log_action_check;

ALTER TABLE public.admin_audit_log
  ADD CONSTRAINT admin_audit_log_action_check
  CHECK (
    action = ANY (
      ARRAY[
        'merge_tests'::text,
        'promote_subtests'::text,
        'promote_norms'::text,
        'reject_norms'::text,
        'dedup_subtests'::text,
        'attach_subtests'::text
      ]
    )
  );

CREATE OR REPLACE FUNCTION public.admin_find_duplicate_subtests(
  p_test_id text,
  p_threshold real DEFAULT 0.5
)
RETURNS TABLE(
  subtest_id_a text,
  subtest_name_a text,
  org_id_a uuid,
  norms_count_a bigint,
  subtest_id_b text,
  subtest_name_b text,
  org_id_b uuid,
  norms_count_b bigint,
  similarity_score real
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
    WITH prepared AS (
      SELECT
        s.id,
        s.test_id,
        s.name,
        s.organization_id,
        COALESCE(
          NULLIF(trim(regexp_replace(s.name, '\s*\([^()]{1,80}\)\s*$', '')), ''),
          s.name
        ) AS base_name,
        public.normalize_subtest_abbreviation_tag(
          COALESCE(s.abbreviation, public.extract_trailing_tag(s.name))
        ) AS resolved_abbreviation
      FROM public.official_subtests s
      WHERE s.test_id = p_test_id
    )
    SELECT
      a.id AS subtest_id_a,
      a.name AS subtest_name_a,
      a.organization_id AS org_id_a,
      (SELECT count(*) FROM public.official_norms n WHERE n.subtest_id = a.id) AS norms_count_a,
      b.id AS subtest_id_b,
      b.name AS subtest_name_b,
      b.organization_id AS org_id_b,
      (SELECT count(*) FROM public.official_norms n WHERE n.subtest_id = b.id) AS norms_count_b,
      similarity(lower(public.unaccent(a.base_name)), lower(public.unaccent(b.base_name))) AS similarity_score
    FROM prepared a
    JOIN prepared b
      ON a.test_id = b.test_id
     AND a.id < b.id
    WHERE COALESCE(a.resolved_abbreviation, '') = COALESCE(b.resolved_abbreviation, '')
      AND (
        lower(public.unaccent(a.base_name)) = lower(public.unaccent(b.base_name))
        OR similarity(lower(public.unaccent(a.base_name)), lower(public.unaccent(b.base_name))) >= p_threshold
      )
    ORDER BY similarity_score DESC;
END;
$function$;

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

    IF COALESCE(v_source_abbreviation, '') <> COALESCE(v_target_abbreviation, '') THEN
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
