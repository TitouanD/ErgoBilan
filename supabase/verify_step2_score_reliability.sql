-- Step 2 score reliability contract verification
-- Run after migrations to detect schema/RPC/view drift.
--
-- Expected result:
-- - every *_ok = true
-- - overall_ok = true

with checks as (
  select
    coalesce(
      (
        select count(*) = 3
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'official_subtests'
          and column_name in ('raw_direction', 'source_subtest_id', 'is_override_clone')
      ),
      false
    ) as official_subtests_columns_ok,
    coalesce(
      (
        select pg_get_constraintdef(c.oid) ilike '%raw_direction%'
        from pg_constraint c
        join pg_class t on t.oid = c.conrelid
        join pg_namespace n on n.oid = t.relnamespace
        where n.nspname = 'public'
          and t.relname = 'official_subtests'
          and c.conname = 'official_subtests_raw_direction_check'
      ),
      false
    ) as raw_direction_check_ok,
    exists (
      select 1
      from pg_indexes
      where schemaname = 'public'
        and tablename = 'official_subtests'
        and indexname = 'official_subtests_org_source_override_uniq_idx'
    ) as override_unique_index_ok,
    has_function_privilege('authenticated', 'public.resolve_effective_subtest_id(text, uuid)', 'EXECUTE') as rpc_resolve_effective_subtest_id_ok,
    has_function_privilege('authenticated', 'public.admin_create_or_update_subtest_override_clone(text, text, text)', 'EXECUTE') as rpc_override_clone_ok,
    has_function_privilege('authenticated', 'public.check_norms_status(text[], integer, text)', 'EXECUTE') as rpc_check_norms_status_ok,
    has_function_privilege('authenticated', 'public.compute_score_core(text, real, integer, text, text)', 'EXECUTE') as rpc_compute_score_core_ok,
    has_function_privilege('authenticated', 'public.admin_list_issue_backlog()', 'EXECUTE') as rpc_issue_backlog_ok,
    coalesce(
      (
        select count(*) = 3
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'view_unified_subtests'
          and column_name in ('raw_direction', 'source_subtest_id', 'is_override_clone')
      ),
      false
    ) as unified_subtests_view_columns_ok,
    coalesce(
      (
        select
          position('zero_norm_subtests_count' in pg_get_function_result('public.admin_list_issue_backlog'::regproc)) > 0
          and position('low_confidence_score_type_count' in pg_get_function_result('public.admin_list_issue_backlog'::regproc)) > 0
      ),
      false
    ) as backlog_output_columns_ok
),
summary as (
  select
    official_subtests_columns_ok,
    raw_direction_check_ok,
    override_unique_index_ok,
    rpc_resolve_effective_subtest_id_ok,
    rpc_override_clone_ok,
    rpc_check_norms_status_ok,
    rpc_compute_score_core_ok,
    rpc_issue_backlog_ok,
    unified_subtests_view_columns_ok,
    backlog_output_columns_ok,
    (
      official_subtests_columns_ok
      and raw_direction_check_ok
      and override_unique_index_ok
      and rpc_resolve_effective_subtest_id_ok
      and rpc_override_clone_ok
      and rpc_check_norms_status_ok
      and rpc_compute_score_core_ok
      and rpc_issue_backlog_ok
      and unified_subtests_view_columns_ok
      and backlog_output_columns_ok
    ) as overall_ok
  from checks
)
select *
from summary;
