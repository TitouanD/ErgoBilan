# Suivi des retours utilisateurs

Registre des retours des testeuses et des tests internes : ce qui a été demandé, ce qui a été fait et ce qu'il reste. Il sert aussi de liste de non-régression : chaque retour **Fait** a une vérification à refaire avant une mise en production.

Statuts :

- **Fait** : corrigé dans le code, `npm run check` au vert.
- **À appliquer** : prêt (migration relue), en attente d'application sur la base de production.
- **À vérifier** : fait, reste à valider dans le navigateur ou par la testeuse.
- **Ouvert** : non traité.

Façon de travailler : un lot de retours = une branche `fix/retours-AAAA-MM-JJ` dans un worktree (`git worktree add -b fix/retours-AAAA-MM-JJ ../ErgoBilan-retours-MMJJ main`), `npm run check`, fusion dans `main`, puis suppression du worktree et de la branche. Les changements de catalogue passent par un fichier de `supabase/migrations/`, appliqué seulement après accord.

## Lot du 2026-09-28

Branche `fix/retours-2026-09-28`. Source : testeuse (T) et test interne d'un bilan (I).

| #   | Src | Retour                                                                                                                     | Ce qui a été fait                                                                                                                                                                                                                                  | Statut |
| --- | --- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1   | T   | « Suivi par la PCO » dans Suivi médical / Cadre médical : Oui, Non (gris) et date optionnelle                              | Champs `pcoFollowup` (`oui`/`non`) et `pcoFollowupDate` sur `Patient`. Puces Oui / Non (décochables) et date dans le bloc Cadre médical de `SharedQuestionnaire`. Affiché dans le résumé du Dossier (`Step1Admin`) et envoyé à l'IA (`aiPayload`). | Fait   |
| 2   | T   | Renommer « Suivi Extérieur » en « Bilans et suivis extérieurs »                                                            | Titre du bloc renommé.                                                                                                                                                                                                                             | Fait   |
| 3   | T   | Langage : ajouter « Vocabulaire riche »                                                                                    | Puce `vocabulaire_riche`. Les libellés des puces de langage sont aussi traduits dans le résumé du Dossier (ils s'affichaient en code brut).                                                                                                        | Fait   |
| 4   | T   | Impossible de décocher un bouton après l'avoir coché                                                                       | Un second clic sur un bouton radio coché le vide (genre, horloge, comportement, etc.) ; les cartes « Mode de garde » se décochent aussi. Les puces l'étaient déjà.                                                                                 | Fait   |
| 5   | T   | MABC-2 7-10 ans : manquent « Chevilles main non préférée », « Lancer le sac », « Sauter à cloche pied jambe non préférée » | Migration `20260928100000` : 3 sous-tests ajoutés au groupe d'âge 2 ; « Sauter à cloche pied sur tapis » renommé « … jambe préférée ». `groupOrder` incohérent (99) corrigé dans la config.                                                        | Fait   |
| 6   | T   | Impossible de retirer un sous-test ajouté par erreur                                                                       | Croix sur chaque ligne du tableau de saisie (`ScoreTable`, prop `onRemoveSubtest`, branchée dans `ScorePage` : bilan initial et historique). Dans le catalogue, « ajouté » indique où retirer.                                                     | Fait   |
| 7   | T   | Les noms longs de sous-tests sont coupés                                                                                   | Retour à la ligne dans `ScoreTable` et dans la liste du catalogue.                                                                                                                                                                                 | Fait   |
| 8   | T   | NEPSY-2 : renommer « Précision visuomotrice » en « Précision visuomotrice, note étalonnée PV Composite »                   | Migration `20260928100000`.                                                                                                                                                                                                                        | Fait   |
| 9   | T   | NEPSY-2 : ordre alphabétique sans catégories, nom du sous-test devant le sous-sous-test                                    | Migration `20260928100000` : un seul groupe, `display_order` alphabétique (le sous-test avant ses déclinaisons) ; les 3 déclinaisons PV préfixées « Précision visuomotrice — ».                                                                    | Fait   |
| 10  | T   | Ajouter le test Man.O.S 3.0                                                                                                | Migration `20260928100000` : test `manos-3` (Motricité fine). 11 items × 2 lignes (manipulation, résultat), puis Total manipulation, Total résultat, Temps. La DS du tableur se saisit en ET ; la note brute peut aller dans l'observation.        | Fait   |
| 11  | I   | Dossier en saisie manuelle : la vue passe en condensé dès qu'on remplit Situation familiale                                | Le choix vue condensée / formulaire est fait une seule fois, à l'ouverture de la page (`Step1Admin`).                                                                                                                                              | Fait   |
| 12  | I   | Dossier : à l'ouverture d'une section longue, il faut remonter pour voir son début                                         | À l'ouverture, si l'en-tête de la section est sorti de l'écran, la page remonte dessus (`SharedQuestionnaire`).                                                                                                                                    | Fait   |

Reste à faire pour ce lot :

- Migration `20260928100000_catalog_retours_testeuse.sql` appliquée en production le 2026-09-28 (MABC-2 : 35 sous-tests, NEPSY-2 : 47, Man.O.S 3.0 : 25) ; code fusionné dans `main` le même jour.
- Retour de la testeuse attendu avant de supprimer le worktree `../ErgoBilan-retours-0928`.
- Vérification dans le navigateur des points 1, 4, 6, 7, 11 et 12.
- Non traité volontairement : retrait d'un sous-test pendant une réévaluation (les tableaux « précédent » et « nouveau » doivent rester alignés).

## Retours antérieurs

À compléter avec les anciens retours, pour vérifier qu'il n'y a pas de régression.
