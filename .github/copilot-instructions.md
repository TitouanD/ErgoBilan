# ErgoBilan AI coding instructions

## Project context (why itâ€™s built this way)
- ErgoBilan is a clinical SPA for occupational therapists with **privacy-by-design**: Supabase stores relational data while all PII content is encrypted client-side (see [devlog.md](devlog.md)).
- â€œBlind backendâ€ model: server handles auth/RLS and storage only; client owns cryptography and can decrypt data locally (see [utils/crypto.ts](utils/crypto.ts)).
- Postâ€‘v1.6.1 relational split is deliberate: `patients` holds encrypted identity only, while `sessions` and `reports` store encrypted test results and report sections (see [devlog.md](devlog.md) and [db_schema.md](db_schema.md)).

## Architecture & composition
- Vite + React 19 + TypeScript SPA. Entry: [index.tsx](index.tsx); root composition and state-router in [App.tsx](App.tsx).
- App â€œroutingâ€ is internal: `mode` in `AppRouter` switches between landing/dashboard/assessment/portal/admin (no react-router).
- Global providers order is fixed: `AuthProvider` â†’ `CatalogProvider` â†’ `ToastProvider` â†’ `AssessmentProvider` â†’ `AppRouter` (see [App.tsx](App.tsx#L506-L516)).

## Data, security, and storage flow
- Supabase client lives in [services/db.ts](services/db.ts); tables/RLS/functions are the **source of truth** in [Supabase.csv](Supabase.csv) (with [db_schema.md](db_schema.md) as a human-readable summary).
- Key hierarchy: **MasterKey (PIN)** â†’ **OrgKey** â†’ **FileKey**; questionnaire links use URL hash keys (see [utils/crypto.ts](utils/crypto.ts)).
- `AssessmentContext` auto-save is draftâ€‘first: it creates the patient server-side first (`StorageService.createPatient`), then saves drafts and file metadata (see [contexts/AssessmentContext.tsx](contexts/AssessmentContext.tsx)).
- Archived status is stored inside the encrypted identity blob (no clear column); preserve this â€œsoft logicâ€ when editing storage logic (see [devlog.md](devlog.md)).
- `StorageService` owns encryption/decryption and persistence; keep demo mode bypasses intact (see [services/storage.ts](services/storage.ts)).

## AI/report generation
- AI uses `@google/genai` with model `gemini-3-flash-preview` in [services/ai.ts](services/ai.ts).
- Always anonymize before AI (`anonymizeData`) and rehydrate placeholders afterwards (`hydrateReport`) from [utils/anonymizer.ts](utils/anonymizer.ts).
- Credit consumption is enforced via `SubscriptionService.consumeCredit()` before AI calls.

## Scoring & catalog
- Scoring pipeline: `Step2Tests` â†’ `ScoringEngine.compute` (Supabase norms or demo hardcode for `cloches-barrees`) + `utils/scoring` conversions (see [components/assessment/Step2Tests.tsx](components/assessment/Step2Tests.tsx), [services/scoringEngine.ts](services/scoringEngine.ts), [utils/scoring.ts](utils/scoring.ts)).
- Catalog is loaded from Supabase view `view_unified_catalog` and `official_subtests`, then cached for search (see [contexts/CatalogContext.tsx](contexts/CatalogContext.tsx)).

## Demo mode conventions
- Demo flows are explicit and must remain sideâ€‘effectâ€‘free for Supabase (see `isDemoMode` in [contexts/AuthContext.tsx](contexts/AuthContext.tsx) and branches in [App.tsx](App.tsx)).

## Developer workflows
- Local dev: `npm install`, then `npm run dev` (see [README.md](README.md)).
- Build/preview: `npm run build`, `npm run preview`.
- Gemini API key: README mentions `GEMINI_API_KEY` in .env.local, but AI code reads `process.env.API_KEY` in [services/ai.ts](services/ai.ts); align env var when running locally.
