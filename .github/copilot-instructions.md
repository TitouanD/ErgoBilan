# ErgoBilan AI coding instructions

YOU LIKELY HAVE ACCESS TO SUPABASE MCP, PLEASE USE IT TO REVIEW THE DATABASE SCHEMA, RLS POLICIES, AND FUNCTIONS AS NEEDED.

## Project context (why it's built this way)
- ErgoBilan is a clinical SPA for occupational therapists with **privacy-by-design**: Supabase stores relational data while all PII content is encrypted client-side (see [utils/crypto.ts](../utils/crypto.ts)).
- "Blind backend" model: the server handles auth/RLS and storage only; the client owns cryptography and decrypts data locally.
- `patients` holds encrypted identity only; `sessions`/`assessments` and `reports` store encrypted test results and report sections separately — preserve this split when touching storage.

## Architecture & composition
- Vite + React 19 + TypeScript SPA. Entry: [index.tsx](../index.tsx); root composition and state-router in [App.tsx](../App.tsx).
- App "routing" is internal: `mode` in `App.tsx` switches between landing/dashboard/assessment/detail/profile/portal/admin (no react-router).
- Global providers order is fixed: `AuthProvider` → `CatalogProvider` → `ToastProvider` → `AssessmentProvider` → `AppRouter`.

## Assessment flows — shared structure, don't duplicate
There are **three** assessment flows that must keep a consistent look and feel:
- **Initial** (`components/assessment/initial/`) — first-time bilan: Step1Admin → `pages/ScorePage` → Step3Diagnostic → `pages/ValidationPage` → `pages/ExportPage`.
- **Réévaluation** (`components/assessment/reevaluation/`) — Step1Scores (side-by-side comparison with the previous bilan) → Step2Evolution → `pages/ValidationPage` → `pages/ExportPage`.
- **Historique** (`components/assessment/historical/`) — retroactive entry of a past bilan: Step1Form → Step3Report.

Cross-flow steps live in `components/assessment/pages/` (e.g. `ScorePage`, `ValidationPage`, `ExportPage`, `ReportView`, `PdfDocument`) and reusable pieces live in `components/assessment/shared/` (`AssessmentStepper`, `StepNavFooter`, `TipTapEditor`, `CustomTestEditor`, `DeltaTable`, `ReevaluationTableView`, `ScoreTypeReportModal`). **Do not create a new per-flow copy of a component that already exists in `pages/` or `shared/`** — extend the shared one instead, and never remove an option/behavior needed by one flow while editing it for another (each flow's UI has been tuned from real practitioner feedback).
- The reevaluation flow's `Step1Scores.tsx` reuses `components/assessment/shared/ReevaluationTableView.tsx` (a `readOnly`/`singleMetric`-capable table) for its side-by-side comparison view — this is intentionally a **separate, simpler** table component from `pages/ScorePage.tsx`'s own richer internal `TableView` (which handles more input models: `custom_text`, `computed_items`, drag-reorder, voice dictation). Both share their subtest display/ordering logic via `utils/subtestOrdering.ts` and their score math via `utils/scoring.ts`, and both use the same `components/assessment/shared/ScoreTypeReportModal.tsx`. Don't re-duplicate any of these three shared modules back into a flow-specific file.

## Data, security, and storage flow
- Supabase client lives in [services/db.ts](../services/db.ts); tables/RLS/functions are the source of truth in Supabase (inspect via Supabase MCP or `supabase` CLI, migrations in `supabase/migrations/`).
- Key hierarchy: **MasterKey (PIN)** → **OrgKey** → **FileKey**; questionnaire links use URL hash keys (see [utils/crypto.ts](../utils/crypto.ts)).
- `AssessmentContext` auto-save is draft-first: it creates the patient server-side first (`StorageService.createPatient`), then saves drafts and file metadata (see [contexts/AssessmentContext.tsx](../contexts/AssessmentContext.tsx)).
- Archived status is stored inside the encrypted identity blob (no clear column) — preserve this when editing storage logic.
- `StorageService` ([services/storage.ts](../services/storage.ts)) owns encryption/decryption and IndexedDB (Dexie) persistence; keep demo-mode bypasses intact.

## AI/report generation
- The client **never** calls Gemini directly and holds no API key. `services/aiProxy.ts` invokes the Supabase Edge Function `supabase/functions/generate`, which reads `GEMINI_API_KEY` as a server-side secret (`Deno.env.get`) and makes a direct HTTPS call to the Gemini REST API (model `gemini-3-flash-preview`). There is no `@google/genai` SDK dependency.
- Always anonymize before AI (`anonymizeData`) and rehydrate placeholders afterwards (`hydrateReport`), see [utils/anonymizer.ts](../utils/anonymizer.ts).
- Credit consumption is enforced via `SubscriptionService.consumeCredit()` before AI calls.

## Scoring & catalog
- Scoring conversions (NS/ET/percentile, z-score math) live in [utils/scoring.ts](../utils/scoring.ts), shared across assessment flows — prefer adding to this file over reintroducing per-component copies. `ScoreResult` is a minimal `{ value, unit, observation, qualitativeLabel, customLabel, rawItems }` shape; `normalizeScoreResult`/`normalizeTestData` handle backward compatibility with older bilans.
- Subtest display name/grouping/ordering (`compareSubtestsForDisplay`, `getDisplayGroupLabel/Key/Order`, `getScaleLabel`) live in [utils/subtestOrdering.ts](../utils/subtestOrdering.ts), shared the same way.
- Norms lookups and score computation: [services/scoringEngine.ts](../services/scoringEngine.ts).
- Catalog is loaded from Supabase (`view_unified_catalog` / `official_subtests`) via [contexts/CatalogContext.tsx](../contexts/CatalogContext.tsx), then cached for search.

## Out of scope (do not resurrect)
- Norm-fitting / contribution studio / PDF-extraction tooling (previously under `ARCHIVE/norms/`, an `extract-norms` Edge Function, and `VITE_FEATURE_CONTRIB_*`/`VITE_FEATURE_ATTACH_*` flags) has been fully removed. It is not part of the current product — don't reference it in new code or docs.

## Demo mode conventions
- Demo flows are explicit and must remain side-effect-free for Supabase (see `isDemoMode` in [contexts/AuthContext.tsx](../contexts/AuthContext.tsx) and branches in [App.tsx](../App.tsx)).

## Developer workflows
- Local dev: `npm install`, then `npm run dev`.
- Build/preview: `npm run build`, `npm run preview`.
- Lint/format: `npm run lint`, `npm run format:check`.
- Tests: `npm test` (Vitest).
- Env: `.env.local` needs `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` only — the Gemini key is a Supabase Edge Function secret, not a client env var (see [README.md](../README.md)).
