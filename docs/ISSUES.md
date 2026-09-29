# Issues et façon de travailler

Tout le travail à faire vit dans les [issues GitHub](https://github.com/TitouanD/ErgoBilan/issues) : retours de la testeuse, demandes de Titouan, chantiers et bugs relevés par Claude. Il n'y a pas d'autre liste. Claude traite les issues en autonomie et ne sollicite un humain que dans les cas listés plus bas.

## Labels

Deux axes, pas plus.

**Qui a la main** (un seul à la fois ; c'est le filtre de chacun) :

| Label      | Sens                                                                                              |
| ---------- | ------------------------------------------------------------------------------------------------- |
| `trier`    | Nouvelle issue, Claude doit la lire (posé par défaut par le modèle d'issue)                       |
| `claude`   | Claude peut avancer seul                                                                          |
| `titouan`  | Attend une décision de Titouan : **une seule question**, dans le dernier commentaire de l'issue   |
| `testeuse` | Attend un test de la testeuse sur `dev.ergobilan.com` : ce qu'il faut faire et ce qu'on doit voir |

**Nature** : `bug`, `amelioration`, `chantier` (structure interne, sans demande utilisateur), `catalogue` (migration Supabase, donc accord de Titouan).

**Priorité** : `urgent`, optionnel, posé par Titouan ou la testeuse.

Une issue fermée n'a plus de label « qui a la main ». Les milestones ne sont plus utilisés.

## Qui valide quoi

| Cas                                                                   | Validation                                                        |
| --------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Bug de logique ou de comportement (clic, case, liste, calcul)         | Claude seul : un test automatique reproduit le cas, check au vert |
| Visuel, ergonomie, ressenti (texte coupé, mise en page, lisibilité)   | Testeuse, sur `dev`                                               |
| Choix produit, **risque majeur** (liste ci-dessous), vrais crédits IA | Titouan                                                           |

**Risque majeur**, jamais fusionné dans `dev` sans l'accord de Titouan :

- migration Supabase ou déploiement d'une edge function (la base est unique : ils touchent la production immédiatement) ;
- schéma Dexie ou format `.ergobilan` (données locales des utilisateurs, dégâts irréversibles) ;
- anonymisation ou contenu envoyé à l'IA ;
- auth, PIN, crédits.

Une migration est toujours écrite compatible avec le code déjà en production (ajouter avant de retirer), puisque `dev` et `main` partagent la même base.

## Tests

Chaque bug corrigé reçoit un test qui le reproduit (Vitest : fonctions pures dans `utils/**/*.test.ts`, stockage local dans `services/**/*.test.ts` (`fake-indexeddb`), composants avec Testing Library dans `components/**/*.test.tsx`). C'est ce test qui protège de la régression : il n'y a plus de liste de vérification manuelle à refaire avant une mise en production. Ce qui ne peut pas se tester automatiquement (le rendu visuel) va à la testeuse, qui utilise `dev` au quotidien.

## Branches et déploiement

- `main` = production (`app.ergobilan.com`). `dev` = recette (`dev.ergobilan.com`), utilisée au quotidien par la testeuse. Vercel ne déploie que ces deux branches (`vercel.json`, `git.deploymentEnabled`).
- Une issue = une branche partant de `dev` (`fix/<n>-<sujet>`, `feat/<n>-<sujet>`, `refactor/<n>-<sujet>`), dans son worktree : `git worktree add -b fix/<n>-<sujet> ../ErgoBilan-<n> dev`.
- Claude fusionne dans `dev` dès que `npm run check` est vert, sauf risque majeur. Puis il supprime le worktree et la branche.
- **Chaque semaine**, Claude ouvre une PR `dev` → `main` avec un résumé : ce qui change, ce que la testeuse a validé, ce qui attend encore son test. **Titouan fusionne** : c'est son seul geste obligatoire.
- Une issue `testeuse` sans réponse ne bloque pas la promotion. Un « pas OK » explicite retient le changement : Claude le corrige ou le retire de `dev` avant la PR.
- Données de la testeuse : IndexedDB est propre à chaque domaine, ses bilans faits sur `dev` restent sur `dev` (l'export `.ergobilan` permet de les déplacer).

## Cycle d'une issue

1. Créée par la testeuse ou Titouan (modèle « Signaler un problème ou une idée », label `trier`), ou par Claude dès qu'il relève quelque chose en travaillant (directement `claude` ou `titouan`).
2. Claude trie : il pose la nature, puis `claude`, `titouan` (avec sa question) ou demande une précision en commentaire (et passe l'issue à l'auteur : `testeuse` ou `titouan`).
3. Claude traite les issues `claude` : `urgent` d'abord, puis bugs, améliorations, chantiers ; les plus anciennes d'abord.
4. Fusion dans `dev`. Si un contrôle visuel est utile, l'issue passe `testeuse` avec un commentaire : quoi faire, ce qu'on doit voir. Sinon, Claude la ferme avec le commit et le test qui la couvre.
5. La testeuse répond « OK » (Claude ferme) ou décrit ce qui ne va pas (l'issue repasse `claude`).

La commande `/issues` (`.claude/skills/issues/`) déroule ce cycle en une session : tri, traitement de la file `claude`, relance de ce qui attend, PR hebdomadaire.

## Rédiger une issue ou un commentaire destiné à un humain

- Pour Titouan : une question qui se tranche en une phrase, avec la recommandation de Claude. Pas de liste de cases.
- Pour la testeuse : l'URL `dev`, le chemin (où cliquer), ce qu'on doit voir. Sans jargon de code.
