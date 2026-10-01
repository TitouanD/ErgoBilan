---
name: issues
description: Dérouler le cycle des issues GitHub d'ErgoBilan en autonomie (tri, traitement de la file `claude`, relances, PR hebdomadaire dev → main). À utiliser quand l'utilisateur tape /issues ou demande de « traiter les issues ».
---

# /issues

Les règles sont dans [`docs/ISSUES.md`](../../../docs/ISSUES.md) : les lire d'abord. Ce fichier ne donne que l'ordre des opérations. Arguments possibles : un numéro d'issue (traiter celle-là seulement), `tri` (étape 1 seulement).

## 1. État des lieux

```bash
gh issue list --state open --limit 100 --json number,title,labels,author,updatedAt,comments \
  --jq '.[] | {n: .number, t: .title, l: [.labels[].name], a: .author.login, last: (.comments[-1].author.login // null)}'
git fetch origin && git log --oneline origin/main..origin/dev
```

## 1 bis. Relever les retours de l'app

Les retours envoyés par le bouton « Signaler » arrivent dans Sentry (org `ergobilan`, projet `ergobilan-frontend`), pas dans GitHub. Avec le MCP Sentry (`search_issues`), chercher `issue.category:feedback is:unresolved`. Pour chacun :

- créer une issue GitHub `trier`. Titre et corps reformulés : ce que la personne faisait, ce qui s'est passé. **Aucun nom d'enfant ni détail qui le reconnaisse**, même si le message en contient. Terminer par un bloc **Contexte** :
  - liens : le retour Sentry, son replay (`replay_id`) et, s'il existe, l'erreur associée (retour envoyé depuis l'écran d'erreur), avec le titre de l'erreur et le fichier en cause ;
  - où : `app_mode`, `report_type`, `assessment_step`, `demo_mode`, chemin de l'URL ;
  - quoi : release (commit), environnement (`production` / `preview`), navigateur et OS ;
  - qui : identifiant Sentry de l'utilisateur, jamais son e-mail. Un e-mail laissé en démo reste dans Sentry : noter seulement « e-mail laissé » ;
  - avant : les 5 à 10 derniers breadcrumbs utiles (écrans, étapes, erreurs), relus pour qu'aucun nom ne passe ;
- quand l'issue est traitée (étape 4), rouvrir le retour Sentry, le replay et l'erreur avec le MCP : c'est la source complète, l'issue n'en est que le résumé ;
- passer le retour Sentry en résolu (`update_issue`), avec le numéro de l'issue GitHub en commentaire si possible.

## 2. Trier les issues `trier`

Pour chacune, lire le corps et les commentaires, puis :

- poser la nature (`bug`, `amelioration`, `chantier`, `catalogue`) ;
- remplacer `trier` par `claude` si c'est faisable sans décision ; par `titouan` s'il faut un choix produit ou une migration Supabase / edge function (poser **une** question, avec ta recommandation) ; par l'auteur (`testeuse` ou `titouan`) s'il manque une information (la demander en commentaire, concrètement) ;
- doublon : fermer « not planned » avec un lien vers l'autre issue.

## 3. Relire ce qui attend un humain

- Issue `titouan` ou `testeuse` dont le dernier commentaire vient d'un humain : c'est une réponse. Un « OK » de la testeuse sur un changement déjà dans `dev` : fermer. Sinon, appliquer la réponse et repasser `claude`.
- Sans réponse : ne rien relancer, sauf si la PR hebdomadaire en dépend (la mentionner dedans).

## 4. Traiter la file `claude`

Ordre : `urgent`, puis `bug`, `amelioration`, `chantier` ; les plus anciennes d'abord. Une issue à la fois :

1. Worktree depuis `dev` : `git worktree add -b fix/<n>-<sujet> ../ErgoBilan-<n> origin/dev` (`feat/`, `refactor/` selon la nature). `npm ci` dans le worktree si `node_modules` manque.
2. Lire le doc de `docs/` concerné par le module (voir CLAUDE.md).
3. Bug : écrire d'abord le test qui échoue, puis corriger. Amélioration : tester le comportement nouveau.
4. `npm run check` vert.
   - **Génération touchée** (périmètre dans `CLAUDE.md`) : `npm run e2e:ai` à blanc, puis **une** exécution réelle (`E2E_AI_LIVE=1`, `E2E_AI=<parcours touché>`) depuis le worktree ; le jeton est lu dans le checkout principal. C'est la vérification : ne pas demander à Titouan de tester la génération. Coût minimal, jamais en boucle, 2 exécutions réelles au plus (`docs/AI_PIPELINE.md` §9). Joindre à l'issue le résumé (`resume.json` : appels, crédits) et ce que la trace montre.
   - Edge `generate` modifiée : l'exécution réelle vient après le déploiement accordé par Titouan (étape 5).
5. **Base commune** (migration Supabase, edge function) : écrire le fichier, pousser la branche, passer l'issue `titouan` avec une question. Ne rien appliquer ni déployer. Tout le reste se fusionne dans `dev` ; noter les points sensibles (Dexie, `.ergobilan`, anonymisation, auth, PIN, crédits) pour la PR hebdomadaire.
6. Sinon : fusionner dans `dev` (`git checkout dev && git merge --no-ff <branche> && git push`), supprimer le worktree et la branche.
7. Commenter l'issue : le commit, le test qui couvre le cas, puis fermer.
   - **Interface touchée** : avant la fusion, `npm run capture -- "scenario=…"` depuis le worktree (`docs/VERIFICATION.md`). Si l'écran n'a pas de scénario, en ajouter un. Regarder la capture soi-même : c'est la vérification. Le commentaire donne le lien du scénario (`localhost:3000/?scenario=…`) et ce que montre la capture.
   - **Vrai doute important** sur le rendu ou l'ergonomie, seulement dans ce cas : passer `titouan` et `testeuse`, avec le lien du scénario et la question précise.

Tout ce que tu relèves en chemin et qui sort de l'issue devient une nouvelle issue (`claude` ou `titouan`), pas un ajout silencieux.

## 5. PR hebdomadaire

Si la dernière PR `dev` → `main` fusionnée date de 7 jours ou plus (`gh pr list --base main --head dev --state merged --limit 1`) et que `dev` a des commits d'avance, ouvrir la PR `dev` → `main` :

- **Ce qui change**, en langage utilisateur, avec les issues ;
- **Validé par la testeuse** ;
- **En attente de son test** (ne bloque pas) ;
- **Retenu** : les « pas OK » explicites ; les retirer ou les corriger avant d'ouvrir la PR.
- **Points sensibles à regarder** : Dexie, `.ergobilan`, anonymisation, auth, PIN, crédits.

Ne jamais fusionner cette PR : c'est Titouan qui la fusionne.

## 6. Compte rendu

Terminer par un récapitulatif court : issues fermées, passées à `testeuse`, questions posées à `titouan` (avec leurs liens), PR ouverte.
