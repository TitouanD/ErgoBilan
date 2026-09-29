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
- [`docs/RETOURS.md`](docs/RETOURS.md) : suivi des retours dans les issues GitHub (labels, milestones, non-régression) et façon de travailler (worktrees).

Toute description de « backend aveugle » ou de hiérarchie MasterKey → OrgKey → FileKey rencontrée ailleurs est **obsolète**.

## Règles

- **Base Supabase en lecture seule** sauf demande explicite. Il n'y a qu'une base, celle de production. Toute modification passe par un fichier de `supabase/migrations/`, relu, puis appliqué avec accord.
- **Données de santé** : ne jamais affirmer dans l'interface qu'elles sont chiffrées, tant que P0-1 n'est pas fait. Tout ce qui part vers l'IA est construit dans `utils/aiPayload.ts` puis passe par `anonymizeDeep` (`utils/anonymizer.ts`).
- **Parcours** : ne pas dupliquer un composant de `components/assessment/pages/` ou `shared/` pour un parcours. Étendre le composant partagé (ex. `ScoreTable`) sans retirer le comportement dont un autre parcours a besoin.
- **Scores** : lire un score par le score résolu (`utils/resolvedScore.ts` : `resolveScores`, `describeScore`, `formatMetricValue`), jamais en recomposant échelle, z, zone et nom à la main ; calculs et zones dans `utils/scoring.ts` ; noms et échelles via l'index du catalogue (`useCatalog().index`, `utils/catalogIndex.ts`) ; ordre d'affichage dans `utils/subtestOrdering.ts` ; données des graphiques et des pages du rapport dans `utils/reportData.ts` (partagé par l'aperçu et le PDF).
- **Statut patient** : aperçu du dashboard, rappel de réévaluation et brouillon périmé se calculent dans `utils/patientStatus.ts` (`buildPreviewMeta`, `derivePatientStatus`), jamais dans un écran.
- **Mode démo** : aucun effet de bord côté Supabase ni IA. Il utilise `data/demoData.ts`, `data/demoCatalog.ts` et `data/demoReport.ts`.
- **Toasts** : `const toast = useToast()` (le hook renvoie directement l'objet).

## Commandes

```bash
npm run dev            # Vite (port 3000)
npm run check          # lint + typecheck (strict) + tests + build : à lancer avant de rendre la main
npm run typecheck      # tsc --noEmit
npm test               # Vitest (utils/**/*.test.ts)
npm run format:check   # Prettier, *.md compris
```

## Agent skills

### Issue tracker

Les issues vivent dans GitHub Issues (`TitouanD/ErgoBilan`, CLI `gh`). Voir `docs/agents/issue-tracker.md`.

### Triage labels

Les cinq labels canoniques par défaut (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). Voir `docs/agents/triage-labels.md`.

### Domain docs

Single-context : `CONTEXT.md` et `docs/adr/` à la racine. Voir `docs/agents/domain.md`.
