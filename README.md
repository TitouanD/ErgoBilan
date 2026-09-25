# ErgoBilan

Application web clinique pour ergothérapeutes pédiatriques : passation de tests, rédaction de bilans assistée par IA, export PDF et suivi patient. Les données patients restent sur le poste du praticien (local-first).

> Documentation détaillée : [`docs/`](docs/) — architecture, parcours, modèle de données, pipeline IA, catalogue/scores et registre de dette technique ([`docs/TECH_DEBT.md`](docs/TECH_DEBT.md)).

## Fonctionnalités

- **Tableau de bord patients** — recherche, pagination, brouillons, archivage, relances de suivi
- **Bilan en 5 étapes** — admission (infos patient), passation des tests (scores + observations), synthèse diagnostique, validation du rapport, export
- **Trois parcours de bilan** — bilan initial, réévaluation (comparaison avec le bilan précédent) et saisie d'un bilan historique (import rétroactif)
- **Catalogue de tests unifié** — catalogue stocké dans Supabase, conversion automatique NS/ET/percentile selon l'échelle du sous-test, tests personnalisés
- **Génération de rapport IA** — rédaction assistée par Gemini ; toute la charge utile est pseudonymisée avant l'envoi et réhydratée après réception
- **Export PDF** — mise en page personnalisable (branding, couleurs, logo) via `@react-pdf/renderer`
- **Portail patient** — lien de questionnaire partageable, chiffré via clé dans le hash de l'URL
- **Mode démo** — exploration sans compte, avec des patients fictifs
- **Panneau admin** — catalogue de tests, gestion des utilisateurs, supervision opérationnelle

## Architecture

```
Vite + React 19 + TypeScript   (SPA, routage interne par état `mode` — pas de react-router)
IndexedDB (Dexie)              (TOUTES les données patients : une base `ErgoBilanDB_<userId>` par praticien)
Supabase                       (auth, profil, crédits/abonnement, catalogue de tests, transit des questionnaires parents)
Google Gemini                  (génération de rapports, via l'Edge Function `generate` — jamais appelé directement du client)
```

Depuis le passage « local-first » (commit `f44be11`), **aucune donnée patient n'est stockée sur Supabase**. Dossiers, bilans, brouillons et suivis vivent dans IndexedDB, **aujourd'hui en clair** : le PIN est un verrou d'écran et ne chiffre pas les données au repos. Le chiffrement local est le premier point P0 de [`docs/TECH_DEBT.md`](docs/TECH_DEBT.md). Seuls les questionnaires du portail parents transitent par Supabase, chiffrés en AES-GCM avec une clé portée par le hash de l'URL.

L'ancienne architecture « backend aveugle » (hiérarchie MasterKey → OrgKey → FileKey) n'existe plus.

### Flux IA

Le client n'appelle jamais Gemini directement et ne détient aucune clé API. La charge utile est construite par `utils/aiPayload.ts`, pseudonymisée par `utils/anonymizer.ts`, puis `services/ai.ts` → `services/aiProxy.ts` invoque l'Edge Function Supabase `supabase/functions/generate` (prompts dans `prompts.ts`). Celle-ci lit `GEMINI_API_KEY` côté serveur (secret Supabase, pas une variable d'environnement client), décompte les crédits et appelle l'API Gemini.

## Structure du projet

```
App.tsx                       # Providers + routeur interne (mode: landing/dashboard/detail/assessment/portal/admin/profile)
types.ts, types/supabase.ts   # Types du domaine ; types générés du schéma Supabase
contexts/                     # ThemeProvider, AuthProvider, CatalogProvider, ToastProvider, AssessmentProvider
hooks/                        # useAssessmentLauncher (démarrer/reprendre), useAssessmentFlow (génération IA, finalisation),
                              # useDataLoader, useLinkManager, usePendingProcessor, useFavoriteTests, useVoiceDictation
components/
  app/                        # LandingPage, AppHeader, ReportViewerOverlay
  assessment/
    AssessmentWorkspace.tsx   # Héberge les trois parcours (stepper, garde de génération, sauvegarde)
    initial/                  # Parcours "bilan initial" (Step1Admin, Step3Diagnostic)
    reevaluation/             # Parcours "réévaluation" (Step1Scores, Step2Evolution)
    historical/               # Parcours "bilan historique" (Step1Form, Step3Report)
    pages/                    # Étapes communes (ScorePage, ValidationPage, ExportPage, ReportView, PdfDocument)
    shared/                   # Composants partagés (ScoreTable, AssessmentStepper, StepNavFooter, TipTapEditor, CustomTestEditor, DeltaTable)
  dashboard/                  # Dashboard, PatientDetail, ProfileEditor, CommandPalette
  auth/                       # AuthWizard, PinUnlock, OnboardingExperience
  admin/                      # AdminPanel (catalogue, utilisateurs, supervision)
  portal/                     # PatientPortal (questionnaire parents)
  shared/                     # Composants UI génériques
services/
  db.ts                       # Client Supabase + gestion de session
  localDB.ts                  # Schéma Dexie (IndexedDB) par utilisateur
  storage.ts                  # Persistance locale (patients, bilans, brouillons, suivis)
  exportService.ts            # Sauvegarde / restauration `.ergobilan` (JSON non chiffré)
  ai.ts / aiProxy.ts          # Génération IA (passe par l'Edge Function `generate`)
  profile.ts                  # Profil praticien, branding, préférences de style IA
  admin.ts                    # RPC d'administration
utils/                        # Fonctions pures (testées dans utils/*.test.ts)
  scoring.ts                  # Échelles, conversions NS/ET/percentile, zones d'interprétation
  catalogIndex.ts             # Index du catalogue (noms, échelles) en O(1)
  reevaluationHelpers.ts      # Deltas de réévaluation
  reportData.ts               # Données du rapport partagées par l'aperçu et le PDF
  aiPayload.ts, anonymizer.ts # Charge utile IA, pseudonymisation / réhydratation
  patient.ts, assessment.ts   # Âge, identité ; enregistrements de bilan
  crypto.ts                   # PBKDF2 (PIN), AES-GCM (portail)
data/                         # Types du catalogue, branding par défaut, données de démo
supabase/
  functions/                  # Edge Functions (generate, signup)
  migrations/                 # Migrations récentes (voir docs/TECH_DEBT.md pour celles à appliquer)
docs/                         # Documentation technique détaillée
```

Seules les migrations récentes sont versionnées dans `supabase/migrations/` ; le schéma historique (tables, RLS, fonctions Postgres) n'existe qu'en base. Voir [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md).

## Démarrage local

### Prérequis

- Node.js ≥ 18
- Un projet Supabase (URL + clé anon)
- Une clé API Google Gemini (configurée côté Supabase, voir plus bas)

### Installation

```bash
npm install
```

### Variables d'environnement

Copier `.env.example` en `.env.local` à la racine et le compléter :

```env
VITE_SUPABASE_URL=https://<votre-projet>.supabase.co
VITE_SUPABASE_ANON_KEY=<votre-clé-anon>
# Optionnel
VITE_SUPABASE_TURNSTILE_SITE_KEY=<clé-site-turnstile>
VITE_SENTRY_DSN_FRONTEND=<dsn>
```

La clé Gemini n'est **pas** une variable d'environnement du client : elle se configure comme secret sur l'Edge Function Supabase `generate` (`GEMINI_API_KEY`), via `supabase secrets set` ou le dashboard Supabase.

### Lancer en développement

```bash
npm run dev
```

### Build de production

```bash
npm run build
npm run preview
```

## Qualité & tests

```bash
npm run check         # Tout ce que vérifie la CI : lint + typecheck (strict) + tests + build
npm run typecheck     # tsc --noEmit
npm run lint          # ESLint
npm run format:check  # Prettier (vérification)
npm test              # Vitest (exécution unique)
npm run test:watch    # Vitest (mode watch)
```

## Sécurité & vie privée

- Les données patients restent sur le poste du praticien (IndexedDB) et ne sont jamais envoyées à Supabase. **Elles ne sont pas encore chiffrées au repos**, pas plus que la sauvegarde `.ergobilan` : c'est un chantier prioritaire (`docs/TECH_DEBT.md`, P0-1).
- Le PIN à 6 chiffres déverrouille l'application. La clé qui en dérive (PBKDF2) protège aujourd'hui uniquement les clés des questionnaires du portail.
- Avant l'envoi à l'IA, toute la charge utile est pseudonymisée (patient, parents, fratrie, professionnels, école), puis réhydratée localement.
- Les réponses du portail parents sont chiffrées côté navigateur. La clé figure dans le hash de l'URL et n'est jamais transmise au serveur.
- Gemini n'est appelé que par l'Edge Function `generate`. La clé API reste un secret Supabase.

## Licence

Propriétaire — usage interne.
