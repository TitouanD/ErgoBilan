-- AutoBilan: normalize report type values and enforce allowed set

update public.reports
set type = 'reevaluation'
where type = 'reeval';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'reports_type_check'
      and conrelid = 'public.reports'::regclass
  ) then
    alter table public.reports
      add constraint reports_type_check
      check (type in ('initial', 'reevaluation'));
  end if;
end $$;;
