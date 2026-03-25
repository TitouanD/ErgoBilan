# Audit complet — Extraction des normes (ContributionStudio)

Date: 2026-03-25  
Périmètre: frontend `ContributionStudio`, edge function `extract-norms`, flux RPC Supabase (`create_private_test`, `attach_subtests_to_test`, `merge_private_test`, `admin_norm_quality_check`, `admin_promote_norms`), schéma/RLS/advisors.

## 1) État actuel observé

## 1.1 Contrôles déjà en place
- Frontend: `analyzePageRows` détecte incohérences lookup/parametric, gaps, overlaps, non-monotonicité, entêtes statistiques capturées.
- Edge `extract-norms`: inventaire colonnes, extraction chunkée dense, passe de vérification, scoring d’incertitude/confiance.
- DB: trigger `validate_official_norm_row_strict` sur `official_norms` (bornes âge/raw, percentile, mean/sd, score minimal).
- RPC contribution: normalisation subtest + gestion abréviations pour collisions + anti-duplication exacte.
- Admin: `admin_norm_quality_check` et workflows de promotion/résolution.

## 1.2 Fragilités identifiées (risque faux positifs)
- Le flux pouvait laisser valider des pages lookup non vérifiées edge, puis bloquer tardivement au save.
- Les colonnes d’inventaire manquantes n’étaient pas intégrées nativement au comptage bloquant de page.
- Les doublons de colonnes lookup adjacentes étaient insuffisamment couverts côté review flags.
- La confiance edge n’intégrait pas assez fortement le manque de couverture inventaire + statut de vérification.
- Advisor sécurité: fonctions avec `search_path` mutable.

## 1.3 Observations Supabase (MCP)
- Tables clés: `official_tests`, `official_subtests`, `official_norms`, `extraction_log`, `admin_audit_log`, `contribution_insights` (RLS actif).
- Fonctions clés confirmées: `create_private_test`, `attach_subtests_to_test`, `merge_private_test`, `admin_norm_quality_check`, `admin_promote_norms`, `find_similar_tests`, `validate_official_norm_row_strict`.
- Advisors sécurité: `security_definer_view` (catalog views) + `function_search_path_mutable`.

## 2) Plan de fiabilisation (priorisé)

## Phase A — Garde-fous bloquants avant écriture (P0)
Objectif: empêcher l’enregistrement de normes douteuses.

1. Bloquer la validation/sauvegarde si:
   - colonnes inventaire manquantes,
   - page LOOKUP non vérifiée,
   - confiance extraction sous seuil.
2. Intégrer ces signaux dans les `ReviewFlag` (pas seulement en affichage secondaire).
3. Détecter explicitement les colonnes lookup adjacentes dupliquées.

## Phase B — Robustesse backend extraction (P1)
Objectif: refléter correctement le risque dans le score edge.

1. Renforcer `confidenceScore` edge avec pénalités:
   - missing source columns,
   - non-vérifié.
2. Conserver la pénalisation existante (mismatch, low coverage, adjacent duplicates).

## Phase C — Durcissement SQL sécurité/maintenance (P1)
Objectif: réduire surface de risque runtime.

1. Fixer `search_path` des fonctions signalées.
2. Continuer à surveiller les views `SECURITY DEFINER` (intentionnelles aujourd’hui, à revalider selon stratégie RLS).

## Phase D — Qualité continue (P2)
Objectif: baisse durable des fausses normes.

1. KPI extraction:
   - taux pages non vérifiées,
   - taux pages avec colonnes manquantes,
   - taux rejets post-review.
2. Boucle d’amélioration:
   - enrichissement alias/subtests,
   - revue régulière des flags `admin_norm_quality_check`,
   - revue des conflits/overrides.

## 3) Exécution réalisée dans cette passe

- ✅ Ajout flag bloquant `LOOKUP_ADJACENT_COLUMN_DUPLICATE` dans `utils/extractionReviewFlags.ts`.
- ✅ Extension des patterns ambigus d’age/entêtes (`SERIE`, `TRIAL`, etc.).
- ✅ Ajout des codes de review extraction dans `types.ts`.
- ✅ Intégration des flags d’intégrité d’extraction dans `ContributionStudio`:
  - `EXTRACTION_MISSING_SOURCE_COLUMNS` (blocking)
  - `EXTRACTION_NOT_VERIFIED` (blocking)
  - `EXTRACTION_LOW_CONFIDENCE` (blocking)
- ✅ Renforcement des garde-fous `handlePreSave` (bloque sauvegarde si conditions qualité non remplies).
- ✅ Renforcement `extract-norms` (`confidenceScore`) avec pénalités sur colonnes manquantes et non-vérification.
- ✅ Migration SQL ajoutée: `20260325000100_harden_function_search_path.sql`.

## 4) Validation technique

- ✅ `npm run build` (OK)
- ✅ `npm test -- utils/extractionReviewFlags.test.ts utils/extractNormsInventoryHelpers.test.ts` (17/17)

## 5) Prochaines actions recommandées

1. Ajouter un dashboard admin de suivi des KPI extraction (base `extraction_log` + flags).
2. Ajouter des tests unitaires ciblés pour les flags d’intégrité metadata dans `ContributionStudio`.
3. Ajouter une règle SQL optionnelle anti-conflit same-org pour `official_norms` (même tranche raw + score contradictoire) après validation métier.
