# Vérifier une modification

Vérifier un écran ne doit pas demander de recréer un patient et de remplir le dossier. Quatre outils existent pour cela, tous réservés au développement :

- **les scénarios** : un lien ouvre directement un écran avec des patients fictifs ;
- **la capture** : un script prend la capture d'écran d'un scénario, connecté au compte de test ;
- **les fixtures** : les mêmes patients fictifs, utilisables dans les tests de composants ;
- **la recette** : la batterie Playwright des parcours, fonctionnelle et visuelle, qui conditionne le passage dans `main` (voir [Recette](#recette)).

Le code est dans `dev/` (scénarios, patients, scores) et dans `e2e/` (`capture.mjs`, `recette/`). Rien n'en arrive dans le build déployé : `App.tsx` ne charge `dev/DevTools.tsx` que sous `import.meta.env.DEV`, ou dans le build de la recette (`VITE_SCENARIOS=1`, refusé sur Vercel par `vite.config.ts`).

## Patients fictifs

Six profils crédibles sont définis dans `dev/fictivePatients.ts`. Tous ont le nom de famille `FICTIF` et les champs requis de l'étape 1 sont remplis.

| Profil  | Enfant            | Motif                            | Tests                                                 |
| ------- | ----------------- | -------------------------------- | ----------------------------------------------------- |
| `leo`   | Léo, 8 ans, CE2   | Écriture lente et douloureuse    | BHK, Beery VMI, MABC-2 (tranche 2), observation libre |
| `ines`  | Inès, 9 ans, CM2  | TDC diagnostiqué                 | MABC-2 (tranche 2), DCDQ-F, BHK                       |
| `noah`  | Noah, 5 ans, GS   | Motricité fine et graphisme      | PDMS-2, DTVP-3, MABC-2 (tranche 1)                    |
| `chloe` | Chloé, 12 ans, 5e | TDAH, lenteur et désorganisation | BHK Ado, BRIEF-2, Figure de Rey, TEA-Ch               |
| `adam`  | Adam, 7 ans, CE1  | TSA, particularités sensorielles | Profil Sensoriel 2, Vineland-3                        |
| `lina`  | Lina, 9 ans, CM1  | Dysgraphie suivie depuis un an   | BHK, DTVP-2                                           |

Les scores sont calculés à partir du catalogue réellement chargé (`dev/fictiveScores.ts`). Ils suivent un motif fixe autour du niveau du profil et couvrent les trois zones. Ils sont saisis comme le ferait une ergothérapeute : en NS pour une échelle paramétrique, en % pour une échelle en percentiles, et alternativement en ET ou en % pour un test sans échelle. Un test ou un sous-test absent du catalogue est signalé par un toast et ignoré.

Pour ajouter un profil, il suffit d'ajouter une entrée à `FICTIVE_PROFILES`. Les sous-tests s'indiquent quand le test est découpé par tranche d'âge, comme MABC-2.

## Scénarios

Avec `npm run dev`, connecté et déverrouillé, on ouvre `http://localhost:3000/?scenario=…`.

| Lien                                 | Écran                                                                                              |
| ------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `?scenario=dashboard`                | Tableau de bord : un patient par statut (voir plus bas)                                            |
| `?scenario=initial&etape=1` à `5`    | Bilan initial : Dossier, Tests, Diagnostic, Validation, Visualisation                              |
| `?scenario=reeval&etape=1` à `4`     | Réévaluation (le bilan de référence est créé, 6 mois avant) : Tests, Évolution, Validation, Export |
| `?scenario=historique&etape=1` à `3` | Import d'un bilan antérieur : Dossier, Scores, Rapport                                             |
| `?scenario=abonnement`               | Tableau de bord avec la modale « Votre abonnement » ouverte                                        |

Les raccourcis `initial-dossier`, `initial-scores`, `initial-diagnostic`, `initial-validation`, `initial-visualisation`, `reeval-scores`, `reeval-evolution`, `reeval-validation` et `reeval-export` sont aussi acceptés.

Paramètres :

- `&patient=<profil>` change de patient. Par défaut : `leo` pour le bilan initial, `lina` pour la réévaluation, `ines` pour l'historique.
- `&tests=bhk,mabc-2` remplace les tests du profil, avec leurs identifiants du catalogue. `&tests=tout` charge le catalogue entier.
- `&scores=vide` ajoute les tests sans remplir les scores.
- `&modale=abonnement` ou `&modale=paywall` ouvre la modale des offres (plans ou « Plus de crédits ») par-dessus l'écran du scénario.

Le tableau de bord contient :

- Chloé, avec un rappel en retard (bilan il y a 13 mois) ;
- Inès, avec un rappel à planifier (7 mois) ;
- Léo, avec un rappel à venir (2 mois) ;
- Adam, avec un brouillon initial périmé laissé après son bilan ;
- Lina, avec une réévaluation en cours ;
- Noah, avec un bilan initial en cours et pas encore de rapport.

**Fonctionnement.** Le scénario écrit dans la base locale par les chemins de l'application (`StorageService` : dossier, bilans finalisés avec leur rappel, brouillon), puis l'application reprend le brouillon comme un clic sur « Reprendre ». Les sections du rapport viennent du générateur avec les réponses de démonstration (`data/demoReport.ts`) : **aucun appel à l'IA, aucun crédit**. Un clic sur « Régénérer » dans un scénario lance en revanche la vraie génération.

**Recharger la page** reconstruit le scénario. Ses patients fictifs sont supprimés puis recréés : tous les `FICTIF` pour le tableau de bord, le seul patient concerné sinon. Les vrais dossiers ne sont jamais touchés. Le bouton « Dev · Purger les fictifs », en bas à gauche, supprime tous les `FICTIF` de la base locale.

## Capture

```bash
npm run capture -- dashboard initial-scores "scenario=reeval&etape=2&patient=lina"
npm run capture -- reeval-evolution --tablette --plein
npm run capture -- initial-scores --clic "button:has-text('Ajouter')" --out <dossier>
npm run capture -- reeval-export "scenario=initial&etape=5&tests=nepsy-2" --pdf
```

- Un nom seul vaut `scenario=<nom>`. Chaque argument donne une capture.
- Le script démarre son propre Vite sur le checkout courant (port 3100) : un worktree est donc capturé tel quel.
- Il ouvre une session neuve du compte de test et tape le PIN, puis ouvre chaque scénario et prend une capture dans `.captures/<date>/` (ignoré par git), ou dans `--out`.
- `--tablette` capture en 1024×768 et `--portable` en 1366×768 (PC portable courant), au lieu de 1440×900. `--plein` capture toute la page. `--clic <sélecteur>` (répétable) clique avant la capture, par exemple pour ouvrir une modale ou un menu. On ne remplit jamais de formulaire au navigateur : les données viennent du scénario.
- `--pdf` télécharge en plus le PDF (bouton « Télécharger PDF ») à côté de la capture : le scénario doit être sur l'étape d'export (`initial&etape=5`, `reeval&etape=4`). Le PDF est produit à part (`@react-pdf`, `PdfDocument.tsx`) et ne ressemble pas toujours à l'aperçu : on le lit lui-même. Un test long (`&tests=nepsy-2`) éprouve la pagination.
- Les erreurs de la page (console, exceptions) sont affichées avec chaque capture.
- Le navigateur est Microsoft Edge, déjà installé avec Windows, piloté par `playwright-core` : aucun téléchargement. Son profil est vidé à chaque exécution, donc les patients fictifs n'arrivent jamais dans le navigateur de Titouan.

**Compte de test.** C'est le même que pour `npm run e2e:ai` ([`AI_PIPELINE.md`](AI_PIPELINE.md) §9). Il faut, dans `.env.e2e.local` du checkout principal :

```
E2E_SECRET=sb_secret_...
E2E_EMAIL=...
E2E_PIN=...
```

Le script ouvre une session neuve à chaque exécution (`e2e/testSession.mjs`) : il n'y a pas de jeton à entretenir ni à refaire. Il partage avec `e2e:ai` et la recette le verrou `.env.e2e.local.lock`, ce qui empêche deux exécutions simultanées. Lecture du compte, verrou, session et PIN : `e2e/testAccount.mjs`, commun à la capture et à la recette.

## Tests de composants

`dev/testing.tsx` fournit :

- `fictivePatient('leo')` : le patient, avec un identifiant ;
- `fictiveTests('leo', { fill, shift })` : ses scores sur le catalogue démo ;
- `demoIndex` : l'index de ce catalogue ;
- `renderWithToast(ui)` : un rendu dans le vrai `ToastProvider`.

Les contextes qui touchent Supabase ou IndexedDB restent simulés dans chaque fichier par `vi.mock` (voir `dev/testing.test.tsx` et `components/assessment/shared/ScoreTable.test.tsx`).

## Recette

La recette est la batterie de tests de l'interface qui conditionne la fusion de `dev` dans `main` ([ADR 0001](adr/0001-recette-locale.md)). Elle pilote Edge avec `@playwright/test`, connectée au compte de test.

```bash
npm run recette                                   # tout, sur origin/dev, statut GitHub « recette »
npm run recette -- --sur <ref> --sans-statut      # tout, sur un autre commit, sans statut
npm run recette:cible -- --grep @initial          # vérification ciblée, checkout courant
npm run recette:cible -- --grep @initial --update-snapshots   # accepter un changement visuel
```

**Ce qu'elle teste.** Le build de production (`vite build`, avec les scénarios gardés par `VITE_SCENARIOS=1`), servi par `vite preview` sur le port 3200. Pas le serveur de développement : avec plusieurs navigateurs à la fois, il met des dizaines de secondes par module et les scénarios n'aboutissent pas. Le build ajoute 40 s environ.

**`npm run recette`** teste le dernier commit d'`origin/dev`, dans son propre worktree `../ErgoBilan-recette-run` (détaché, remis à zéro à chaque fois). Il publie le statut `recette` (en cours, puis réussi ou en échec) sur ce commit, et écrit dans `.recette/<date>-<sha>/` :

- `rapport/` : le rapport HTML de Playwright (`npx playwright show-report <dossier>`), avec pour chaque échec les étapes, la capture, la vidéo, la trace pas à pas et, pour une différence visuelle, les images attendue, obtenue et la différence ;
- `resume.md` : les échecs par parcours, avec l'erreur, les problèmes relevés et les chemins des pièces jointes. C'est lui qu'on colle dans la PR hebdomadaire.

**Garde-fous de chaque test** (`e2e/recette/fixtures.ts`) :

- la connexion est réelle (session ouverte une fois par `globalSetup.ts`, puis PIN), comme le catalogue ;
- **aucune écriture dans Supabase** : toute requête autre qu'une lecture est bloquée et fait échouer le test, sauf le rafraîchissement de session et le rattachement idempotent à l'organisation. Un test qui a besoin d'une écriture la simule (`app.mock`) ;
- l'edge `generate` est interceptée et répond par le rapport de démo (`data/demoReport.ts`) : aucun appel à l'IA, aucun crédit. Les requêtes sont gardées dans `app.aiRequests` pour vérifier ce qui aurait été envoyé ;
- une exception, une erreur de la console ou une réponse en erreur fait échouer le test (la console complète est jointe à l'échec) ;
- l'horloge de la page part du 1er octobre 2026 à 9 h puis avance : les dates et les âges affichés ne changent pas d'un jour à l'autre.

**Références visuelles.** Elles sont dans `e2e/recette/references/`, rendues sous Windows avec Edge. Une différence de plus de 30 pixels fait échouer le test (un mot changé en fait quelques centaines ; le lissage des polices est absorbé pixel par pixel). On l'accepte (`--update-snapshots`, puis on regarde les nouvelles images avant de les commiter) quand elle est voulue ou qu'elle vient d'une mise à jour d'Edge. Sinon c'est une régression.

**Tags.** Chaque test porte le tag de son parcours. La vérification ciblée lance les tags que touche la modification :

| Modification                                                                                                                                                                                                                | Tags                                 |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `components/assessment/initial/`, génération (`utils/reportGenerator.ts`, `aiPayload`, `anonymizer`, `suspectTerms`)                                                                                                        | `@initial`                           |
| `components/assessment/reevaluation/`, `DeltaTable`, `utils/reevaluationHelpers.ts`                                                                                                                                         | `@reeval`                            |
| `components/assessment/historical/`                                                                                                                                                                                         | `@historique`                        |
| Composants partagés des parcours (`components/assessment/pages/`, `shared/`), `hooks/useAssessmentFlow.ts`, `utils/assessmentInProgress.ts`, `utils/scoring.ts`, `utils/resolvedScore.ts`, `utils/reportData.ts`, catalogue | `@initial`, `@reeval`, `@historique` |
| `components/dashboard/`, `utils/patientStatus.ts`, `hooks/useDataLoader.ts`, `services/storage.ts`, brouillons                                                                                                              | `@dashboard`, `@brouillons`          |
| Écran seulement visuel                                                                                                                                                                                                      | le tag du parcours, plus `@visuel`   |

Tags transverses :

- `@visuel` : les références visuelles ;
- `@fil-rouge` : le parcours complet du bilan initial ;
- `@fiche` : la fiche patient (rapport, identité, rappels, archivage, suppression) ;
- `@brouillons` : reprise, sauvegarde et abandon d'un brouillon.

Couverture actuelle :

- bilan initial : écrans des 5 étapes et fil rouge ;
- réévaluation : écrans des 4 étapes, « Réévaluation 1 clic » de bout en bout, reprise puis abandon d'un brouillon ;
- bilan historique : écrans des 3 étapes, parcours complet sans IA ;
- tableau de bord : statuts des patients, recherche, brouillons (périmé, repris, sauvegardé, abandonné) ;
- fiche patient : visionneuse, identité, planifier, reporter, compléter, archiver, supprimer.

**Ajouter un test.** Un fichier `*.spec.ts` dans `e2e/recette/<parcours>/`, qui importe `test` et `expect` de `../fixtures`, et porte le tag de son parcours. On part d'un scénario (`app.open('scenario=…')`) pour tester une étape, et on remplit les formulaires dans le test : c'est la seule place où on le fait. Un écran sans scénario reçoit un scénario.

## Qui vérifie quoi

Claude vérifie lui-même toute modification d'interface :

- un test automatique pour le comportement ;
- la capture du scénario concerné pour le visuel et l'ergonomie.

Si l'écran n'a pas de scénario, il en ajoute un. Le commentaire de l'issue donne le lien du scénario et ce que montre la capture. L'issue passe à Titouan et à la testeuse seulement en cas de **vrai doute important**, avec le lien du scénario. Voir [`ISSUES.md`](ISSUES.md).
