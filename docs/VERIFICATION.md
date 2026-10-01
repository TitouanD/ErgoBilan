# Vérifier une modification

Vérifier un écran ne doit pas demander de recréer un patient et de remplir le dossier. Trois outils existent pour cela, tous réservés au développement :

- **les scénarios** : un lien ouvre directement un écran avec des patients fictifs ;
- **la capture** : un script prend la capture d'écran d'un scénario, connecté au compte de test ;
- **les fixtures** : les mêmes patients fictifs, utilisables dans les tests de composants.

Le code est dans `dev/` (scénarios, patients, scores) et dans `e2e/capture.mjs`. Rien n'en arrive dans le build de production : `App.tsx` ne charge `dev/DevTools.tsx` que sous `import.meta.env.DEV`.

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

Les raccourcis `initial-dossier`, `initial-scores`, `initial-diagnostic`, `initial-validation`, `initial-visualisation`, `reeval-scores`, `reeval-evolution`, `reeval-validation` et `reeval-export` sont aussi acceptés.

Paramètres :

- `&patient=<profil>` change de patient. Par défaut : `leo` pour le bilan initial, `lina` pour la réévaluation, `ines` pour l'historique.
- `&tests=bhk,mabc-2` remplace les tests du profil, avec leurs identifiants du catalogue. `&tests=tout` charge le catalogue entier.
- `&scores=vide` ajoute les tests sans remplir les scores.

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
- Il se connecte au compte de test et tape le PIN, puis ouvre chaque scénario et prend une capture dans `.captures/<date>/` (ignoré par git), ou dans `--out`.
- `--tablette` capture en 1024×768 au lieu de 1440×900. `--plein` capture toute la page. `--clic <sélecteur>` (répétable) clique avant la capture, par exemple pour ouvrir une modale ou un menu. On ne remplit jamais de formulaire au navigateur : les données viennent du scénario.
- `--pdf` télécharge en plus le PDF (bouton « Télécharger PDF ») à côté de la capture : le scénario doit être sur l'étape d'export (`initial&etape=5`, `reeval&etape=4`). Le PDF est produit à part (`@react-pdf`, `PdfDocument.tsx`) et ne ressemble pas toujours à l'aperçu : on le lit lui-même. Un test long (`&tests=nepsy-2`) éprouve la pagination.
- Les erreurs de la page (console, exceptions) sont affichées avec chaque capture.
- Le navigateur est Microsoft Edge, déjà installé avec Windows, piloté par `playwright-core` : aucun téléchargement. Son profil est vidé à chaque exécution, donc les patients fictifs n'arrivent jamais dans le navigateur de Titouan.

**Compte de test.** C'est le même que pour `npm run e2e:ai` ([`AI_PIPELINE.md`](AI_PIPELINE.md) §9). Il faut, dans `.env.e2e.local` du checkout principal :

```
E2E_REFRESH_TOKEN=...
E2E_PIN=...
```

Supabase remplace le refresh token à chaque rafraîchissement, et le déverrouillage par PIN en déclenche un. Le script écrit donc le dernier jeton dans le fichier avant de terminer. Il partage avec `e2e:ai` le verrou `.env.e2e.local.lock`, ce qui empêche deux exécutions simultanées. Si le jeton est perdu, refaire la connexion décrite au §9.

## Tests de composants

`dev/testing.tsx` fournit :

- `fictivePatient('leo')` : le patient, avec un identifiant ;
- `fictiveTests('leo', { fill, shift })` : ses scores sur le catalogue démo ;
- `demoIndex` : l'index de ce catalogue ;
- `renderWithToast(ui)` : un rendu dans le vrai `ToastProvider`.

Les contextes qui touchent Supabase ou IndexedDB restent simulés dans chaque fichier par `vi.mock` (voir `dev/testing.test.tsx` et `components/assessment/shared/ScoreTable.test.tsx`).

## Qui vérifie quoi

Claude vérifie lui-même toute modification d'interface :

- un test automatique pour le comportement ;
- la capture du scénario concerné pour le visuel et l'ergonomie.

Si l'écran n'a pas de scénario, il en ajoute un. Le commentaire de l'issue donne le lien du scénario et ce que montre la capture. L'issue passe à Titouan et à la testeuse seulement en cas de **vrai doute important**, avec le lien du scénario. Voir [`ISSUES.md`](ISSUES.md).
