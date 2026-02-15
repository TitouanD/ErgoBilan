
-- ============================================================
-- Fix merge_private_test:
-- 1. Use norm_subtest_name() instead of norm_name() for subtest matching
-- 2. Use full 9-field dedup for norms (aligned with admin_promote_test)
-- ============================================================

CREATE OR REPLACE FUNCTION public.merge_private_test(
  p_target_id text,
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
  v_existing_sub_id text;
  v_new_sub_id text;
  v_new_subtests int := 0;
  v_new_norms int := 0;
BEGIN
  -- Get caller's org
  SELECT om.organization_id INTO v_org_id
  FROM organization_members om
  WHERE om.user_id = auth.uid()
  LIMIT 1;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'No organization found' USING ERRCODE = '42501';
  END IF;

  -- Verify ownership of target test
  IF NOT EXISTS (
    SELECT 1 FROM official_tests 
    WHERE id = p_target_id AND organization_id = v_org_id
  ) THEN
    RAISE EXCEPTION 'Target test not owned by your organization' USING ERRCODE = '42501';
  END IF;

  FOR v_sub IN SELECT * FROM jsonb_array_elements(p_payload -> 'subtests')
  LOOP
    v_sub_name := v_sub ->> 'name';

    -- Use norm_subtest_name for matching (was norm_name before — BUG FIX)
    SELECT s.id INTO v_existing_sub_id
    FROM official_subtests s
    WHERE s.test_id = p_target_id
      AND norm_subtest_name(s.name) = norm_subtest_name(v_sub_name);

    IF v_existing_sub_id IS NULL THEN
      -- Create new subtest
      v_new_sub_id := p_target_id || '_' || left(regexp_replace(lower(public.unaccent(trim(v_sub_name))), '[^a-z0-9]+', '_', 'g'), 50);
      
      INSERT INTO official_subtests (id, test_id, name, unit, score_type, computation_mode, organization_id)
      VALUES (
        v_new_sub_id,
        p_target_id,
        v_sub_name,
        COALESCE(v_sub ->> 'unit', 'pts'),
        COALESCE(v_sub ->> 'score_type', 'standard'),
        COALESCE(v_sub ->> 'computation_mode', 'PARAMETRIC'),
        v_org_id
      );
      v_new_subtests := v_new_subtests + 1;
      v_existing_sub_id := v_new_sub_id;
    END IF;

    -- Insert norms with full 9-field dedup
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

  RETURN jsonb_build_object('new_subtests', v_new_subtests, 'new_norms', v_new_norms);
END;
$function$;
;
