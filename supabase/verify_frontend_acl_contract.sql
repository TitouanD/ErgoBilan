-- Frontend ACL contract verification
-- Run after migrations to detect grant drift between app queries and DB privileges.
--
-- Output:
-- - one single row (for Supabase SQL editor compatibility)
-- - summary counts + detailed JSON arrays
--
-- Expected result:
-- - all *_count columns = 0
-- - overall_ok = true

with expected_auth_table_privs as (
  select * from (
    values
      ('public.contribution_insights'::text, 'SELECT'::text),
      ('public.contribution_insights', 'INSERT'),
      ('public.drafts', 'SELECT'),
      ('public.drafts', 'INSERT'),
      ('public.drafts', 'UPDATE'),
      ('public.drafts', 'DELETE'),
      ('public.official_categories', 'SELECT'),
      ('public.organization_members', 'SELECT'),
      ('public.organization_members', 'UPDATE'),
      ('public.patient_assessments', 'SELECT'),
      ('public.patient_assessments', 'INSERT'),
      ('public.patient_assessments', 'UPDATE'),
      ('public.patient_assessments', 'DELETE'),
      ('public.patient_followups', 'SELECT'),
      ('public.patient_followups', 'INSERT'),
      ('public.patient_followups', 'UPDATE'),
      ('public.patient_followups', 'DELETE'),
      ('public.patients', 'SELECT'),
      ('public.patients', 'INSERT'),
      ('public.patients', 'UPDATE'),
      ('public.patients', 'DELETE'),
      ('public.pending_questionnaires', 'SELECT'),
      ('public.pending_questionnaires', 'INSERT'),
      ('public.pending_questionnaires', 'UPDATE'),
      ('public.pending_questionnaires', 'DELETE'),
      ('public.practitioners', 'SELECT'),
      ('public.practitioners', 'UPDATE'),
      ('public.subscriptions', 'SELECT'),
      ('public.view_unified_catalog', 'SELECT'),
      ('public.view_unified_subtests', 'SELECT')
  ) as v(object_name, privilege_name)
),
missing_auth_table_privs as (
  select
    object_name,
    privilege_name
  from expected_auth_table_privs
  where not has_table_privilege('authenticated', object_name, privilege_name)
),
expected_anon_table_privs as (
  select * from (
    values
      ('public.pending_questionnaires'::text, 'SELECT'::text),
      ('public.pending_questionnaires', 'UPDATE')
  ) as v(object_name, privilege_name)
),
missing_anon_table_privs as (
  select
    object_name,
    privilege_name
  from expected_anon_table_privs
  where not has_table_privilege('anon', object_name, privilege_name)
),
expected_auth_rpcs as (
  select * from (
    values
      ('public.bootstrap_practitioner_for_user(uuid, text)'::text),
      ('public.bootstrap_org_for_user(uuid, text)'),
      ('public.check_norms_availability(text[])'),
      ('public.check_norms_applicability(text[], integer, text)'),
      ('public.check_norms_status(text[], integer, text)'),
      ('public.compute_score(text, real, integer, text, text)'),
      ('public.admin_create_or_update_subtest_override_clone(text, text, text)'),
      ('public.check_is_member_of(uuid)'),
      ('public.check_is_admin()'),
      ('public.is_current_user_onboarded()'),
      ('public.find_private_test_by_name(text)'),
      ('public.find_similar_tests(text, double precision)'),
      ('public.create_private_test(jsonb)'),
      ('public.merge_private_test(text, jsonb)'),
      ('public.attach_subtests_to_test(text, jsonb)'),
      ('public.admin_check()'),
      ('public.admin_list_candidates()'),
      ('public.admin_get_test_bundle(text)'),
      ('public.admin_delete_test(text)'),
      ('public.admin_delete_subtest(text)'),
      ('public.admin_promote_test(text)'),
      ('public.admin_list_tests(text)'),
      ('public.admin_list_issue_backlog()'),
      ('public.admin_list_users()'),
      ('public.admin_update_user(uuid, boolean, integer, text, text, timestamp with time zone, timestamp with time zone, integer)'),
      ('public.admin_save_test_bundle(jsonb)'),
      ('public.admin_find_duplicates(double precision)'),
      ('public.admin_merge_tests(text[], text)'),
      ('public.admin_promote_subtests(text[])'),
      ('public.admin_promote_norms(text, text, uuid)'),
      ('public.admin_reject_norms(text, text, uuid)'),
      ('public.admin_find_duplicate_subtests(text, real)'),
      ('public.admin_merge_subtests(text[], text)'),
      ('public.admin_find_duplicate_norms(text, text)'),
      ('public.admin_deduplicate_norms(text, text)'),
      ('public.admin_norm_quality_check(text, text)'),
      ('public.admin_set_norm_issue_dismissed(uuid, text, boolean, text)'),
      ('public.admin_list_norm_fitting_dataset(text, text, text)'),
      ('public.admin_list_norm_fitting_issue_overrides(text, text)'),
      ('public.admin_set_norm_fitting_issue_dismissed(text, text, text, text, boolean, text)'),
      ('public.admin_insight_extreme_alerts(integer, real)'),
      ('public.admin_get_ai_health_stats()')
  ) as v(fn_signature)
),
missing_auth_rpcs as (
  select
    fn_signature
  from expected_auth_rpcs
  where not has_function_privilege('authenticated', fn_signature, 'EXECUTE')
),
guardrail_checks as (
  select
    'no_direct_select_official_norms_for_authenticated'::text as check_name,
    not has_table_privilege('authenticated', 'public.official_norms', 'SELECT') as ok
  union all
  select
    'no_direct_select_official_norms_for_anon',
    not has_table_privilege('anon', 'public.official_norms', 'SELECT')
  union all
  select
    'no_direct_select_official_subtests_for_authenticated',
    not has_table_privilege('authenticated', 'public.official_subtests', 'SELECT')
  union all
  select
    'no_direct_select_official_subtests_for_anon',
    not has_table_privilege('anon', 'public.official_subtests', 'SELECT')
  union all
  select
    'no_direct_select_official_tests_for_authenticated',
    not has_table_privilege('authenticated', 'public.official_tests', 'SELECT')
  union all
  select
    'no_direct_select_official_tests_for_anon',
    not has_table_privilege('anon', 'public.official_tests', 'SELECT')
  union all
  select
    'catalog_view_security_invoker_off',
    -- security_invoker=off is the default; when off, the option is not stored
    -- in reloptions at all (NULL or absent). Check that security_invoker=on
    -- is NOT present.
    NOT coalesce(
      (select reloptions @> array['security_invoker=on']
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = 'view_unified_catalog'),
      false
    )
  union all
  select
    'subtests_view_security_invoker_off',
    NOT coalesce(
      (select reloptions @> array['security_invoker=on']
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = 'view_unified_subtests'),
      false
    )
),
failed_guardrail_checks as (
  select
    check_name
  from guardrail_checks
  where not ok
),
summary as (
  select
    (select count(*) from missing_auth_table_privs) as missing_auth_table_privs_count,
    (select count(*) from missing_anon_table_privs) as missing_anon_table_privs_count,
    (select count(*) from missing_auth_rpcs) as missing_auth_rpcs_count,
    (select count(*) from failed_guardrail_checks) as failed_guardrails_count
)
select
  s.missing_auth_table_privs_count,
  s.missing_anon_table_privs_count,
  s.missing_auth_rpcs_count,
  s.failed_guardrails_count,
  (
    s.missing_auth_table_privs_count = 0
    and s.missing_anon_table_privs_count = 0
    and s.missing_auth_rpcs_count = 0
    and s.failed_guardrails_count = 0
  ) as overall_ok,
  coalesce(m_auth.details, '[]'::jsonb) as missing_auth_table_privs,
  coalesce(m_anon.details, '[]'::jsonb) as missing_anon_table_privs,
  coalesce(m_rpc.details, '[]'::jsonb) as missing_auth_rpcs,
  coalesce(m_guard.details, '[]'::jsonb) as failed_guardrails
from summary s
left join lateral (
  select jsonb_agg(
    jsonb_build_object(
      'object_name', object_name,
      'privilege_name', privilege_name
    )
    order by object_name, privilege_name
  ) as details
  from missing_auth_table_privs
) m_auth on true
left join lateral (
  select jsonb_agg(
    jsonb_build_object(
      'object_name', object_name,
      'privilege_name', privilege_name
    )
    order by object_name, privilege_name
  ) as details
  from missing_anon_table_privs
) m_anon on true
left join lateral (
  select jsonb_agg(
    jsonb_build_object(
      'fn_signature', fn_signature
    )
    order by fn_signature
  ) as details
  from missing_auth_rpcs
) m_rpc on true
left join lateral (
  select jsonb_agg(
    jsonb_build_object(
      'check_name', check_name
    )
    order by check_name
  ) as details
  from failed_guardrail_checks
) m_guard on true;
