create index if not exists idx_patients_org_last_interaction
  on public.patients (organization_id, last_interaction desc);

create index if not exists idx_pending_questionnaires_practitioner_created_at
  on public.pending_questionnaires (practitioner_id, created_at desc);

create index if not exists idx_drafts_user_updated_at
  on public.drafts (user_id, updated_at desc);

create index if not exists idx_reports_patient_created_at
  on public.reports (patient_id, created_at desc);

create index if not exists idx_sessions_patient_date
  on public.sessions (patient_id, date desc);
;
