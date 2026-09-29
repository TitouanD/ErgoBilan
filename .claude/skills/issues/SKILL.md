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

## 2. Trier les issues `trier`

Pour chacune, lire le corps et les commentaires, puis :

- poser la nature (`bug`, `amelioration`, `chantier`, `catalogue`) ;
- remplacer `trier` par `claude` si c'est faisable sans décision ; par `titouan` s'il faut un choix produit ou si c'est un risque majeur (poser **une** question, avec ta recommandation) ; par l'auteur (`testeuse` ou `titouan`) s'il manque une information (la demander en commentaire, concrètement) ;
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
5. **Risque majeur** (voir docs/ISSUES.md) : pousser la branche, ouvrir une PR vers `dev`, passer l'issue `titouan` avec une question. Ne pas fusionner.
6. Sinon : fusionner dans `dev` (`git checkout dev && git merge --no-ff <branche> && git push`), supprimer le worktree et la branche.
7. Commenter l'issue : le commit, le test qui couvre le cas. Contrôle visuel utile → passer `testeuse` avec « sur dev.ergobilan.com : aller à …, on doit voir … ». Sinon, fermer.

Tout ce que tu relèves en chemin et qui sort de l'issue devient une nouvelle issue (`claude` ou `titouan`), pas un ajout silencieux.

## 5. PR hebdomadaire

Si la dernière PR `dev` → `main` fusionnée date de 7 jours ou plus (`gh pr list --base main --head dev --state merged --limit 1`) et que `dev` a des commits d'avance, ouvrir la PR `dev` → `main` :

- **Ce qui change**, en langage utilisateur, avec les issues ;
- **Validé par la testeuse** ;
- **En attente de son test** (ne bloque pas) ;
- **Retenu** : les « pas OK » explicites ; les retirer ou les corriger avant d'ouvrir la PR.

Ne jamais fusionner cette PR : c'est Titouan qui la fusionne.

## 6. Compte rendu

Terminer par un récapitulatif court : issues fermées, passées à `testeuse`, questions posées à `titouan` (avec leurs liens), PR ouverte.
