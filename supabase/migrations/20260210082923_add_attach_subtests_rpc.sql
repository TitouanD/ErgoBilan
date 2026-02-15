
-- ============================================================
-- RPC: attach_subtests_to_test
-- Attaches private subtests + norms to an existing test (public or private).
-- Subtests are created with the user's organization_id.
-- If a subtest with the same normalized name already exists for this org,
-- only new norms are inserted.
-- ============================================================

CREATE OR REPLACE FUNCTION public.attach_subtests_to_test(
  p_test_id text,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org_id uuid;
  v_sub jsonb;
  v_norm_row jsonb;
  v_sub_name text;
  v_sub_id text;
  v_existing_sub_id text;
  v_new_subtests int := 0;
  v_new_norms int := 0;
  v_test_exists boolean;
BEGIN
  -- Get caller's organization
  SELECT om.organization_id INTO v_org_id
  FROM organization_members om
  WHERE om.user_id = auth.uid()
  LIMIT 1;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'No organization found for user' USING ERRCODE = '42501';
  END IF;

  -- Verify the target test exists and is visible
  SELECT EXISTS(
    SELECT 1 FROM official_tests t 
    WHERE t.id = p_test_id 
      AND (t.organization_id IS NULL OR t.organization_id = v_org_id)
  ) INTO v_test_exists;

  IF NOT v_test_exists THEN
    RAISE EXCEPTION 'Test not found or not accessible' USING ERRCODE = '42704';
  END IF;

  -- Process each subtest in the payload
  FOR v_sub IN SELECT * FROM jsonb_array_elements(p_payload -> 'subtests')
  LOOP
    v_sub_name := v_sub ->> 'name';

    -- Check if this org already has a subtest with this normalized name under this test
    SELECT s.id INTO v_existing_sub_id
    FROM official_subtests s
    WHERE s.test_id = p_test_id
      AND s.organization_id = v_org_id
      AND norm_subtest_name(s.name) = norm_subtest_name(v_sub_name);

    -- Also check if there's a public subtest with this name (user adds norms to it via their org)
    IF v_existing_sub_id IS NULL THEN
      SELECT s.id INTO v_existing_sub_id
      FROM official_subtests s
      WHERE s.test_id = p_test_id
        AND s.organization_id IS NULL
        AND norm_subtest_name(s.name) = norm_subtest_name(v_sub_name);
      
      -- If public subtest exists, create a private copy for this org's norms
      IF v_existing_sub_id IS NOT NULL THEN
        v_sub_id := p_test_id || '_' || left(regexp_replace(lower(public.unaccent(trim(v_sub_name))), '[^a-z0-9]+', '_', 'g'), 50) || '_' || left(v_org_id::text, 8);
        INSERT INTO official_subtests (id, test_id, name, unit, score_type, computation_mode, organization_id)
        VALUES (
          v_sub_id,
          p_test_id,
          v_sub_name,
          COALESCE(v_sub ->> 'unit', 'pts'),
          COALESCE(v_sub ->> 'score_type', 'standard'),
          COALESCE(v_sub ->> 'computation_mode', 'PARAMETRIC'),
          v_org_id
        );
        v_new_subtests := v_new_subtests + 1;
        v_existing_sub_id := v_sub_id;
      END IF;
    END IF;

    IF v_existing_sub_id IS NULL THEN
      -- Create new private subtest
      v_sub_id := p_test_id || '_' || left(regexp_replace(lower(public.unaccent(trim(v_sub_name))), '[^a-z0-9]+', '_', 'g'), 50) || '_' || left(v_org_id::text, 8);
      INSERT INTO official_subtests (id, test_id, name, unit, score_type, computation_mode, organization_id)
      VALUES (
        v_sub_id,
        p_test_id,
        v_sub_name,
        COALESCE(v_sub ->> 'unit', 'pts'),
        COALESCE(v_sub ->> 'score_type', 'standard'),
        COALESCE(v_sub ->> 'computation_mode', 'PARAMETRIC'),
        v_org_id
      );
      v_new_subtests := v_new_subtests + 1;
      v_existing_sub_id := v_sub_id;
    END IF;

    -- Insert norms for this subtest (with org-level dedup)
    FOR v_norm_row IN SELECT * FROM jsonb_array_elements(v_sub -> 'norms')
    LOOP
      IF NOT EXISTS (
        SELECT 1 FROM official_norms n
        WHERE n.subtest_id = v_existing_sub_id
          AND n.age_min_months IS NOT DISTINCT FROM (v_norm_row ->> 'age_min_months')::int
          AND n.age_max_months IS NOT DISTINCT FROM (v_norm_row ->> 'age_max_months')::int
          AND n.gender IS NOT DISTINCT FROM (v_norm_row ->> 'gender')
          AND n.raw_min IS NOT DISTINCT FROM (v_norm_row ->> 'raw_min')::real
          AND n.raw_max IS NOT DISTINCT FROM (v_norm_row ->> 'raw_max')::real
          AND n.mean IS NOT DISTINCT FROM (v_norm_row ->> 'mean')::real
          AND n.sd IS NOT DISTINCT FROM (v_norm_row ->> 'sd')::real
          AND n.standard_score IS NOT DISTINCT FROM (v_norm_row ->> 'standard_score')::real
          AND n.percentile IS NOT DISTINCT FROM (v_norm_row ->> 'percentile')::real
      ) THEN
        INSERT INTO official_norms (subtest_id, organization_id, age_min_months, age_max_months, gender, raw_min, raw_max, mean, sd, standard_score, percentile)
        VALUES (
          v_existing_sub_id,
          v_org_id,
          (v_norm_row ->> 'age_min_months')::int,
          (v_norm_row ->> 'age_max_months')::int,
          COALESCE(v_norm_row ->> 'gender', 'Mixed'),
          (v_norm_row ->> 'raw_min')::real,
          (v_norm_row ->> 'raw_max')::real,
          (v_norm_row ->> 'mean')::real,
          (v_norm_row ->> 'sd')::real,
          (v_norm_row ->> 'standard_score')::real,
          (v_norm_row ->> 'percentile')::real
        );
        v_new_norms := v_new_norms + 1;
      END IF;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'new_subtests', v_new_subtests,
    'new_norms', v_new_norms,
    'test_id', p_test_id
  );
END;
$function$;
;
