# ErgoBilan

Application web clinique pour ergothérapeutes pédiatriques : passation de tests, rédaction de bilans assistée par IA, export PDF et suivi patient — avec chiffrement des données personnelles côté client.

## Fonctionnalités

- **Tableau de bord patients** — recherche, pagination, brouillons, archivage, relances de suivi
- **Bilan en 5 étapes** — admission (infos patient), passation des tests (scores + observations), synthèse diagnostique, validation du rapport, export
- **Trois parcours de bilan** — bilan initial, réévaluation (comparaison avec le bilan précédent) et saisie d'un bilan historique (import rétroactif)
- **Catalogue de tests unifié** — tests standardisés avec normes, conversion automatique NS/ET/percentile, tests personnalisés
- **Génération de rapport IA** — rédaction assistée par Gemini, anonymisation automatique avant envoi et réhydratation des données après réception
- **Export PDF** — mise en page personnalisable (branding, couleurs, logo) via `@react-pdf/renderer`
- **Portail patient** — lien de questionnaire partageable, chiffré via clé dans le hash de l'URL
- **Mode démo** — exploration complète sans compte, sans effet de bord sur Supabase
- **Panneau admin** — catalogue de tests, gestion des utilisateurs, supervision opérationnelle

## Architecture

```
Vite + React 19 + TypeScript   (SPA, routage interne — pas de react-router)
Supabase                       (auth, RLS, stockage relationnel, Edge Functions)
IndexedDB (Dexie)               (cache local patients/brouillons/bilans)
Chiffrement client-side         (AES-GCM, hiérarchie MasterKey → OrgKey → FileKey)
Google Gemini                   (génération de rapports, via Edge Function — jamais appelé directement du client)
```

Le backend est **aveugle** : l'identité patient et les résultats de tests sont chiffrés côté client avant persistance. Supabase gère l'authentification, les permissions (RLS) et le stockage, mais ne voit que des blobs chiffrés.

### Flux IA

Le client n'appelle jamais Gemini directement et ne détient aucune clé API. `services/aiProxy.ts` invoque l'Edge Function Supabase `supabase/functions/generate`, qui lit `GEMINI_API_KEY` côté serveur (secret Supabase, pas une variable d'environnement client) et effectue l'appel HTTP vers l'API Gemini.

## Structure du projet

```
App.tsx                       # Composition racine + routeur interne (mode: landing/dashboard/assessment/detail/profile/portal/admin)
contexts/                     # AuthProvider, CatalogProvider, ToastProvider, AssessmentProvider, ThemeProvider
hooks/                        # useAssessmentFlow, useDataLoader, useFavoriteTests, useLinkManager, usePendingProcessor, useVoiceDictation
components/
  assessment/
    initial/                  # Parcours "bilan initial" (Step1Admin, Step3Diagnostic)
    reevaluation/              # Parcours "réévaluation" (Step1Scores, Step2Evolution)
    historical/                # Parcours "bilan historique" (Step1Form, Step3Report)
    pages/                     # Étapes communes à plusieurs parcours (ScorePage, ValidationPage, ExportPage, ReportView, PdfDocument)
    shared/                    # Composants réutilisés entre parcours (AssessmentStepper, StepNavFooter, TipTapEditor, CustomTestEditor, DeltaTable)
  dashboard/                   # Dashboard, PatientDetail, ProfileEditor, CommandPalette
  auth/                        # AuthWizard, PinUnlock, OnboardingExperience
  admin/                       # AdminPanel (catalogue, utilisateurs, supervision)
  portal/                      # PatientPortal (questionnaire partagé)
  shared/                      # Composants UI génériques (modales, toasts, boutons...)
services/
  db.ts                        # Client Supabase
  storage.ts                   # Persistance locale (IndexedDB) + orchestration du chiffrement
  ai.ts / aiProxy.ts            # Génération IA (passe par l'Edge Function `generate`)
  scoringEngine.ts              # Normes et calcul des scores
  subscription.ts               # Gestion des crédits IA
utils/
  crypto.ts                    # Hiérarchie de clés, AES-GCM
  anonymizer.ts                 # Anonymisation avant IA / réhydratation après
  scoring.ts                    # Conversions de scores (NS/ET/percentile) partagées entre parcours
supabase/
  functions/                   # Edge Functions (generate, signup, purge-pending)
  migrations/                   # Migrations SQL (schéma, RLS, catalogue de tests)
```

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

Créer un fichier `.env.local` à la racine :

```env
VITE_SUPABASE_URL=https://<votre-projet>.supabase.co
VITE_SUPABASE_ANON_KEY=<votre-clé-anon>
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
npm run lint          # ESLint
npm run format:check  # Prettier (vérification)
npm test              # Vitest (exécution unique)
npm run test:watch    # Vitest (mode watch)
```

## Sécurité & vie privée

- Aucune donnée patient n'est transmise en clair au serveur — le chiffrement/déchiffrement se fait entièrement côté client (`utils/crypto.ts`)
- L'IA reçoit uniquement des données anonymisées (pseudonymes) — les identifiants réels sont réhydratés localement après génération
- Le statut d'archivage est stocké dans le blob chiffré (pas de colonne en clair)
- Les liens de questionnaire portail utilisent une clé dans le hash de l'URL (jamais transmise au serveur)

## Licence

Propriétaire — usage interne.
