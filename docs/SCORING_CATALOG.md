# Catalogue de tests et scoring

Référence technique du catalogue (catégories, tests, sous-tests), de la saisie des scores, des conversions d'échelle, de l'interprétation (écran et PDF) et des deltas de réévaluation. Les références renvoient à des fichiers et des fonctions ; l'état de la base a été relevé le 2026-09-23. L'état des bugs est tenu dans [TECH_DEBT.md](TECH_DEBT.md).

Règle générale : calculs et zones dans `utils/scoring.ts`, noms et échelles via l'index du catalogue (`useCatalog().index`, `utils/catalogIndex.ts`), ordre d'affichage dans `utils/subtestOrdering.ts`, données des graphiques et des tableaux du rapport dans `utils/reportData.ts`.

## 1. Modèle du catalogue

Hiérarchie : `official_categories` → `official_tests` → `official_subtests`. Le catalogue vient de Supabase. `data/testCatalog.ts` ne contient que les types (`CategoryDef`, `TestDef`, `SubtestDef`, `ScoreType`, `SubtestInputModel`, `SubtestInputConfig`) et `ICON_MAP` (icône lucide de chaque `icon_key`). En mode démo, sans session, le catalogue est `data/demoCatalog.ts` (voir §2).

- **Test officiel** : `organization_id IS NULL`. **Test perso** : `organization_id` = organisation du praticien.
- Les vues `view_unified_catalog` et `view_unified_subtests` filtrent sur `is_current_user_onboarded()` et `check_is_member_of(organization_id)`. La vue des sous-tests ne garde en plus que `organization_id = caller_org_id OR organization_id IS NULL` (org de l'appelant = première ligne de `organization_members`).
- Base au 2026-09-23 : 10 catégories (`motricite-globale`, `ecriture`, `visuo-perceptif`, `sensoriel`, `attention-executif`, `autre`, `motricite-fine`, `avq-fonctionnel`, `cognition`, `lateralite`), 44 tests dont 2 perso, 329 sous-tests.
- Répartition `score_type` : scaled 147, none 139, standard 24, t-score 17, percentile 2. Répartition `input_model` : numeric_4mode 324, raw_only 5. **Aucun** sous-test n'utilise `qualitative_category`, `custom_text` ou `computed_items` en base.

Correspondance faite par `toSubtestDef` et `buildCatalog` (`contexts/CatalogContext.tsx`) :

| Colonne (vue)                                   | Type / contrainte                                                                                  | Mappé vers                                                                               |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| catalog.`id`, `label`                           | text                                                                                               | `TestDef.id`, `TestDef.name`                                                             |
| catalog.`category_id`, `category_label`         | FK `official_categories`                                                                           | `CategoryDef.id`, `.name`                                                                |
| catalog.`icon_key`, `sort_order`                | issus de la catégorie                                                                              | `CategoryDef.iconKey` (défaut `Box`), `.sortOrder` (défaut 99)                           |
| catalog.`subtests_count`                        | calculé                                                                                            | lu mais non utilisé                                                                      |
| subtests.`unit`                                 | text                                                                                               | `unit` (défaut `'pts'`)                                                                  |
| subtests.`score_type`                           | NOT NULL, défaut `'none'` ; standard, scaled, t-score, percentile, sten, stanine, none             | `scoreType`, via `resolveScaleType` (inconnu → `none`)                                   |
| subtests.`input_model`                          | NOT NULL, défaut `'numeric_4mode'` ; + qualitative_category, raw_only, custom_text, computed_items | `inputModel` (`toInputModel` : valeur inconnue, dont `computed_items` → `numeric_4mode`) |
| subtests.`input_config`                         | jsonb NOT NULL, défaut `'{}'`                                                                      | `inputConfig`, validé par `toInputConfig` (clés inconnues ignorées)                      |
| subtests.`display_group_order`, `display_order` | integer                                                                                            | `displayGroupOrder`, `displayOrder`                                                      |

`SubtestDef.displayName` existe dans le type mais n'est renseigné nulle part (les fonctions d'affichage retombent sur `name`).

## 2. Chargement côté client

`contexts/CatalogContext.tsx` expose `catalog`, `index`, `loading`, `hasLoaded`, `ensureCatalogLoaded`, `reloadCatalog` et `searchTests`.

- **Déclenchement** : préchargement 1,2 s après l'entrée dans l'app (`App.tsx`, utilisateur authentifié, modes `dashboard`, `detail` ou `assessment`), puis `ensureCatalogLoaded()` à l'ouverture de `ScorePage`, `TestCatalogModal`, `ReportView`, `ExportPage` et au lancement d'un parcours (`hooks/useAssessmentLauncher.ts`).
- **`ensureCatalogLoaded`** ne charge qu'une fois et renvoie l'index à jour (utilisable juste après un `await`). **`reloadCatalog`** force un rechargement. Les appels simultanés sont dédoublonnés (`inFlightRef`).
- **Sans session** (mode démo) : `DEMO_CATALOG` (`data/demoCatalog.ts`) est chargé à la place. Il reprend les vrais identifiants et échelles de la base pour `bhk`, `mabc-2` et `test-cloches`, les tests utilisés par `data/demoData.ts`. Le catalogue est vidé à la déconnexion (`SIGNED_OUT`) et à la connexion d'un vrai utilisateur s'il s'agissait du catalogue démo.
- **Requêtes** (en parallèle) : `view_unified_catalog` (triée par `sort_order`, celui de la catégorie : l'ordre des tests dans une catégorie n'est pas garanti) et `view_unified_subtests`. En cas d'erreur, elle est journalisée et le catalogue reste en l'état ; le prochain `ensureCatalogLoaded` réessaiera.
- **Pas de pagination** : on dépend de la limite `max-rows` de PostgREST (1000 par défaut). 329 sous-tests aujourd'hui.
- **Normalisations** : un `qualitative_category` sans options est rétrogradé en `raw_only`. Un test sans sous-test visible est ignoré. Les catégories sont triées par `sortOrder`.
- **`searchTests`** : score 4 si préfixe, 3 si début de mot, 2 si sous-chaîne ou nom normalisé (`utils/catalogNames.ts`) ; une correspondance sur un sous-test vaut −0,5.
- Pas de cache persistant : l'état est en mémoire et perdu au rechargement de la page.

**Index** (`utils/catalogIndex.ts`) : `buildCatalogIndex` construit une fois par chargement `testById`, `categoryByTestId`, `subtestByKey` (`testId:subtestId`) et `testIdBySubtestId`. Tous les écrans passent par `getSubtestDef`, `getTestName`, `getSubtestName` et `getScaleType` au lieu de reparcourir le catalogue. `CUSTOM_OBSERVATIONS_TEST_ID` (`custom_observations`) est le pseudo-test des observations libres, jamais présent dans le catalogue. Un test absent du catalogue s'affiche « Test personnalisé », avec une échelle `none`.

## 3. Modèles de saisie (`input_model`)

Un seul tableau de saisie, `ScoreTable` (`components/assessment/shared/ScoreTable.tsx`), sert au bilan initial et au bilan historique (`ScorePage`) comme à la réévaluation (`reevaluation/Step1Scores`, qui l'affiche en lecture seule à gauche et en saisie à droite). Les tests et sous-tests absents du catalogue (observations libres, test privé ou sous-test supprimé) reçoivent une définition de repli via `resolveTestDef` (`utils/catalogIndex.ts` : échelle `none`, `custom_text` pour les observations libres, sinon `numeric_4mode`), dans `ScorePage` comme dans `Step1Scores` : aucun score enregistré n'est masqué.

| `input_model`          | Rendu dans `ScoreTable`                                                                                                    | `input_config` utile                                                        | Stocké dans `ScoreResult`                              |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------ |
| `numeric_4mode`        | Colonnes NS / ET / % (toutes, ou seulement celles passées dans `metrics`) + observation ; libellé de l'échelle sous le nom | `groupKey`, `groupHeaderLabel`, `groupOrder`, `orderIndex` (ordonnancement) | `value` + `unit` NS, ET ou %, `observation`            |
| `qualitative_category` | `<select>` des options triées par `order`                                                                                  | `options[] {code,label,order,reportText?}`                                  | `value=code`, `unit='qualitative'`, `qualitativeLabel` |
| `raw_only`             | Champ « Brut » saisissable sur toute la largeur des colonnes de métrique, suivi de l'unité du sous-test                    | aucun                                                                       | `value` + `unit='raw'`, `observation`                  |
| `custom_text`          | Titre + zone de texte ; utilisé pour les observations libres (`custom_observations`)                                       | aucun                                                                       | `customLabel`, `observation`                           |

`computed_items` a été retiré du modèle client (P1-10). Le tableau accepte le glisser-déposer des lignes (`sortable`, identifiants `sub:<testId>:<subtestId>`).

**`score_type='none'`** : les colonnes NS / ET / % restent saisissables. Une NS tapée ne peut pas être convertie (pas d'échelle) : les autres colonnes restent vides et le rapport affiche la valeur saisie avec son unité (`formatScoreForMode`). Une saisie en ET ou en % reste convertible dans l'autre métrique, car la conversion ET ↔ % ne dépend pas de l'échelle.

**Ordonnancement** : `compareSubtestsForDisplay` (`utils/subtestOrdering.ts`) trie par ordre de groupe (colonne, puis `inputConfig.groupOrder`, sinon 900), libellé de groupe (config ou inféré du nom), clé de groupe, ordre (colonne, puis `orderIndex`, puis numéro extrait du nom, sinon 999) et enfin par nom (locale `fr`). Favoris et tests récents : `hooks/useFavoriteTests.ts` (localStorage `ergo_favorite_tests` limité à 20 entrées, `ergo_recent_tests` à 5).

## 4. Types d'échelle (`score_type`)

`SCALE_PARAMS` (`utils/scoring.ts`), libellés `SCALE_LABELS` (`utils/subtestOrdering.ts`) :

| `score_type` | Moyenne | ET  | Bornes usuelles | Libellé UI             | Conversion                           |
| ------------ | ------- | --- | --------------- | ---------------------- | ------------------------------------ |
| `scaled`     | 10      | 3   | 1–19            | NS (m=10, σ=3)         | paramétrique                         |
| `standard`   | 100     | 15  | 40–160          | QI (m=100, σ=15)       | paramétrique                         |
| `t-score`    | 50      | 10  | 20–80           | T (m=50, σ=10)         | paramétrique                         |
| `sten`       | 5,5     | 2   | 1–10            | Sten (m=5.5, σ=2)      | paramétrique                         |
| `stanine`    | 5       | 2   | 1–9             | Stanine (m=5, σ=2)     | paramétrique                         |
| `percentile` | —       | —   | 1–99            | Rang percentile        | la valeur « NS » est un rang centile |
| `none`       | —       | —   | —               | Échelle non renseignée | NS non convertible ; ET ↔ % possible |

Aucune borne n'est validée à la saisie. Fonctions de `utils/scoring.ts` :

| Fonction                                         | Rôle                                                                                                                       |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `parseNum`                                       | parse avec virgule décimale                                                                                                |
| `resolveScaleType` / `isUnscaled`                | normalise un libellé d'échelle (alias `ns`, `tscore`, `pct`…) ; **valeur inconnue ou absente → `none`**, jamais `standard` |
| `normalCDF` / `invNormalCDF`                     | approximations d'Abramowitz-Stegun et rationnelle                                                                          |
| `deriveScores(value, metric, scaleType)`         | z = (NS − m)/σ ; NS = round(z·σ + m) ; % = round(Φ(z)·100) ; percentile hors ]0,100[ → pas de z                            |
| `unitToMetric` / `metricToUnit`                  | NS ↔ `standard`, ET ↔ `z`, % ↔ `percentile`                                                                                |
| `deriveDisplayScores`                            | valeurs dérivées d'un `{ value, unit }` pour l'affichage (jamais persistées)                                               |
| `getZFromScore` / `getPercentileFromScore`       | z et rang percentile d'un score stocké (`null` si incalculable)                                                            |
| `zoneFromZ` / `zoneFromPercentile` / `ZONE_META` | zones d'interprétation (§6)                                                                                                |
| `zToneClass` / `zoneRowClass`                    | classes Tailwind des cellules et lignes du tableau de saisie                                                               |
| `formatZ` / `formatScoreCompact`                 | « +1.20 » ; « NS 85 », « ET +1.2 », « 42 % », « Brut 12 », libellé qualitatif                                              |
| `hasScoreValue` / `pruneEmptyScores`             | un score a-t-il une valeur, une observation ou un titre ; retrait des sous-tests vides avant enregistrement                |

## 5. Stockage d'un score

`ScoreResult` (`types.ts`) : `value` (string), `unit` (`'NS'`, `'ET'`, `'%'`, `'qualitative'` ou `'raw'`), `observation`, `qualitativeLabel`, `customLabel`. La règle est « dernière métrique saisie gagne » : chaque saisie dans `ScoreTable` envoie `{ value, unit }` pour la colonne tapée. Les autres colonnes sont recalculées à l'affichage par `deriveDisplayScores` et ne sont jamais persistées. Structure `TestData[testId][subtestId]`.

Flux d'une valeur, de la saisie au rendu :

```text
saisie NS "8" (sous-test scaled)
  → ScoreTable onChange → { value: "8", unit: "NS" }
  → updateTests → normalizeTestData                 contexts/AssessmentContext.tsx
  → brouillon / bilan (JSON)                        tel quel, sans champ dérivé
     (buildAssessmentRecord retire les scores vides via pruneEmptyScores)
affichage
  → deriveDisplayScores(res, "scaled")              utils/scoring.ts
      z = (8 − 10) / 3 = −0,667 ; % = round(Φ(z)·100) = 25
  → zoneFromZ(−0,667) = normal                      couleur verte
```

**Compatibilité** : 14 champs legacy `@deprecated` restent déclarés dans `ScoreResult` (`raw`, `standard`, `percentile`, `zScore`, `status`, `validatedAt`, `certifiedAt`, `scoreSource`, `entryMetric`, `conversionMode`, `reviewState`, `reviewedAt`, `qualitativeCode`, `derived`) pour lire les anciens bilans ; le code n'en écrit aucun. `normalizeScoreResult` est idempotente : si `value` et `unit` sont présents, elle ne garde que les champs actuels. Sinon, la priorité est : `qualitativeCode` → `entryMetric` ou `scoreSource` (z, pct, raw) → `standard`, puis repli dans l'ordre zScore, percentile, raw. Le brut d'un score legacy qui a aussi une NS est perdu. `normalizeTestData` et `normalizeFlatResults` l'appliquent à un `TestData` ou à un `results` plat. Points d'appel : `AssessmentContext` (`updateTests`, bilan précédent, reprise d'un brouillon) et `getAssessmentTests` (`utils/assessment.ts`), qui reconstruit aussi les `tests` des anciens bilans à partir de `results` (`rebuildTestsFromResults`, via `testIdBySubtestId`).

## 6. Zones d'interprétation et graphiques

**Un seul référentiel**, défini dans `utils/scoring.ts` et utilisé par la saisie, l'aperçu (`ReportView`) et le PDF (`PdfDocument`) :

| Zone      | Seuil z (`ZONE_Z_THRESHOLDS`) | Seuil percentile (`ZONE_PERCENTILE_THRESHOLDS`, dérivé) | Libellé (`ZONE_META`) |
| --------- | ----------------------------- | ------------------------------------------------------- | --------------------- |
| `deficit` | z ≤ −2                        | p ≤ Φ(−2) ≈ 2,3                                         | Zone de difficulté    |
| `fragile` | −2 < z ≤ −1                   | p ≤ Φ(−1) ≈ 15,9                                        | Zone de fragilité     |
| `normal`  | z > −1                        | au-delà                                                 | Dans la moyenne       |

`ZONE_META` porte aussi les couleurs (hex, communes à Recharts, au HTML et à `@react-pdf`) et les légendes. Les légendes percentile donnent les seuils réels (« inférieur ou égal à 2,3 », « entre 2,3 et 15,9 »).

Les données des annexes sont calculées dans `utils/reportData.ts` ; l'aperçu et le PDF ne font que les rendre :

| Élément               | Fonction                                                    | Détail                                                                                                 |
| --------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Barres ET             | `computeZChartItems`                                        | axe `Z_AXIS` de −3,5 à +3,5 (`zToFraction`), zone de chaque sous-test                                  |
| Percentiles           | `computePercentileChartItems`                               | graduations `PERCENTILE_TICKS` (2, 16, 50, 84, 98), zone par `zoneFromPercentile`                      |
| Radar                 | `computeRadarData`                                          | moyenne des z par catégorie, bornée à ±3 (`RADAR_RANGE`) ; vide s'il y a moins de 3 catégories         |
| Tableaux de scores    | `buildTestScoreBlocks`                                      | lignes standardisées, lignes qualitatives (catégorie + `reportText`), notes des observations libres    |
| Valeur affichée       | `formatScoreForMode`                                        | mode NS, ET ou % par test ; si la métrique demandée n'est pas calculable, valeur saisie avec son unité |
| Disposition des pages | `buildDefaultPages`, `reconcilePages`, `moveSectionInPages` | sections masquées : `HIDDEN_SECTION_IDS` (`objectifs`)                                                 |

Le type de graphique (`chartType`, défaut `bar`) et le mode d'affichage par test (`scoreDisplayModes`, défaut `ET`) sont enregistrés dans `BrandingConfig`, donc dans `practitioners.branding_config` (`ExportPage` → `updateBranding`). Les sous-tests sans z calculable (échelle `none` saisie en NS, brut, qualitatif) n'apparaissent pas dans les graphiques.

## 7. Deltas de réévaluation

Fonctions de `utils/reevaluationHelpers.ts`, affichage par `components/assessment/shared/DeltaTable.tsx`.

- **Scores de départ** : la réévaluation démarre avec les tests et sous-tests du bilan de référence, **sans valeur** (`buildEmptyTestsFrom`, `utils/assessment.ts`, appelé par `useAssessmentLauncher`). Le bilan de référence est le dernier bilan formel (`getLatestFormalAssessment`). Le praticien peut retirer un test, pas en ajouter.
- **Métrique affichée** : `Step1Scores` n'affiche, pour chaque test, qu'une colonne : la métrique la plus utilisée dans le bilan précédent (`dominantMetric`, ET en cas d'égalité). Les sous-tests `raw_only` gardent leur champ « Brut ».
- **`buildDeltaEntries`** : pour chaque sous-test, la métrique est celle du score précédent (sinon celle du nouveau). `prevValue` et `newValue` sont exprimés dans cette métrique (`extractMetricValue`) : un score saisi dans une autre métrique est converti avec l'échelle du sous-test, ou vaut `null` si l'échelle est inconnue. `delta` est leur différence. Les scores bruts ou qualitatifs ne sont pas comparés.
- **Tendance en unités z** : `zDelta` = z(nouveau) − z(précédent), calculé avec l'échelle du sous-test. `trendFromZDelta` classe en amélioration au-delà de +0,5, régression en deçà de −0,5, stable entre les deux (`STABILITY_THRESHOLD_Z` = 0,5 ET, soit 1,5 point en NS scaled et 7,5 points en QI). Sans z calculable (échelle `none` saisie en NS), aucune tendance n'est affichée.
- **Non mesuré** : un sous-test resté vide a `measured = false` et s'affiche « non mesuré » ; mesuré mais non convertible, il s'affiche « non comparable ». `buildDeltaStats` compte `improved`, `stable`, `declined` et `notMeasured`.
- **Textes pour l'IA** : `buildScoresSummaryText` (scores d'un bilan) et `buildEvolutionSummaryText` (delta dans la métrique, delta en ET et tendance).
- **Affichage** : `DeltaTable` montre les valeurs ET avec 2 décimales et les deltas avec 1 décimale ; l'infobulle du delta donne `zDelta`.

Un score précédent saisi dans une autre métrique que la métrique dominante du test est ressaisi dans la métrique dominante, puis converti pour la comparaison. Les deltas ne figurent pas dans le PDF (P1-15).

## 8. Tests personnalisés

Parcours : bouton « Créer un test » du `TestCatalogModal` (`components/assessment/pages/score/TestCatalogModal.tsx`) → `CustomTestEditor` (`components/assessment/shared/CustomTestEditor.tsx`). Le formulaire saisit nom, abréviation et sous-tests (nom, abréviation, échelle). Côté client : catégorie `autre`, échelle par défaut `none` (« Sans score standardisé »). Il appelle `AdminService.saveCustomTest`, qui lance le RPC `practitioner_save_custom_test`, puis `reloadCatalog()` pour que le test soit sélectionnable tout de suite.

Fonction SQL (SECURITY DEFINER, relevée en base) : org = première ligne de `organization_members` ; `category_id` inexistant → repli `'autre'` ; test `version '1.0'`, `author 'practitioner'` ; sous-tests `score_type` défaut `'none'`, `input_model` défaut `'numeric_4mode'`, `unit 'pts'`, `display_order` = index. `abbreviation` et `order_index` du payload sont ignorés.

La fonction est exécutable par `authenticated` depuis la migration `20260924100000_fix_client_rpc_grants.sql` (appliquée le 2026-09-25, P1-1).

## 9. Administration du catalogue

`components/admin/AdminLibrary.tsx` + `AdminService` (`services/admin.ts`) ; RPC SECURITY DEFINER protégées par `check_is_admin()`.

| Action                     | `AdminService`                                                | RPC                                                | Remarques                                                                                                                                             |
| -------------------------- | ------------------------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lister                     | `listTests(scope)`                                            | `admin_list_tests(p_scope)` public, private ou all |                                                                                                                                                       |
| Détail                     | `loadTestDetail`                                              | `admin_get_test_detail`                            |                                                                                                                                                       |
| Enregistrer                | `saveTestDetail`                                              | `admin_save_test_detail`                           | Le client envoie `score_type ?? 'none'`, `input_model ?? 'numeric_4mode'`, `input_config ?? {}`. Mêmes défauts côté SQL (migration `20260924100000`). |
| Supprimer test / sous-test | `deleteTest`, `deleteSubtest`                                 | `admin_delete_test`, `admin_delete_subtest`        |                                                                                                                                                       |
| Catégories                 | — (lecture directe `official_categories` dans `AdminLibrary`) | —                                                  |                                                                                                                                                       |

Un nouveau sous-test reçoit `score_type: 'none'` et `input_model: 'numeric_4mode'`. L'UI n'édite que `score_type` : ni `input_model` ni `input_config`.

## 10. Points ouverts

L'état de chaque point est dans [TECH_DEBT.md](TECH_DEBT.md). Restent notamment, pour ce module :

1. Création de test perso bloquée en production jusqu'à l'application de `20260924100000` (P1-1) ; même migration pour les défauts de `admin_save_test_detail` (P1-14).
2. Deltas absents du PDF, et pas d'ajout de test pendant une réévaluation (P1-15).
3. Pas de pagination du catalogue (limite PostgREST de 1000 lignes) ni de cache persistant (§2).
4. `SubtestDef.displayName` n'est jamais renseigné et `subtests_count` est chargé sans être utilisé (P2-10).
