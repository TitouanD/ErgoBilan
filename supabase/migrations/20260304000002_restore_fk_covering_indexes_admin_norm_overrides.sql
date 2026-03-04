-- Restore FK-covering indexes on admin_norm_fitting_issue_overrides.
-- Dropping them in 20260304000001 introduced "unindexed_foreign_key" warnings
-- which are the same severity as the "unused_index" warnings they had resolved.
-- FK indexes are worthwhile: Postgres uses them for cascading deletes/updates
-- on official_tests, official_subtests, and auth.users even if query-planner
-- stats show 0 scan hits.

CREATE INDEX IF NOT EXISTS idx_admin_norm_fitting_issue_overrides_dismissed_by
  ON public.admin_norm_fitting_issue_overrides (dismissed_by);

CREATE INDEX IF NOT EXISTS idx_admin_norm_fitting_issue_overrides_subtest_id
  ON public.admin_norm_fitting_issue_overrides (subtest_id);

CREATE INDEX IF NOT EXISTS idx_admin_norm_fitting_issue_overrides_test_id
  ON public.admin_norm_fitting_issue_overrides (test_id);
