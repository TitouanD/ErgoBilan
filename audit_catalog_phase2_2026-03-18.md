# Audit Catalogue — Phase 2 (2026-03-18)

## Objectif
Validation exhaustive 1-à-1 des tests/sous-tests côté Supabase (noms, ordre, score_type et champs clés), avec focus clinique sur MABC-2, NEPSY 2, Figure Complexe de Rey, DTVP-A et Lespargot.

## Méthode
- Source de vérité: `official_tests`, `official_subtests`, `official_norms`.
- Contrôles automatiques:
  - présence sous-tests par test,
  - doublons de noms de sous-tests (par test),
  - cohérence `score_type` ↔ `computation_mode`,
  - sous-tests `LOOKUP` sans normes,
  - présence d’ordre d’affichage (`groupOrder`, `orderIndex`) pour les tests corrigés.
- Contrôle externe ciblé (Tavily): MABC-2, DTVP-A, Rey.

## Correctifs appliqués pendant phase 2
- Migrations appliquées:
  - `catalog_naming_phase1`
  - `mabc2_missing_requested_subtests`
  - `fix_none_score_computation_mode`
  - `catalog_quality_checks`
- Fichiers SQL repo:
  - `supabase/migrations/20260318000100_catalog_naming_phase1.sql`
  - `supabase/migrations/20260318000110_mabc2_missing_requested_subtests.sql`
  - `supabase/migrations/20260318000120_fix_none_score_computation_mode.sql`
  - `supabase/migrations/20260318000130_catalog_quality_checks.sql`

## Correctifs appliqués pendant phase 3 (complétion publique)
- Migration appliquée:
  - `fill_public_subtests_phase3`
- Fichier SQL repo:
  - `supabase/migrations/20260318000140_fill_public_subtests_phase3.sql`
- Sous-tests ajoutés (sources publiques, sans normes propriétaires):
  - AMPS, DTVP-3, Échelle de Charlop-Atwell, FROSTIG, LOTCA, MVPT-4, NEPSY, NP-MOT, PDMS-2, PEDI-CAT,
    Profil Sensoriel 2, Reversal Test, SPM, TEA-Ch, Test de l'Alouette, TIHM, Vineland-3, WISC-V.
- Choix de modélisation: `score_type='none'` + `computation_mode='NONE'` pour éviter d’introduire de faux calculs sans normes.

## Correctifs complémentaires (phases suivantes)
- Catalogue front: les tests sans sous-tests ne sont plus injectés dans le catalogue praticien (`CatalogContext`), pour éviter l’ajout de tests non configurés.
- Parsing UI: `groupOrder` et `orderIndex` sont désormais lus depuis `input_config` pour appliquer l’ordre clinique déterministe.
- Contrôle qualité DB: ajout d’une vue `view_catalog_quality_issues` + fonction `admin_catalog_quality_summary()`.

## Vérifications critiques (demande testeuse)

### MABC-2
- ✅ Sous-test manquant ajouté: `Retourner les chevilles main non préférée`.
- ✅ Ordre structuré par groupe d’âge + domaine injecté via `groupOrder` / `orderIndex`.
- ✅ Libellés harmonisés (ex. `Enfiler les cubes`, `Suivre le trajet 1/2/3`, `Lancer la balle sur la cible`, composites `Note totale ...`).
- ⚠️ 12 sous-tests `LOOKUP` sans normes associées à date (à compléter données normatives).

### NEPSY 2
- ✅ Ajout `Cubes` et `Flèches`.
- ⚠️ 11/11 sous-tests actuels en `LOOKUP` sans normes (catalogue prêt en nomenclature, scoring à compléter par import de normes).

### Figure Complexe de Rey
- ✅ Sous-tests ajoutés dans l’ordre demandé (Copie du modèle, Type de copie, Richesse/exactitude copie, Temps de copie, Reproduction de mémoire, Type de reproduction, Richesse/exactitude reproduction).
- ⚠️ 5 sous-tests `LOOKUP` sans normes (les items `PARAMETRIC` ne sont pas comptés dans cet indicateur).

### DTVP-A
- ✅ Sous-tests renommés au format demandé `Subtest N, ...` et ordonnés 1→6.
- ✅ `score_type/computation_mode/input_model` cohérents.

### Lespargot
- ✅ Nom test corrigé: `Lespargot`.
- ✅ Sous-tests corrigés: `Répétition`, `Dictée`, `Copie`.
- ✅ Ordre explicite (`orderIndex` 1→3).

## Comparaison directe: commentaire testeuse vs état actuel

### 1) Noms de tests
- **Attendu testeuse**: MABC-2, NEPSY 2, Figure Complexe de Rey, DTVP-A, Lespargot.
- **Actuel DB**: conforme à 100% sur les libellés de test (`official_tests.name`).

### 2) Noms de sous-tests (point principal demandé)
- **DTVP-A**: conforme (nomenclature `Subtest 1..6` + intitulés attendus).
- **Figure Complexe de Rey**: conforme (7 sous-tests nommés comme demandé).
- **Lespargot**: conforme (`Répétition`, `Dictée`, `Copie`).
- **MABC-2**: conforme sur les libellés explicitement demandés (incluant `Retourner les chevilles main non préférée`).
- **NEPSY 2**: conforme sur l’ajout demandé (`Cubes`, `Flèches`) et les libellés existants.

### 3) Écarts restants bloquant une validation "testeuse" stricte
- **NEPSY 2**: 9 sous-tests ont encore `groupOrder/orderIndex` à la valeur de repli (999/999), donc ordre d’affichage non déterministe pour cette partie.
- **Nomenclature technique**: l’ID du test reste `espargot` (clé technique), tandis que le nom affiché est bien `Lespargot`.

### 4) Conclusion de comparaison
- Sur la question "noms corrects": **objectif atteint** pour les 5 batteries prioritaires.
- Pour satisfaire la demande en mode "zéro ambiguïté côté terrain": finaliser l’ordonnancement NEPSY 2 puis faire une recette de validation avec la testeuse sur capture d’écran catalogue.

## Résultat global (43 tests)
- **OK**: 20
- **A_COMPLETER**: 23
- **A_CORRIGER**: 0

## Qualité DB (post-contrôle automatisé)
- `LOOKUP_WITHOUT_NORMS`: 30 occurrences
- `TEST_WITHOUT_SUBTESTS`: 1 occurrence
- `SCORE_MODE_MISMATCH`: 0
- `DUPLICATE_SUBTEST_NAME`: 0

## Reste à traiter après phase 3
- Test encore sans sous-test: `EGP`.
- Le sujet principal restant n’est plus la complétude des tests, mais la complétion des **normes** pour les sous-tests `LOOKUP`.

## Matrice 1-à-1 par test
| Test | Sous-tests | Statut | Motif principal |
|---|---:|---|---|
| AMPS | 0 | A_COMPLETER | Test présent sans sous-tests |
| Barrage des H | 2 | OK | Conforme |
| Beery VMI | 3 | OK | Conforme |
| BHK | 2 | OK | Conforme |
| BHK Adolescent | 2 | OK | Conforme |
| BOT-2 | 19 | OK | Conforme |
| BRIEF-2 | 1 | A_COMPLETER | LOOKUP sans normes |
| COPM | 2 | OK | Correction computation_mode appliquée |
| DCDQ-F | 1 | OK | Conforme |
| Découpage d'Ozeretzki | 2 | OK | Conforme |
| DTVP-2 | 11 | A_COMPLETER | 1 LOOKUP sans normes |
| DTVP-3 | 0 | A_COMPLETER | Test présent sans sous-tests |
| DTVP-A | 6 | OK | Conforme |
| Échelle de Charlop-Atwell | 0 | A_COMPLETER | Test présent sans sous-tests |
| EGP | 0 | A_COMPLETER | Test présent sans sous-tests |
| EVIC | 3 | OK | Conforme |
| Figure Complexe de Rey | 7 | A_COMPLETER | 5 LOOKUP sans normes |
| Force de préhension (Jamar) | 5 | OK | Conforme |
| FROSTIG (DTVP) | 0 | A_COMPLETER | Test présent sans sous-tests |
| Lespargot | 3 | OK | Conforme |
| LOTCA | 0 | A_COMPLETER | Test présent sans sous-tests |
| MABC-2 | 32 | A_COMPLETER | 12 LOOKUP sans normes |
| MMSE | 8 | OK | Conforme |
| MoCA | 9 | OK | Conforme |
| MVPT-4 | 0 | A_COMPLETER | Test présent sans sous-tests |
| NEPSY | 0 | A_COMPLETER | Test présent sans sous-tests |
| NEPSY 2 | 11 | A_COMPLETER | LOOKUP sans normes |
| NP-MOT | 0 | A_COMPLETER | Test présent sans sous-tests |
| PDMS-2 (Peabody) | 0 | A_COMPLETER | Test présent sans sous-tests |
| PEDI-CAT | 0 | A_COMPLETER | Test présent sans sous-tests |
| Profil Sensoriel 2 (Dunn) | 0 | A_COMPLETER | Test présent sans sous-tests |
| Purdue Pegboard | 4 | OK | Conforme |
| QuickDASH | 3 | OK | Correction computation_mode appliquée |
| Reversal Test | 0 | A_COMPLETER | Test présent sans sous-tests |
| SPM | 0 | A_COMPLETER | Test présent sans sous-tests |
| TEA-Ch | 0 | A_COMPLETER | Test présent sans sous-tests |
| Test de Jebsen-Taylor | 7 | OK | Conforme |
| Test de l'Alouette | 0 | A_COMPLETER | Test présent sans sous-tests |
| Test de Latéralité de Harris | 5 | OK | Conforme |
| Test des Cloches | 1 | OK | Conforme |
| TIHM | 0 | A_COMPLETER | Test présent sans sous-tests |
| Vineland-3 | 0 | A_COMPLETER | Test présent sans sous-tests |
| WISC-V (sous-tests sélectionnés) | 0 | A_COMPLETER | Test présent sans sous-tests |

## Observations de fond
- Aucun doublon de nom de sous-test détecté à l’intérieur d’un même test.
- Le blocage principal restant n’est plus le nommage: c’est la **couverture de normes** et la **complétude des tests placeholders**.
- Les corrections demandées par la testeuse sont implémentées sur les 5 tests prioritaires.

## Priorités recommandées (phase 3)
1. Import de normes pour les sous-tests `LOOKUP` encore non couverts (priorité: MABC-2, NEPSY 2, Figure Rey, BRIEF-2, DTVP-2 quotient VMI).
2. Décision produit sur les tests placeholders (0 sous-test): soit les activer (avec sous-tests), soit les masquer de la sélection clinique.
3. Ajouter un contrôle CI bloquant:
   - interdire `LOOKUP` sans normes,
   - interdire test visible avec 0 sous-test (sauf whitelist explicite).

## Limite actuelle (bloquant externe)
L’import de normes manquantes dépend de sources normatives éditeurs/licences (contenu propriétaire non fourni dans le projet). Sans tables officielles autorisées, il n’est pas possible de compléter de façon fiable les 30 cas `LOOKUP_WITHOUT_NORMS`.
