begin;

create table if not exists public.patient_assessments (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  organization_id uuid not null references public.organizations(id),
  user_id uuid not null references public.practitioners(id),
  kind text not null check (kind in ('initial', 'reevaluation', 'mini_reevaluation')),
  has_formal_report boolean not null default false,
  assessment_at timestamptz not null default now(),
  test_name text null,
  iv text not null,
  encrypted_payload text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_patient_assessments_patient_date
  on public.patient_assessments (patient_id, assessment_at desc);

create index if not exists idx_patient_assessments_org_date
  on public.patient_assessments (organization_id, assessment_at desc);

create index if not exists idx_patient_assessments_org_kind_date
  on public.patient_assessments (organization_id, kind, assessment_at desc);

alter table public.patient_assessments enable row level security;

drop policy if exists "Access assessments via organization" on public.patient_assessments;
create policy "Access assessments via organization"
  on public.patient_assessments
  for all
  using (
    organization_id in (
      select organization_members.organization_id
      from public.organization_members
      where organization_members.user_id = auth.uid()
    )
  )
  with check (
    organization_id in (
      select organization_members.organization_id
      from public.organization_members
      where organization_members.user_id = auth.uid()
    )
  );

create table if not exists public.patient_followups (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null unique references public.patients(id) on delete cascade,
  organization_id uuid not null references public.organizations(id),
  status text not null check (status in ('upcoming', 'due', 'overdue', 'scheduled', 'completed', 'snoozed')),
  due_at timestamptz not null,
  snoozed_until timestamptz null,
  note text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_patient_followups_org_status_due
  on public.patient_followups (organization_id, status, due_at);

alter table public.patient_followups enable row level security;

drop policy if exists "Access followups via organization" on public.patient_followups;
create policy "Access followups via organization"
  on public.patient_followups
  for all
  using (
    organization_id in (
      select organization_members.organization_id
      from public.organization_members
      where organization_members.user_id = auth.uid()
    )
  )
  with check (
    organization_id in (
      select organization_members.organization_id
      from public.organization_members
      where organization_members.user_id = auth.uid()
    )
  );

drop table if exists public.reports cascade;
drop table if exists public.sessions cascade;

commit;;
