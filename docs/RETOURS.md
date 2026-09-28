# Suivi des retours utilisateurs

Les retours des testeuses et des tests internes sont suivis dans les [issues GitHub](https://github.com/TitouanD/ErgoBilan/issues) du dépôt, une issue par retour, regroupées par lot dans un milestone (`Retours AAAA-MM-JJ`). Le tableau qui vivait ici a été migré le 2026-09-28 (issues #36 à #48, milestone « Retours 2026-09-28 »).

## Labels

- Source : `retour-testeuse` ou `test-interne`.
- Nature : `bug`, `enhancement`, `catalogue` (passe par une migration Supabase).
- Suivi : `a-verifier` (fait, reste à valider dans le navigateur ou par la testeuse), `non-regression` (à revérifier avant chaque mise en production).
- Triage : `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix` (voir [`agents/triage-labels.md`](agents/triage-labels.md)).

Une issue est fermée quand le retour est corrigé dans `main` et `npm run check` au vert. Elle garde le label `non-regression` : la section « Vérification » de son corps est la liste à refaire avant une mise en production ([issues `non-regression`](https://github.com/TitouanD/ErgoBilan/issues?q=label%3Anon-regression)).

## Façon de travailler

Un lot de retours = un milestone et une branche `fix/retours-AAAA-MM-JJ` dans un worktree (`git worktree add -b fix/retours-AAAA-MM-JJ ../ErgoBilan-retours-MMJJ main`), `npm run check`, fusion dans `main`, puis suppression du worktree et de la branche. Les changements de catalogue passent par un fichier de `supabase/migrations/`, appliqué seulement après accord.

Les anciens retours, à ajouter quand ils arrivent, deviennent aussi des issues, pour vérifier qu'il n'y a pas de régression.
