# ErgoBilan AI coding instructions

Detailed, verified documentation lives in [`docs/`](../docs/) (French): `ARCHITECTURE.md`, `WORKFLOWS.md`, `DATA_MODEL.md`, `AI_PIPELINE.md`, `SCORING_CATALOG.md`, and the status register `TECH_DEBT.md`. Read the relevant doc before changing a module.

If you have access to the Supabase MCP, use it to inspect the real schema, RLS policies and functions. Only the latest migrations are versioned in `supabase/migrations/` (the historical ones exist only in the database, see TECH_DEBT P2-1). Treat the production database as read-only unless the user explicitly asks for a migration.

## Project context (why it's built this way)

- ErgoBilan is a clinical SPA for paediatric occupational therapists.
- **Local-first**: all patient data — identity, anamnesis, scores, reports, drafts, follow-ups — lives in the browser in IndexedDB via Dexie, one database per practitioner (`ErgoBilanDB_<userId>`, see [services/localDB.ts](../services/localDB.ts)). Nothing patient-related is stored on Supabase.
- Supabase only holds: auth, the practitioner profile (`practitioners`, including `branding_config` and `ai_style_preferences`), organizations, subscriptions/credits, the test catalogue, and portal questionnaires in transit (AES-GCM encrypted client-side, key in the URL fragment).
- ⚠️ Local data is currently stored **in plaintext**. The 6-digit PIN is a screen lock: its derived key (PBKDF2) only wraps portal questionnaire keys. Encrypting local data is backlog item P0-1 in `docs/TECH_DEBT.md`. Do not add UI copy claiming data is encrypted.
- The former "blind backend" (MasterKey → OrgKey → FileKey) no longer exists. `organization_members.encrypted_org_key` is a DB leftover.

## Architecture & composition

- Vite + React 19 + TypeScript (`strict`) SPA. Entry: [index.tsx](../index.tsx); [App.tsx](../App.tsx) holds the providers and a small state router.
- Routing is internal: `mode` in `App.tsx` switches between `landing` / `dashboard` / `detail` / `assessment` / `portal` / `admin` / `profile` (no react-router). The family portal is detected from the URL (`?q_id=…#key=…`) and rendered standalone, before auth.
- App-level pieces: `components/app/` (`LandingPage`, `AppHeader`, `ReportViewerOverlay`), `components/assessment/AssessmentWorkspace.tsx` (hosts the three flows), `hooks/useAssessmentLauncher.ts` (start / resume), `hooks/useAssessmentFlow.ts` (AI generation, finalization).
- Provider order: `ThemeProvider` → `AuthProvider` → `CatalogProvider` → `ToastProvider` → `AssessmentProvider` → `AppRouter`. As a consequence, Auth and Catalog cannot show toasts.
- `useToast()` returns the toast object directly: write `const toast = useToast()`.
- The Supabase client is typed (`createClient<Database>`, generated types in [types/supabase.ts](../types/supabase.ts)). Don't cast Supabase results with `as`; regenerate the types after a migration.

## Assessment flows — shared structure, don't duplicate

There are **three** assessment flows that must keep a consistent look and feel:

- **Initial** (`components/assessment/initial/`) — Step1Admin → `pages/ScorePage` → Step3Diagnostic → `pages/ValidationPage` → `pages/ExportPage`.
- **Réévaluation** (`components/assessment/reevaluation/`) — Step1Scores (side-by-side comparison with the reference bilan) → Step2Evolution → `pages/ValidationPage` → `pages/ExportPage`.
- **Historique** (`components/assessment/historical/`) — retroactive entry of a past bilan, no AI: Step1Form → ScorePage → Step3Report.

Cross-flow steps live in `components/assessment/pages/` (`ScorePage`, `ValidationPage`, `ExportPage`, `ReportView`, `PdfDocument`). Reusable pieces live in `components/assessment/shared/` (`ScoreTable`, `AssessmentStepper`, `StepNavFooter`, `TipTapEditor`, `CustomTestEditor`, `DeltaTable`).

- **Do not create a new per-flow copy of a component that already exists in `pages/` or `shared/`**: extend the shared one instead.
- Never remove an option or behavior needed by one flow while editing it for another. Each flow's UI has been tuned from real practitioner feedback.
- `ScoreTable` is the single score table (initial entry, re-evaluation entry, read-only reference column).
- The on-screen report (`ReportView`) and the PDF (`PdfDocument`) share their data (charts, zones, page layout) through [utils/reportData.ts](../utils/reportData.ts); only the rendering differs.

## Data & storage

- Supabase client and session helpers: [services/db.ts](../services/db.ts). Practitioner profile and branding: [services/profile.ts](../services/profile.ts).
- All local persistence goes through `StorageService` ([services/storage.ts](../services/storage.ts)); keep its demo-mode branches intact. `StorageService.reset()` closes the database on logout / lock.
- Backup/restore uses `.ergobilan` files (plain JSON, [services/exportService.ts](../services/exportService.ts)).
- `AssessmentContext` auto-saves drafts for all three flows with a debounce, after ensuring a local patient id exists (`StorageService.ensurePatientId`).
- Portal flow: `hooks/useLinkManager.ts` creates `pending_questionnaires` rows; the family fills them in via `components/portal/PatientPortal.tsx` (anon client + `x-questionnaire-token` header); `hooks/usePendingProcessor.ts` imports them locally, then deletes the remote row.

## AI/report generation

- The client **never** calls Gemini directly and holds no API key. `services/ai.ts` → `services/aiProxy.ts` → Edge Function `supabase/functions/generate` (prompts in `prompts.ts`). The function reads `GEMINI_API_KEY` from its secrets and handles JWT verification, rate limiting, credits (`generation_log`, session lock) and retries.
- Credits are consumed **server-side** by the edge function, not by the client.
- Call the AI only through the report generator ([utils/reportGenerator.ts](../utils/reportGenerator.ts)): it builds the payload ([utils/aiPayload.ts](../utils/aiPayload.ts)), anonymizes it and rehydrates the answer (`createAnonymization`, [utils/anonymizer.ts](../utils/anonymizer.ts)).

## Scoring & catalog

- The catalogue is Supabase-only, read through the `view_unified_catalog` and `view_unified_subtests` views by [contexts/CatalogContext.tsx](../contexts/CatalogContext.tsx), which exposes an O(1) index (`useCatalog().index`, [utils/catalogIndex.ts](../utils/catalogIndex.ts)). Without a session (demo), a static excerpt is used ([data/demoCatalog.ts](../data/demoCatalog.ts)).
- Scale conversions, zones (z ≤ −2 difficulty, ≤ −1 fragile) and `resolveScaleType` (unknown → `none`) live in [utils/scoring.ts](../utils/scoring.ts).
- `ScoreResult` stores only the last-entered `value` + `unit`; `normalizeScoreResult` / `normalizeTestData` read older bilans.
- Subtest naming, grouping and ordering: [utils/subtestOrdering.ts](../utils/subtestOrdering.ts).
- Re-evaluation deltas (z units, "non mesuré"): [utils/reevaluationHelpers.ts](../utils/reevaluationHelpers.ts).

## Out of scope (do not resurrect)

- Norm-fitting / contribution studio / PDF-extraction tooling is not part of the product. An `extract-norms` Edge Function is still **deployed** on Supabase (not in the repo) and should be removed.
- The score-type report feature (`ScoreTypeReportModal`) was removed on purpose.

## Demo mode conventions

- Demo flows must stay side-effect-free for Supabase and the AI (see `isDemoMode` in [contexts/AuthContext.tsx](../contexts/AuthContext.tsx)); AI generation is simulated with [data/demoReport.ts](../data/demoReport.ts).

## Developer workflows

- Local dev: `npm install`, then `npm run dev` (port 3000).
- Before handing over: `npm run check` (lint + `tsc --noEmit` strict + Vitest + build). CI runs the same command.
- Format: `npm run format:check` (covers `*.md`).
- Tests: `npm test` (Vitest, `utils/**/*.test.ts`).
- Env: see `.env.example` (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`; optional `VITE_SUPABASE_TURNSTILE_SITE_KEY`, `VITE_SENTRY_DSN_FRONTEND`). The Gemini key is an Edge Function secret, not a client env var.
