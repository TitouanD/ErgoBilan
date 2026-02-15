# Legacy Drift Migrations (Archived)

These files were removed from `supabase/migrations` on 2026-02-15 during migration history realignment.

Reason:
- They were local-only versions that caused drift in `supabase migration list --linked`.
- Equivalent canonical migrations exist in remote history with official timestamps.
- Keeping them in the active migration directory can break deterministic migration workflows.

Archived files:
- 20260209_update_private_create_merge.sql
- 20260210123000_add_missing_indexes.sql
- 20260210124500_normalize_report_type.sql
- 20260210133000_add_composite_indexes.sql
- 20260212164000_harden_signup_rate_limit.sql
