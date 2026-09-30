# CLAUDE.md

ErgoBilan est une SPA React 19 + Vite + TypeScript pour ergothérapeutes pédiatriques. Elle est **local-first** : les données patients vivent dans IndexedDB (Dexie). Supabase sert à l'auth, au catalogue, aux crédits et au portail parents. Gemini est appelé via l'edge function `generate`.

## Lire d'abord

La documentation vérifiée (en français) est dans [`docs/`](docs/). **Lire le document concerné avant de modifier un module :**

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) : stack, providers, routeur `mode`, auth/PIN, frontière local/Supabase, crypto, déploiement.
- [`docs/WORKFLOWS.md`](docs/WORKFLOWS.md) : parcours initial, réévaluation et historique, brouillons, finalisation, portail, export.
- [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md) : types, schéma Dexie, `.ergobilan`, schéma Supabase (tables, RLS, RPC, triggers, cron, edge functions).
- [`docs/AI_PIPELINE.md`](docs/AI_PIPELINE.md) : charge utile, anonymisation, edge `generate`, crédits, style appris.
- [`docs/SCORING_CATALOG.md`](docs/SCORING_CATALOG.md) : catalogue, modèles de saisie, échelles, zones, deltas, tests personnalisés.
- [`docs/TECH_DEBT.md`](docs/TECH_DEBT.md) : état de chaque point (résolu, ouvert) et historique de mise en production.
- [`docs/PLAN_ASSAINISSEMENT.md`](docs/PLAN_ASSAINISSEMENT.md) : plan d'assainissement, avancement et recette manuelle.
- [`docs/ISSUES.md`](docs/ISSUES.md) : issues GitHub (labels, qui valide quoi), branches `dev`/`main`, worktrees, PR hebdomadaire. Commande `/issues` pour dérouler le cycle.

Toute description de « backend aveugle » ou de hiérarchie MasterKey → OrgKey → FileKey rencontrée ailleurs est **obsolète**.

## Règles

- **Base Supabase en lecture seule** sauf demande explicite. Il n'y a qu'une base, celle de production. Toute modification passe par un fichier de `supabase/migrations/`, relu, puis appliqué avec accord.
- **Données de santé** : ne jamais affirmer dans l'interface qu'elles sont chiffrées, tant que P0-1 n'est pas fait, ni qu'elles sont « anonymisées » avant une validation juridique (parler de pseudonymes). Tout appel à l'IA passe par le générateur (`utils/reportGenerator.ts`) : il construit la charge utile (`utils/aiPayload.ts`), l'anonymise (`createAnonymization`, `utils/anonymizer.ts`) et la contrôle (`utils/suspectTerms.ts`). Ne jamais appeler un transport (`callAIProxyTask`) directement.
- **Parcours** : ne pas dupliquer un composant de `components/assessment/pages/` ou `shared/` pour un parcours. Étendre le composant partagé (ex. `ScoreTable`) sans retirer le comportement dont un autre parcours a besoin.
- **Scores** : lire un score par le score résolu (`utils/resolvedScore.ts` : `resolveScores`, `describeScore`, `formatMetricValue`), jamais en recomposant échelle, z, zone et nom à la main ; calculs et zones dans `utils/scoring.ts` ; noms et échelles via l'index du catalogue (`useCatalog().index`, `utils/catalogIndex.ts`) ; ordre d'affichage dans `utils/subtestOrdering.ts` ; données des graphiques et des pages du rapport dans `utils/reportData.ts` (partagé par l'aperçu et le PDF).
- **Statut patient** : aperçu du dashboard, rappel de réévaluation et brouillon périmé se calculent dans `utils/patientStatus.ts` (`buildPreviewMeta`, `derivePatientStatus`), jamais dans un écran.
- **Mode démo** : aucun effet de bord côté Supabase ni IA. Il utilise `data/demoData.ts`, `data/demoCatalog.ts` et `data/demoReport.ts`.
- **Test IA de bout en bout (Gemini PAYANT, coût MINIME)** : si une modification touche la génération (`reportGenerator`, `aiPayload`, `anonymizer`, `suspectTerms`, `reportSections`, `services/ai.ts`, `services/aiProxy.ts`, `supabase/functions/generate/`, génération dans `useAssessmentFlow`), lancer **une** exécution réelle `npm run e2e:ai` quand tout le reste est vert (check, tests à faux transport, mode à blanc). Jamais hors de ce périmètre, jamais en boucle pour déboguer, 2 exécutions réelles au plus par modification. Détail : [`docs/AI_PIPELINE.md`](docs/AI_PIPELINE.md) §9.
- **Branches** : on part de `dev` et on fusionne dans `dev` (jamais directement dans `main`, qui reçoit la PR hebdomadaire `dev` → `main`). Claude fusionne dans `dev` sans demander ; l'accord de Titouan n'est requis que pour `main` et pour la base commune (migration Supabase, edge function) : voir `docs/ISSUES.md`. Chaque bug corrigé reçoit un test qui le reproduit.
- **Toasts** : `const toast = useToast()` (le hook renvoie directement l'objet).

## Commandes

```bash
npm run dev            # Vite (port 3000)
npm run check          # lint + typecheck (strict) + tests + build : à lancer avant de rendre la main
npm run typecheck      # tsc --noEmit
npm test               # Vitest (utils/ et services/ : *.test.ts ; composants : components/**/*.test.tsx en jsdom)
npm run format:check   # Prettier, *.md compris
npm run e2e:ai         # génération IA de bout en bout, à blanc ; E2E_AI_LIVE=1 = réel et PAYANT (AI_PIPELINE §9)
```

## Agent skills

### Issue tracker

Les issues vivent dans GitHub Issues (`TitouanD/ErgoBilan`, CLI `gh`). Voir `docs/agents/issue-tracker.md`.

### Triage labels

Labels du dépôt : `trier`, `claude`, `titouan`, `testeuse` (qui a la main), `bug`, `amelioration`, `chantier`, `catalogue`, `urgent`. Correspondance avec les rôles des skills : `docs/agents/triage-labels.md`.

### Domain docs

Single-context : `CONTEXT.md` et `docs/adr/` à la racine. Voir `docs/agents/domain.md`.
