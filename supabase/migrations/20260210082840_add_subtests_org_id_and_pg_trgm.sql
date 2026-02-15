
-- ============================================================
-- Migration: Deduplication Infrastructure
-- 1. Enable pg_trgm for fuzzy matching
-- 2. Add organization_id to official_subtests (private subtests under public tests)
-- 3. Update unique index to scope by org
-- 4. Update views to filter by subtest org_id
-- ============================================================

-- 1. Enable pg_trgm extension for similarity() and trigram matching
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 2. Add organization_id column to official_subtests
ALTER TABLE official_subtests
  ADD COLUMN organization_id uuid REFERENCES organizations(id);

-- Index for fast org-scoped queries
CREATE INDEX idx_official_subtests_org ON official_subtests USING btree (organization_id);

-- 3. Update the unique index to be scoped by organization
--    This allows the same normalized subtest name under both public (NULL) and private (org_id) scopes
DROP INDEX IF EXISTS idx_official_subtests_test_norm_subname;
CREATE UNIQUE INDEX idx_official_subtests_test_norm_subname
  ON official_subtests (test_id, norm_subtest_name(name), COALESCE(organization_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- 4. Update view_unified_subtests to filter by subtest-level org_id
--    A user sees: public subtests (org_id IS NULL) + their own org's private subtests
DROP VIEW IF EXISTS view_unified_subtests;
CREATE VIEW view_unified_subtests AS
  SELECT s.id, s.test_id, s.name, s.unit, s.score_type, s.organization_id
  FROM official_subtests s
  JOIN official_tests t ON t.id = s.test_id
  WHERE
    -- Test must be visible (public or user's org)
    (t.organization_id IS NULL OR check_is_member_of(t.organization_id))
    AND
    -- Subtest must be visible (public or user's org)
    (s.organization_id IS NULL OR check_is_member_of(s.organization_id));

-- 5. Update view_unified_catalog to count only visible subtests
DROP VIEW IF EXISTS view_unified_catalog;
CREATE VIEW view_unified_catalog AS
  SELECT t.id, t.name AS label, t.category_id, 
         c.label AS category_label, c.icon_key, c.sort_order,
         (SELECT count(*) FROM official_subtests s 
          WHERE s.test_id = t.id 
            AND (s.organization_id IS NULL OR check_is_member_of(s.organization_id))
         ) AS subtests_count
  FROM official_tests t
  JOIN official_categories c ON c.id = t.category_id
  WHERE t.organization_id IS NULL OR check_is_member_of(t.organization_id);

-- 6. Add RLS policy for subtests SELECT (was missing — reads went through views/RPCs)
--    Keep read access via views, but add explicit SELECT for direct queries
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='official_subtests' AND policyname='Unified subtest read'
  ) THEN
    CREATE POLICY "Unified subtest read" ON official_subtests
      FOR SELECT USING (
        organization_id IS NULL 
        OR check_is_member_of(organization_id)
      );
  END IF;
END$$;
;
