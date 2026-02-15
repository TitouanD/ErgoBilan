-- AutoBilan: add missing indexes for common filters

create index if not exists idx_pending_questionnaires_practitioner
  on public.pending_questionnaires (practitioner_id);

create index if not exists idx_drafts_user_patient
  on public.drafts (user_id, patient_id);

create index if not exists idx_drafts_patient
  on public.drafts (patient_id);

create index if not exists idx_patients_org
  on public.patients (organization_id);

create index if not exists idx_reports_patient
  on public.reports (patient_id);

create index if not exists idx_sessions_patient
  on public.sessions (patient_id);

create index if not exists idx_subscriptions_user
  on public.subscriptions (user_id);

create index if not exists idx_org_members_user
  on public.organization_members (user_id);;
