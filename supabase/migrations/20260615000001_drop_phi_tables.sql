-- ============================================================
-- DROP PHI TABLES — local-first migration cleanup
-- 
-- Context: all PHI (patients, assessments, drafts, followups)
-- has been moved to client-side IndexedDB (Dexie.js).
-- Supabase now only stores: auth, subscriptions, catalogue,
-- portal questionnaires.
--
-- ⚠️  DO NOT APPLY until all practitioners have confirmed
--     their data is migrated locally (or starting fresh).
--
-- Apply with: npx supabase db push
-- Or via Supabase dashboard → SQL editor.
-- ============================================================

-- 1. Drop RLS policies first (required before DROP TABLE)
DROP POLICY IF EXISTS "Practitioners can manage their patients"         ON public.patients;
DROP POLICY IF EXISTS "Practitioners can manage their assessments"      ON public.patient_assessments;
DROP POLICY IF EXISTS "Practitioners can manage their drafts"           ON public.drafts;
DROP POLICY IF EXISTS "Practitioners can manage their followups"        ON public.patient_followups;

-- 2. Drop tables (CASCADE handles FK references automatically)
DROP TABLE IF EXISTS public.patient_followups  CASCADE;
DROP TABLE IF EXISTS public.patient_assessments CASCADE;
DROP TABLE IF EXISTS public.drafts              CASCADE;
DROP TABLE IF EXISTS public.patients            CASCADE;

-- 3. Drop any Storage buckets that held encrypted PHI blobs
-- Uncomment if a 'patient-files' or similar bucket exists:
-- SELECT storage.delete_bucket('patient-files');

-- 4. Optional: revoke leftover grants (safe to run even if already gone)
REVOKE ALL ON TABLE public.patients             FROM authenticated;
REVOKE ALL ON TABLE public.patient_assessments  FROM authenticated;
REVOKE ALL ON TABLE public.drafts               FROM authenticated;
REVOKE ALL ON TABLE public.patient_followups    FROM authenticated;
