# Catalogue de tests et scoring

Référence technique du catalogue (catégories, tests, sous-tests), de la saisie des scores, des conversions d'échelle, de l'interprétation (écran et PDF) et des deltas de réévaluation. Les références renvoient à des fichiers et des fonctions ; l'état de la base a été relevé le 2026-09-23, puis mis à jour après les migrations du 2026-10-02. L'état des bugs est tenu dans [TECH_DEBT.md](TECH_DEBT.md).

Règle générale : un score se lit par le **score résolu** (`utils/resolvedScore.ts`, §6 bis), qui s'appuie sur les calculs et les zones de `utils/scoring.ts` et sur les noms et échelles de l'index du catalogue (`useCatalog().index`, `utils/catalogIndex.ts`). Ordre d'affichage dans `utils/subtestOrdering.ts`, données des graphiques et des tableaux du rapport dans `utils/reportData.ts`.

## 1. Modèle du catalogue

Hiérarchie : `official_categories` → `official_tests` → `official_subtests`. Le catalogue vient de Supabase. `data/testCatalog.ts` ne contient que les types (`CategoryDef`, `TestDef`, `SubtestDef`, `ScoreType`, `SubtestInputModel`, `SubtestInputConfig`) et `ICON_MAP` (icône lucide de chaque `icon_key`). En mode démo, sans session, le catalogue est `data/demoCatalog.ts` (voir §2).

**Contenu du catalogue officiel** : une partie a été saisie sans source et contient des sous-tests inventés. La vérification contre les protocoles publiés (2026-09-30, sources à l'appui) est dans [`catalogue/verification-2026-09-30.md`](./catalogue/verification-2026-09-30.md) ; les corrections certaines (7 sous-tests inventés retirés, EViC, Lespargot, DTVP-2, MABC-2, échelles, ordres, catégories) sont appliquées depuis le 2026-10-02 (`20261001100300_catalogue_corrections.sql`, #50) ; les manquants sourcés sont ajoutés depuis le 2026-10-02 (`20261002120000_catalogue_ajouts.sql`, #90), sauf les oublis, fausses alarmes et stratégie du Barrage des H, retirés le 2026-10-20 à la demande de la praticienne (`20261020100000_barrage_h_retrait.sql`, #101) ; les sous-tests douteux, le BOT-2, les points « à confirmer » et Jebsen-Taylor par main sont tranchés depuis le 2026-10-20 ([`catalogue/verification-2026-10-20.md`](./catalogue/verification-2026-10-20.md), `20261020200000_catalogue_douteux.sql`, #90 : sans source suffisante, une ligne est retirée). Tout ajout au catalogue cite sa source ; toute ligne retirée est ajoutée à `data/retiredCatalog.ts`.

- **Test officiel** : `organization_id IS NULL`. **Test perso** : `organization_id` = organisation du praticien.
- Les vues `view_unified_catalog` et `view_unified_subtests` sont en `security_invoker = on` depuis le 2026-10-02 (#57) : la RLS des tables s'applique (policy RESTRICTIVE `catalog_read_requires_onboarded`, GRANT SELECT par colonne à `authenticated`), en plus de leur propre filtre. Elles filtrent sur `is_current_user_onboarded()` et `check_is_member_of(organization_id)`. La vue des sous-tests ne garde en plus que `organization_id = caller_org_id OR organization_id IS NULL` (org de l'appelant = première ligne de `organization_members`).
- Base au 2026-09-23 : 10 catégories (`motricite-globale`, `ecriture`, `visuo-perceptif`, `sensoriel`, `attention-executif`, `autre`, `motricite-fine`, `avq-fonctionnel`, `cognition`, `lateralite`), 44 tests dont 2 perso, 329 sous-tests. Au 2026-10-02, après #49 (catégorie `lateralite` retirée) et #50 : 9 catégories, 44 tests (42 officiels), 345 sous-tests (342 officiels) ; un non admin voit les 42 tests et 342 sous-tests officiels plus ceux de son organisation.
- Répartition `score_type` : scaled 147, none 139, standard 24, t-score 17, percentile 2. Répartition `input_model` : numeric_4mode 324, raw_only 5. **Aucun** sous-test n'utilise `qualitative_category`, `custom_text` ou `computed_items` en base.
- Migration `20260929090606_retrait_harris_brut.sql` (#49) : le Test de Latéralité de Harris, seul utilisateur de `raw_only`, est supprimé avec sa catégorie `lateralite`, dont c'était le seul test, et la contrainte de `input_model` n'accepte plus que `numeric_4mode`, `qualitative_category` et `custom_text`.

Correspondance faite par `toSubtestDef` et `buildCatalog` (`contexts/CatalogContext.tsx`) :

| Colonne (vue)                                   | Type / contrainte                                                                                                                            | Mappé vers                                                          |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| catalog.`id`, `label`                           | text                                                                                                                                         | `TestDef.id`, `TestDef.name`                                        |
| catalog.`category_id`, `category_label`         | FK `official_categories`                                                                                                                     | `CategoryDef.id`, `.name`                                           |
| catalog.`icon_key`, `sort_order`                | issus de la catégorie                                                                                                                        | `CategoryDef.iconKey` (défaut `Box`), `.sortOrder` (défaut 99)      |
| catalog.`subtests_count`                        | calculé                                                                                                                                      | non chargé                                                          |
| subtests.`unit`                                 | text                                                                                                                                         | `unit` (défaut `'pts'`)                                             |
| subtests.`score_type`                           | NOT NULL, défaut `'none'` ; standard, scaled, t-score, t-score-inverse, v-scale, v-scale-inverse, scaled-15, percentile, sten, stanine, none | `scoreType`, via `resolveScaleType` (inconnu → `none`)              |
| subtests.`input_model`                          | NOT NULL, défaut `'numeric_4mode'` ; + qualitative_category, custom_text                                                                     | `inputModel` (`toInputModel` : valeur inconnue → `numeric_4mode`)   |
| subtests.`input_config`                         | jsonb NOT NULL, défaut `'{}'`                                                                                                                | `inputConfig`, validé par `toInputConfig` (clés inconnues ignorées) |
| subtests.`display_group_order`, `display_order` | integer                                                                                                                                      | `displayGroupOrder`, `displayOrder`                                 |

## 2. Chargement côté client

`contexts/CatalogContext.tsx` expose `catalog`, `index`, `loading`, `hasLoaded`, `ensureCatalogLoaded`, `reloadCatalog` et `searchTests`.

- **Déclenchement** : préchargement 1,2 s après l'entrée dans l'app (`App.tsx`, utilisateur authentifié, modes `dashboard`, `detail` ou `assessment`), puis `ensureCatalogLoaded()` à l'ouverture de `ScorePage`, `TestCatalogModal`, `ReportView`, `ExportPage` et au lancement d'un parcours avec bilan de référence (`loadCatalog`, `utils/assessmentInProgress.ts`).
- **`ensureCatalogLoaded`** ne charge qu'une fois et renvoie l'index à jour (utilisable juste après un `await`). **`reloadCatalog`** force un rechargement. Les appels simultanés sont dédoublonnés (`inFlightRef`).
- **Sans session** (mode démo) : `DEMO_CATALOG` (`data/demoCatalog.ts`) est chargé à la place. Il reprend les vrais identifiants et échelles de la base pour `bhk`, `mabc-2` et `test-cloches`, les tests utilisés par `data/demoData.ts`. Le catalogue est vidé à la déconnexion (`SIGNED_OUT`) et à la connexion d'un vrai utilisateur s'il s'agissait du catalogue démo.
- **Requêtes** (en parallèle) : `view_unified_catalog` (triée par `sort_order`, celui de la catégorie : l'ordre des tests dans une catégorie n'est pas garanti) et `view_unified_subtests`. En cas d'erreur, elle est journalisée et le catalogue reste en l'état ; le prochain `ensureCatalogLoaded` réessaiera.
- **Pas de pagination** : on dépend de la limite `max-rows` de PostgREST (1000 par défaut). 345 sous-tests au 2026-10-02.
- **Normalisations** : un `qualitative_category` sans options est rétrogradé en `custom_text`. Un test sans sous-test visible est ignoré. Les catégories sont triées par `sortOrder`.
- **`searchTests`** : score 4 si préfixe, 3 si début de mot, 2 si sous-chaîne ou nom normalisé (`utils/catalogNames.ts`) ; une correspondance sur un sous-test vaut −0,5.
- Pas de cache persistant : l'état est en mémoire et perdu au rechargement de la page.

**Index** (`utils/catalogIndex.ts`) : `buildCatalogIndex` construit une fois par chargement `testById`, `categoryByTestId`, `subtestByKey` (`testId:subtestId`) et `testIdBySubtestId`. Tous les écrans passent par `getSubtestDef`, `getTestName`, `getSubtestName` et `getScaleType` au lieu de reparcourir le catalogue. `CUSTOM_OBSERVATIONS_TEST_ID` (`custom_observations`) est le pseudo-test des observations libres, jamais présent dans le catalogue. Un test absent du catalogue s'affiche « Test personnalisé », avec une échelle `none`.

## 3. Modèles de saisie (`input_model`)

Un seul tableau de saisie, `ScoreTable` (`components/assessment/shared/ScoreTable.tsx`), sert au bilan initial et au bilan historique (`ScorePage`) comme à la réévaluation (`reevaluation/Step1Scores`, qui l'affiche en lecture seule à gauche et en saisie à droite). Les tests et sous-tests absents du catalogue (observations libres, test privé ou sous-test supprimé) reçoivent une définition de repli via `resolveTestDef` (`utils/catalogIndex.ts` : échelle `none`, `custom_text` pour les observations libres, `qualitative_category` dont la seule option est la valeur enregistrée pour un score qualitatif, sinon `numeric_4mode` ; nom d'origine pour un test ou sous-test officiel retiré, lu dans `data/retiredCatalog.ts` par `getTestName` et `getSubtestName`, sinon nom tiré de l'identifiant sans le préfixe `<testId>__`, ex. « Fausses alarmes »), dans `ScorePage` comme dans `Step1Scores` : aucun score enregistré n'est masqué.

| `input_model`          | Rendu dans `ScoreTable`                                                                                                    | `input_config` utile                                                        | Stocké dans `ScoreResult`                              |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------ |
| `numeric_4mode`        | Colonnes NS / ET / % (toutes, ou seulement celles passées dans `metrics`) + observation ; libellé de l'échelle sous le nom | `groupKey`, `groupHeaderLabel`, `groupOrder`, `orderIndex` (ordonnancement) | `value` + `unit` NS, ET ou %, `observation`            |
| `qualitative_category` | `<select>` des options triées par `order`                                                                                  | `options[] {code,label,order,reportText?}`                                  | `value=code`, `unit='qualitative'`, `qualitativeLabel` |
| `custom_text`          | Titre + zone de texte ; utilisé pour les observations libres (`custom_observations`)                                       | aucun                                                                       | `customLabel`, `observation`                           |

`computed_items` a été retiré du modèle client (P1-10), puis `raw_only` et la saisie brute (#49). Le tableau accepte le glisser-déposer des lignes (`sortable`, identifiants `sub:<testId>:<subtestId>`). Avec `onRemoveSubtest` (passé par `ScorePage`, pas par la réévaluation dont les deux tableaux doivent rester alignés), chaque ligne a une croix pour retirer l'épreuve. Les noms longs reviennent à la ligne.

**`score_type='none'`** : les colonnes NS / ET / % restent saisissables. Une NS tapée ne peut pas être convertie (pas d'échelle) : les autres colonnes restent vides et le rapport affiche la valeur saisie avec son unité (`display(mode)` du score résolu). Une saisie en ET ou en % reste convertible dans l'autre métrique, car la conversion ET ↔ % ne dépend pas de l'échelle.

**Ordonnancement** : `compareSubtestsForDisplay` (`utils/subtestOrdering.ts`) trie par ordre de groupe (colonne, puis `inputConfig.groupOrder`, sinon 900), libellé de groupe (config ou inféré du nom), clé de groupe, ordre (colonne, puis `orderIndex`, puis numéro extrait du nom, sinon 999) et enfin par nom (locale `fr`). Favoris et tests récents : `hooks/useFavoriteTests.ts` (localStorage `ergo_favorite_tests` limité à 20 entrées, `ergo_recent_tests` à 5).

## 4. Types d'échelle (`score_type`)

`SCALE_PARAMS` (`utils/scoring.ts`), libellés `SCALE_LABELS` (`utils/subtestOrdering.ts`) :

| `score_type`      | Moyenne | ET  | Bornes usuelles | Libellé UI                                  | Conversion                                                             |
| ----------------- | ------- | --- | --------------- | ------------------------------------------- | ---------------------------------------------------------------------- |
| `scaled`          | 10      | 3   | 1–19            | NS (m=10, σ=3)                              | paramétrique                                                           |
| `standard`        | 100     | 15  | 40–160          | QI (m=100, σ=15)                            | paramétrique                                                           |
| `t-score`         | 50      | 10  | 20–80           | T (m=50, σ=10)                              | paramétrique                                                           |
| `v-scale`         | 15      | 3   | 1–24            | Note v (m=15, σ=3)                          | paramétrique (Vineland, #90)                                           |
| `scaled-15`       | 15      | 5   | 0–35            | Note d’échelle (m=15, σ=5)                  | paramétrique (sous-tests BOT-2, #123)                                  |
| `t-score-inverse` | 50      | 10  | 20–80           | T (m=50, σ=10), note haute = difficulté     | paramétrique, sens inversé (BRIEF-2, SPM, #122)                        |
| `v-scale-inverse` | 15      | 3   | 1–24            | Note v (m=15, σ=3), note haute = difficulté | paramétrique, sens inversé (Vineland-3 Internalisé, Externalisé, #122) |
| `sten`            | 5,5     | 2   | 1–10            | Sten (m=5.5, σ=2)                           | paramétrique                                                           |
| `stanine`         | 5       | 2   | 1–9             | Stanine (m=5, σ=2)                          | paramétrique                                                           |
| `percentile`      | —       | —   | 1–99            | Rang percentile                             | la valeur « NS » est un rang centile                                   |
| `none`            | —       | —   | —               | Échelle non renseignée                      | NS non convertible ; ET ↔ % possible                                   |

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
| `formatZ`                                        | « +1.20 », pour les libellés des graphiques ; les scores sont formatés par le score résolu (§6 bis)                        |
| `hasScoreValue` / `pruneEmptyScores`             | un score a-t-il une valeur, une observation ou un titre ; retrait des sous-tests vides avant enregistrement                |

## 5. Stockage d'un score

`ScoreResult` (`types.ts`) : `value` (string), `unit` (`'NS'`, `'ET'`, `'%'` ou `'qualitative'`), `observation`, `qualitativeLabel`, `customLabel`. La règle est « dernière métrique saisie gagne » : chaque saisie dans `ScoreTable` envoie `{ value, unit }` pour la colonne tapée. Les autres colonnes sont recalculées à l'affichage par `deriveDisplayScores` et ne sont jamais persistées. Structure `TestData[testId][subtestId]`.

Flux d'une valeur, de la saisie au rendu :

```text
saisie NS "8" (sous-test scaled)
  → ScoreTable onChange → { value: "8", unit: "NS" }
  → updateTests → normalizeTestData                 utils/assessmentInProgress.ts
  → brouillon / bilan (JSON)                        tel quel, sans champ dérivé
     (buildAssessmentRecord retire les scores vides via pruneEmptyScores)
affichage
  → describeScore(index, testId, subtestId, res)    utils/resolvedScore.ts
      z = (8 − 10) / 3 = −0,667 ; % = round(Φ(z)·100) = 25   (utils/scoring.ts)
      zone normal (couleur verte) ; display() = "8 NS", display('ET') = "-0.67 ET"
```

**Compatibilité** : 14 champs legacy `@deprecated` restent déclarés dans `ScoreResult` (`raw`, `standard`, `percentile`, `zScore`, `status`, `validatedAt`, `certifiedAt`, `scoreSource`, `entryMetric`, `conversionMode`, `reviewState`, `reviewedAt`, `qualitativeCode`, `derived`) pour lire les anciens bilans ; le code n'en écrit aucun. `normalizeScoreResult` est idempotente : si `value` et `unit` sont présents, elle ne garde que les champs actuels. Sinon, la priorité est : `qualitativeCode` → `entryMetric` ou `scoreSource` (z, pct, raw) → `standard`, puis repli dans l'ordre zScore, percentile, raw. Le brut d'un score legacy qui a aussi une NS est perdu. Un brut retenu (ancien champ `raw`, ou `unit: 'raw'` enregistré avant #49) n'est plus un score : il devient le début de l'observation (`Brut : 12`). `normalizeTestData` et `normalizeFlatResults` l'appliquent à un `TestData` ou à un `results` plat. Points d'appel : le bilan en cours (`updateTests`, bilan de référence, reprise d'un brouillon) et `getAssessmentTests` (`utils/assessment.ts`), qui reconstruit aussi les `tests` des anciens bilans à partir de `results` (`rebuildTestsFromResults`, via `testIdBySubtestId`).

## 6. Zones d'interprétation et graphiques

**Un seul référentiel**, défini dans `utils/scoring.ts` et utilisé par la saisie, l'aperçu (`ReportView`) et le PDF (`PdfDocument`) :

| Zone      | Seuil z (`ZONE_Z_THRESHOLDS`) | Seuil percentile (`ZONE_PERCENTILE_THRESHOLDS`, dérivé) | Libellé (`ZONE_META`) |
| --------- | ----------------------------- | ------------------------------------------------------- | --------------------- |
| `deficit` | z ≤ −2                        | p ≤ Φ(−2) ≈ 2,3                                         | Zone de difficulté    |
| `fragile` | −2 < z ≤ −1                   | p ≤ Φ(−1) ≈ 15,9                                        | Zone de fragilité     |
| `normal`  | z > −1                        | au-delà                                                 | Dans la moyenne       |

`ZONE_META` porte aussi les couleurs (hex, communes à Recharts, au HTML et à `@react-pdf`) et les légendes. Les légendes percentile donnent les seuils réels (« inférieur ou égal à 2,3 », « entre 2,3 et 15,9 »). Les écrans prennent leurs classes Tailwind et leur dégradé de zone dans `components/assessment/shared/zoneStyles.ts` (`zoneColor`, `zoneTextClass`, `zoneRowClass`, `zoneGradient`).

**Règle de zone** : un score standardisé prend la zone de son z ; si le z n'est pas calculable (percentile 0 ou 100 saisi), celle de son percentile. Un score qualitatif, une observation ou un score vide n'a pas de zone. Au seuil, le z l'emporte : z = −1 est `fragile` même si son percentile arrondi (16) serait `normal`.

**Échelles inversées** (`t-score-inverse`, `v-scale-inverse`, `isHigherWorse`, #122) : une note haute y signale une difficulté. La saisie et l'affichage (`display`, `valueIn`, colonnes NS / ET / % du tableau) suivent le manuel : T 72 = +2,2 ET = 99 %. Le score résolu retourne son `z` et son `pct` (−2,2 et 1) : zone, graphiques, moyenne par test, radar, tendance de l'évolution et charge de l'IA lisent donc tous « négatif = difficulté ». Sur les graphiques, le libellé de ces sous-tests finit par ` *` et le guide de lecture l'explique (`DotChart.inverted`, `readingGuide(scale, inverted).note`) ; la charge de l'IA porte un champ `lecture`.

Les données des annexes sont calculées dans `utils/reportData.ts` ; l'aperçu et le PDF ne font que les rendre :

| Élément               | Fonction                                                    | Détail                                                                                                 |
| --------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Barres ET             | `computeDotChart('z')`, `readingGuide`                      | axe `Z_AXIS` de −3,5 à +3,5 (`zToFraction`), bandes de zone, zone de chaque sous-test, légende         |
| Percentiles           | `computeDotChart('percentile')`, `readingGuide`             | graduations `PERCENTILE_TICKS` (2, 16, 50, 84, 98), bandes de zone, zone du score résolu, légende      |
| Radar                 | `computeRadarData`                                          | moyenne des z par catégorie, bornée à ±3 (`RADAR_RANGE`) ; vide s'il y a moins de 3 catégories         |
| Tableaux de scores    | `buildTestScoreBlocks`                                      | lignes standardisées, lignes qualitatives (catégorie + `reportText`), notes des observations libres    |
| Évolution             | `buildTestScoreBlocks(…, previousTests)`                    | réévaluation : écart au bilan de référence dans la métrique affichée, tendance en z (`TREND_COLOR`)    |
| Valeur affichée       | `display(mode)` du score résolu                             | mode NS, ET ou % par test ; si la métrique demandée n'est pas calculable, valeur saisie avec son unité |
| Disposition des pages | `buildDefaultPages`, `reconcilePages`, `moveSectionInPages` | sections masquées : `HIDDEN_SECTION_IDS` (`objectifs`)                                                 |

Le type de graphique (`chartType`, défaut `bar`) et le mode d'affichage par test (`scoreDisplayModes`, défaut `ET`) sont enregistrés dans `BrandingConfig`, donc dans `practitioners.branding_config` (`ExportPage` → `updateBranding`). Les sous-tests sans z calculable (échelle `none` saisie en NS, qualitatif) n'apparaissent pas dans les graphiques.

## 6 bis. Score résolu

`utils/resolvedScore.ts` est le seul point d'entrée pour lire un score (voir `CONTEXT.md`). Il sert l'étape diagnostic, le résumé par test de la saisie, la lecture de l'échelle dans `ScoreTable`, les données du rapport et du PDF (`reportData`), la charge utile de l'IA (`buildScoresEvidence`, `buildScoresSummaryText`), les deltas et la consultation d'un bilan finalisé.

| Fonction                                         | Rôle                                                                                                                                                    |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `resolveScores(tests, index)`                    | scores regroupés par test, dans l'ordre enregistré : nom, catégorie, moyenne z (`meanZ`), sous-tests qui ont une donnée ; les tests sans donnée restent |
| `describeScore(index, testId, subtestId, score)` | un score résolu : libellé, test, échelle, définition, métrique saisie, z, percentile, zone, `valueIn(métrique)`, `display(mode)`                        |
| `formatMetricValue(valeur, métrique, signé?)`    | format unique : `85 NS`, `+1.2 ET` (2 décimales au plus, ET toujours signé), `42 %` ; `signé` pour un écart (`+5 NS`)                                   |

`display()` rend la valeur dans la métrique saisie, `display(mode)` dans la métrique demandée si elle est calculable (sinon la valeur saisie). Un score qualitatif affiche son libellé, un score vide `—`.

## 7. Deltas de réévaluation

Fonctions de `utils/reevaluationHelpers.ts`, affichage par `components/assessment/shared/DeltaTable.tsx`.

- **Scores de départ** : la réévaluation démarre avec les tests et sous-tests du bilan de référence, **sans valeur** (`buildEmptyTestsFrom`, `utils/assessment.ts`, appelé par `start`, `utils/assessmentInProgress.ts`). Le bilan de référence est le dernier bilan (`getLatestFormalAssessment`). Le praticien peut retirer un test, pas en ajouter.
- **Métrique affichée** : `Step1Scores` n'affiche, pour chaque test, qu'une colonne : la métrique la plus utilisée dans le bilan de référence (`dominantMetric`, ET en cas d'égalité).
- **`buildDeltaEntries`** : pour chaque sous-test, la métrique est celle du score précédent (sinon celle du nouveau). `prevValue` et `newValue` sont exprimés dans cette métrique (`valueIn` du score résolu) : un score saisi dans une autre métrique est converti avec l'échelle du sous-test, ou vaut `null` si l'échelle est inconnue. `delta` est leur différence. Les scores qualitatifs ne sont pas comparés.
- **Tendance en unités z** : `zDelta` = z(nouveau) − z(précédent), calculé avec l'échelle du sous-test. `trendFromZDelta` classe en amélioration au-delà de +0,5, régression en deçà de −0,5, stable entre les deux (`STABILITY_THRESHOLD_Z` = 0,5 ET, soit 1,5 point en NS scaled et 7,5 points en QI). Sans z calculable (échelle `none` saisie en NS), aucune tendance n'est affichée.
- **Non mesuré** : un sous-test resté vide a `measured = false` et s'affiche « non mesuré » ; mesuré mais non convertible, il s'affiche « non comparable ». `buildDeltaStats` compte `improved`, `stable`, `declined` et `notMeasured`.
- **Textes pour l'IA** : `buildScoresSummaryText` (scores d'un bilan) et `buildEvolutionSummaryText` (delta dans la métrique, delta en ET et tendance).
- **Affichage** : `DeltaTable` et `buildEvolutionSummaryText` formatent valeurs et écarts avec `formatMetricValue` (`90 NS`, écart signé `+5 NS`) ; l'infobulle du delta donne `zDelta`.

Un score précédent saisi dans une autre métrique que la métrique dominante du test est ressaisi dans la métrique dominante, puis converti pour la comparaison. Dans l'aperçu et le PDF de réévaluation, chaque ligne de score porte une colonne « Évolution » : écart dans la métrique affichée et tendance (amélioration, stable, régression), « — » quand il n'y a rien à comparer (test absent du bilan de référence, autre échelle, non mesuré).

## 8. Tests personnalisés

Parcours : bouton « Créer un test » du `TestCatalogModal` (`components/assessment/pages/score/TestCatalogModal.tsx`) → `CustomTestEditor` (`components/assessment/shared/CustomTestEditor.tsx`). Le formulaire saisit nom, abréviation et sous-tests (nom, abréviation, échelle). Côté client : catégorie `autre`, échelle par défaut `none` (« Sans score standardisé »). Il appelle `AdminService.saveCustomTest`, qui lance le RPC `practitioner_save_custom_test`, puis `reloadCatalog()` pour que le test soit sélectionnable tout de suite.

Fonction SQL (SECURITY DEFINER, relevée en base) : org = première ligne de `organization_members` ; `category_id` inexistant → repli `'autre'` ; test `version '1.0'`, `author 'practitioner'` ; sous-tests `score_type` défaut `'none'`, `input_model` défaut `'numeric_4mode'`, `unit 'pts'`, `display_order` = index. `abbreviation` et `order_index` du payload sont ignorés.

La fonction est exécutable par `authenticated` depuis la migration `20260925082729_fix_client_rpc_grants.sql` (appliquée le 2026-09-25, P1-1).

## 9. Administration du catalogue

`components/admin/AdminLibrary.tsx` + `AdminService` (`services/admin.ts`) ; RPC SECURITY DEFINER protégées par `check_is_admin()`.

| Action                     | `AdminService`                                                | RPC                                                | Remarques                                                                                                                                             |
| -------------------------- | ------------------------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lister                     | `listTests(scope)`                                            | `admin_list_tests(p_scope)` public, private ou all |                                                                                                                                                       |
| Détail                     | `loadTestDetail`                                              | `admin_get_test_detail`                            |                                                                                                                                                       |
| Enregistrer                | `saveTestDetail`                                              | `admin_save_test_detail`                           | Le client envoie `score_type ?? 'none'`, `input_model ?? 'numeric_4mode'`, `input_config ?? {}`. Mêmes défauts côté SQL (migration `20260925082729`). |
| Supprimer test / sous-test | `deleteTest`, `deleteSubtest`                                 | `admin_delete_test`, `admin_delete_subtest`        |                                                                                                                                                       |
| Catégories                 | — (lecture directe `official_categories` dans `AdminLibrary`) | —                                                  |                                                                                                                                                       |

Un nouveau sous-test reçoit `score_type: 'none'` et `input_model: 'numeric_4mode'`. L'UI n'édite que `score_type` : ni `input_model` ni `input_config`.

## 10. Points ouverts

L'état de chaque point est dans [TECH_DEBT.md](TECH_DEBT.md). Restent notamment, pour ce module :

1. Création de test perso bloquée en production jusqu'à l'application de `20260925082729` (P1-1) ; même migration pour les défauts de `admin_save_test_detail` (P1-14).
2. Deltas absents du PDF, et pas d'ajout de test pendant une réévaluation (P1-15).
3. Pas de pagination du catalogue (limite PostgREST de 1000 lignes) ni de cache persistant (§2).
