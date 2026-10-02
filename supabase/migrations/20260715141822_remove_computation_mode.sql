
-- 1. Recreate view without computation_mode
DROP VIEW IF EXISTS view_unified_subtests;
CREATE VIEW view_unified_subtests AS
WITH caller AS (
  SELECT om.organization_id AS caller_org_id
  FROM organization_members om
  WHERE om.user_id = auth.uid()
  LIMIT 1
), visible_subtests AS (
  SELECT s.id, s.test_id, s.name, s.unit, s.score_type,
    s.organization_id, s.input_model, s.input_config,
    s.display_group_order, s.display_order,
    (SELECT caller.caller_org_id FROM caller) AS caller_org_id
  FROM official_subtests s
  JOIN official_tests t ON t.id = s.test_id
  WHERE is_current_user_onboarded()
    AND (t.organization_id IS NULL OR check_is_member_of(t.organization_id))
    AND (s.organization_id IS NULL OR check_is_member_of(s.organization_id))
)
SELECT id, test_id, name, unit, score_type, input_model, input_config,
  display_group_order, display_order
FROM visible_subtests
WHERE organization_id = caller_org_id OR organization_id IS NULL;

GRANT SELECT ON view_unified_subtests TO authenticated;

-- 2. Recreate admin_save_test_detail without computation_mode
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
        id, test_id, name, unit, score_type,
        input_model, input_config, display_order, display_group_order, organization_id
      ) VALUES (
        v_sub->>'id',
        v_sub->>'test_id',
        v_sub->>'name',
        v_sub->>'unit',
        COALESCE(v_sub->>'score_type', 'standard'),
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
        input_model         = EXCLUDED.input_model,
        input_config        = EXCLUDED.input_config,
        display_order       = EXCLUDED.display_order,
        display_group_order = EXCLUDED.display_group_order;
    END LOOP;
  END IF;
END;
$$;

-- 3. Drop the column
ALTER TABLE official_subtests DROP COLUMN computation_mode;
;
