# Plan d'assainissement

> **Plan terminé, gardé pour l'historique.** Depuis le 2026-09-29, les points restés ouverts sont suivis dans les [issues GitHub](https://github.com/TitouanD/ErgoBilan/issues) (voir [ISSUES.md](ISSUES.md)) : 0.1 → [#63](https://github.com/TitouanD/ErgoBilan/issues/63), 0.6 → [#66](https://github.com/TitouanD/ErgoBilan/issues/66), 2.4 → [#56](https://github.com/TitouanD/ErgoBilan/issues/56), 5.2 (vues) → [#57](https://github.com/TitouanD/ErgoBilan/issues/57), 5.3 → [#64](https://github.com/TitouanD/ErgoBilan/issues/64), 5.4 → [#65](https://github.com/TitouanD/ErgoBilan/issues/65), 5.5 → [#58](https://github.com/TitouanD/ErgoBilan/issues/58). Le 2026-10-02, 5.2 (vues), 5.3 et 5.4 sont appliqués en base et 0.1 l'est en partie (voir « Avancement »). Les autres restes de [TECH_DEBT.md](TECH_DEBT.md) : [#59](https://github.com/TitouanD/ErgoBilan/issues/59) à [#62](https://github.com/TitouanD/ErgoBilan/issues/62), [#67](https://github.com/TitouanD/ErgoBilan/issues/67), [#68](https://github.com/TitouanD/ErgoBilan/issues/68).

**Objectif** : repartir d'une base saine et entièrement fonctionnelle, **sans nouvelle fonctionnalité**. On corrige les bugs, on rend le code conforme aux bonnes pratiques, on supprime les répétitions et le code mort, et on documente.

Le détail de chaque point (preuves, `fichier:ligne`) est dans [TECH_DEBT.md](TECH_DEBT.md). Les identifiants `P0-x`, `P1-x` et `P2-x` y renvoient.

## État de départ (mesuré le 2026-09-24)

| Contrôle                | Résultat                                                                     |
| ----------------------- | ---------------------------------------------------------------------------- |
| `vite build`            | ✅ passe (Vite ne vérifie pas les types)                                     |
| `eslint`                | ✅ 0 erreur                                                                  |
| `vitest`                | ✅ 4 tests, dont un sur du code mort                                         |
| `tsc --noEmit`          | ❌ **14 erreurs**, dont 5 bugs réels (P1-20)                                 |
| `tsc --noEmit --strict` | ❌ 26 erreurs                                                                |
| Types Supabase          | ❌ aucun : le client n'est pas typé, et les casts `as` masquent les erreurs  |
| Schéma DB dans le repo  | ❌ aucun (60 migrations uniquement en production ; rapatriées le 2026-10-02) |
| CI                      | ❌ aucune                                                                    |

**Pourquoi des régressions sont passées inaperçues** : personne ne lance `tsc`, le client Supabase n'est pas typé et il n'y a pas de CI. Le lien famille cassé (P1-16), le toast de l'export (P1-6), le signalement de type de score (P1-2) et le style IA (P1-5) auraient tous été détectés à la compilation. La phase 0 corrige ce problème **avant** de toucher au reste.

## Avancement (2026-09-24)

L'essentiel du plan a été réalisé sur la branche `refactor/assainissement`, fusionnée dans `main` le 2026-09-25. L'état de chaque point est tenu dans [TECH_DEBT.md](TECH_DEBT.md).

| Contrôle                    | Départ        | Maintenant                                                 |
| --------------------------- | ------------- | ---------------------------------------------------------- |
| `tsc --noEmit --strict`     | ❌ 26 erreurs | ✅ 0 erreur (`strict: true` dans `tsconfig.json`)          |
| `eslint`                    | ✅            | ✅, avec `no-unused-vars`                                  |
| `vitest`                    | 4 tests       | ✅ 42 tests (scoring, anonymisation, âge, flux du rapport) |
| Types Supabase              | ❌ aucun      | ✅ `types/supabase.ts`, client `createClient<Database>`    |
| CI                          | ❌ aucune     | ✅ `.github/workflows/ci.yml` (`npm run check`)            |
| Parcours dans le navigateur | non testé     | ✅ démo complète déroulée (voir TECH_DEBT P2-9)            |

| Phase                 | État                                                                                                                                                                                                                                            |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 — Filet de sécurité | Fait : les 60 migrations historiques et `supabase/schema.sql` sont dans le repo (2026-10-02) ← #63. Les tests de 0.7 vérifient directement le comportement corrigé                                                                              |
| 1 — Fonctionnalités   | Fait (migrations `supabase/migrations/2026092508*` appliquées et `generate` déployée le 2026-09-25)                                                                                                                                             |
| 2 — Confidentialité   | Fait, sauf **2.4 (chiffrement local)**, reportée le 2026-09-25 → #56. Le volet base de 2.5 est appliqué                                                                                                                                         |
| 3 — Scores            | Fait                                                                                                                                                                                                                                            |
| 4 — Code propre       | Fait                                                                                                                                                                                                                                            |
| 5 — Base et edge      | 5.1 et 5.2 faits (migrations du 2026-09-25 ; vues de 5.2 en `security_invoker` le 2026-10-02, #57). 5.3 fait le 2026-10-02 (#64), orphelins compris. 5.4 fait (`extract-norms` supprimée le 2026-09-29, vestiges le 2026-10-02, #65). 5.5 → #58 |
| 6 — Documentation     | En-têtes de modules ajoutés sur les fichiers réécrits ; `docs/` mis à jour                                                                                                                                                                      |

Écart à la règle 1 : tout a été fait sur une seule branche.

## Règles de conduite pendant l'assainissement

1. **Un lot = une branche = une PR**, relue avant de fusionner. Ne jamais mélanger dans une même PR un correctif de bug et un refactoring.
2. **Après chaque lot**, lancer `npm run check` (créé en phase 0) et dérouler la [recette manuelle](#recette-manuelle) pour les parcours touchés.
3. **Base de données** : toute modification passe par un fichier de migration versionné (après la phase 0), relu puis appliqué avec accord explicite. Jamais de SQL ad hoc en production.
4. **Refactoring à comportement constant** : en phase 4, on déplace et on factorise sans rien changer de visible. Chaque écart constaté devient un bug, traité à part.
5. **Mettre à jour la doc dans la même PR** : `docs/` et TECH_DEBT (cocher ou retirer le point).

## Phase 0 — Filet de sécurité (avant tout correctif)

But : que la prochaine régression soit détectée automatiquement.

| #   | Tâche                                                                                                                                                                                                                                                                                                            | Taille | Critère de fin                                                         |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------- |
| 0.1 | **Fait (#63)** : migrations rapatriées le 2026-10-02 par `npx supabase migration fetch --linked`, schéma complet dans `supabase/schema.sql`. Rapatrier le schéma : `npx supabase db pull` (migration de référence), `npx supabase functions download extract-norms` (pour archive, avant suppression en phase 5) | S      | `supabase/migrations/` reflète la prod ; `supabase db diff` est vide   |
| 0.2 | Générer les types Supabase (`supabase gen types typescript` → `types/supabase.ts`) et typer le client : `createClient<Database>` dans `services/db.ts` et `PatientPortal.tsx`                                                                                                                                    | S      | Les appels `.from()` / `.rpc()` sont typés                             |
| 0.3 | Ajouter les scripts `typecheck` (`tsc --noEmit`) et `check` (`lint && typecheck && test && build`)                                                                                                                                                                                                               | S      | `npm run check` existe                                                 |
| 0.4 | Corriger les 14 erreurs `tsc`, plus celles révélées par 0.2. Cela corrige au passage P1-2, P1-5, P1-6, P1-16 et P1-20                                                                                                                                                                                            | M      | `npm run typecheck` = 0 erreur                                         |
| 0.5 | CI GitHub Actions : `npm ci && npm run check` sur chaque PR et sur `main`                                                                                                                                                                                                                                        | S      | Une PR avec une erreur de type est bloquée                             |
| 0.6 | Fait (#66). Retirer `*.md` de `.prettierignore` et formater. Ne plus versionner `.env` et `.env.production` : les ajouter à `.gitignore` et documenter les variables dans `.env.example`                                                                                                                         | S      | `format:check` couvre la doc                                           |
| 0.7 | Premiers tests unitaires sur les fonctions pures dont dépend la justesse clinique : `utils/scoring.ts`, `utils/anonymizer.ts`, `calculateAge` (`utils.ts`), `utils/reevaluationHelpers.ts`. Commencer par figer le comportement actuel, y compris les cas faux, marqués `todo`                                   | M      | Les tests documentent les bugs connus ; ils seront corrigés en phase 3 |

## Phase 1 — Fonctionnalités cassées

But : tout ce qui existe dans l'interface fonctionne. Les points déjà corrigés par 0.4 ne sont pas répétés.

| #    | Point        | Tâche                                                                                                                                                                                                            | Taille |
| ---- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1.1  | P1-16        | **Lien famille** : lire l'uuid renvoyé par la RPC (si ce n'est pas déjà fait en 0.4) ; tester le cycle complet création → saisie famille → import                                                                | S      |
| 1.2  | P1-1         | **Test personnalisé** : migration `GRANT EXECUTE` + `search_path` ; `reloadCatalog()` forcé après création ; catégorie valide ; échelle par défaut `none`                                                        | S      |
| 1.3  | P1-2         | **Signalement de type de score** : brancher sur une destination réelle, ou retirer le bouton. Décision produit à prendre                                                                                         | S      |
| 1.4  | P1-17        | **Branding** : lire et écrire `practitioners.branding_config` (avec debounce) ; `chartType` et `scoreDisplayModes` inclus                                                                                        | S      |
| 1.5  | P1-7         | **Export fidèle à l'aperçu** : passer `onUpdateSection` et `sectionOrder` ; même règle pour `objectifs` à la validation, à l'écran et dans le PDF                                                                | M      |
| 1.6  | P1-14        | **Admin, ajout de sous-test** : valeurs par défaut non nulles pour `input_model` et `input_config`, côté client et en SQL                                                                                        | S      |
| 1.7  | P1-10        | **Saisie `raw_only`** : rendre la valeur brute saisissable dans le tableau actif. `computed_items` n'est utilisé par aucun sous-test en base : le retirer du modèle de saisie plutôt que l'implémenter           | M      |
| 1.8  | P1-12        | **Brouillons** : sauvegarder `historicalDate` ; conserver le texte de l'étape 3 historique ; annuler l'autosave avant `deleteDraft` ; rendre `saveDraft` transactionnel                                          | M      |
| 1.9  | P1-8         | **Sessions de génération** : retry du diagnostic fonctionnel ; réponse vide = échec remboursé ; balayage des sessions `pending` de plus d'une heure (migration + pg_cron)                                        | M      |
| 1.10 | P1-11, P1-15 | **Réévaluation** : aucun appel IA en démo ; « Continuer » possible sans IA ; ne pas proposer « Réévaluation 1 clic » sans bilan antérieur ; reprise d'un brouillon de réévaluation depuis le dashboard           | M      |
| 1.11 | P1-15        | **Historique** : `kind` et suivi corrects ; renseigner `previousAssessmentId` à la finalisation                                                                                                                  | S      |
| 1.12 | P1-18, P1-19 | **Realtime des crédits** : ajouter `practitioners` à la publication, ou retirer l'abonnement. **Validateur PIN** : autoriser la migration via une RPC dédiée, ou arrêter de la tenter                            | S      |
| 1.13 | P1-4         | **Purge du portail** : fonction SQL et pg_cron (`pending` > 72 h, `completed` non importé > N jours) ; vérifier l'erreur de suppression après import (évite les doublons de patient) ; supprimer `purge-pending` | S      |

## Phase 2 — Confidentialité des données de santé

But : ce que l'application affiche et promet est vrai.

| #   | Point      | Tâche                                                                                                                                                                                                                                                                                                                          | Taille |
| --- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| 2.1 | P0-3       | **Libellés** : retirer « chiffré » de l'interface tant que 2.4 n'est pas fait                                                                                                                                                                                                                                                  | S      |
| 2.2 | P0-4, P0-5 | **Anonymisation** : anonymiser toute la charge utile envoyée à l'IA (et non champ par champ) ; ajouter parents, fratrie et professionnels ; regex avec frontières de mots ; tests unitaires (0.7)                                                                                                                              | M      |
| 2.3 | P0-2       | **Déconnexion** : ajouter `StorageService.reset()` (fermeture de Dexie, vidage des caches), appelé par `logout` et `lockSession`                                                                                                                                                                                               | S      |
| 2.4 | P0-1, P0-6 | **→ #56 (reporté)** **Chiffrement local** : clé de données enveloppée par la clé du PIN ; chiffrement des blobs Dexie et de l'export `.ergobilan` v2 ; migration au premier déverrouillage ; renforcement du PIN. **Le plus gros chantier** : il demande sa propre spécification et des tests de `StorageService` au préalable | L      |
| 2.5 | P0-7       | **Durcissement** : loopback désactivé en prod ; plus de clé en `?key=` ; UPDATE anon restreint à `family_encrypted_data` et `status` (migration)                                                                                                                                                                               | S      |

## Phase 3 — Justesse clinique des scores

But : un score saisi est interprété, affiché et comparé correctement. Les tests de 0.7 passent de `todo` à vert.

| #   | Point | Tâche                                                                                                                                                                         | Taille |
| --- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 3.1 | P1-9  | **Échelle par défaut** : plus de repli `standard`. Une seule fonction `getScaleForSubtest()` utilisée partout ; les 139 sous-tests en `none` s'affichent correctement         | M      |
| 3.2 | P1-9  | **Zones d'interprétation** : un seul référentiel (z ↔ percentile cohérents), défini une fois et partagé entre l'écran et le PDF                                               | M      |
| 3.3 | P1-9  | **Deltas** : seuil exprimé en unités de z (converti selon l'échelle) ; « non mesuré » quand le score a seulement été recopié ; `detectMetric` correct pour les valeurs brutes | M      |
| 3.4 | P1-13 | **Âge** : `calculateAge(dob, referenceDate)` exact au jour près, calculé à la date du bilan                                                                                   | S      |
| 3.5 | P1-9  | **IA** : `scoresEvidence` inclut l'échelle ; les anciens bilans sont normalisés avant l'envoi                                                                                 | S      |

## Phase 4 — Code propre (comportement constant)

But : un code lisible, sans répétition ni code mort, conforme aux bonnes pratiques React et TypeScript.

| #    | Point | Tâche                                                                                                                                                                                                                                               | Taille |
| ---- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 4.1  | P2-5  | **Code mort** : supprimer ScorePage `:66-75,88-668`, `scoringEngine`, `subtestMatcher`, `subtestDisplay`, `featureFlags`, `subtestAliases` et son test, `TEST_CATALOG`, les fixtures d'extraction, les types morts, les props de focus d'AdminPanel | S      |
| 4.2  | P2-4  | **Catalogue** : un seul sélecteur (`useCatalogIndex()` → map `testId → test`, mémoïsée dans `CatalogContext`) à la place des 7 recalculs et des `flatMap().find()` en boucle                                                                        | S      |
| 4.3  | P2-3  | **Tests à partir des résultats** : factoriser les 4 copies de « reconstruire les tests » dans une fonction `buildTestsFromAssessment()`                                                                                                             | S      |
| 4.4  | P2-4  | **Génération IA** : un seul point d'entrée (service `ai.ts`) pour les trois chemins ; la réévaluation passe par le hook comme le bilan initial                                                                                                      | M      |
| 4.5  | P2-4  | **Finalisation** : une seule fonction paramétrée par le type de bilan                                                                                                                                                                               | M      |
| 4.6  | P2-4  | **Graphiques et zones** : extraire la logique (données, couleurs, zones) dans `utils/reportCharts.ts`, partagée entre `ReportView` et `PdfDocument` ; seul le rendu diffère                                                                         | M      |
| 4.7  | P2-7  | **React** : sortir de `ReportView` les composants définis dans le rendu ; supprimer les mutations d'état dans `ScorePage` ; revoir les dépendances des hooks                                                                                        | M      |
| 4.8  | P2-3  | **`App.tsx`** (1 265 lignes) : extraire l'écran d'auth et la landing, la visionneuse de rapport, et les handlers de parcours (hook `useAssessmentNavigation`). `App.tsx` ne garde que les providers et le routage `mode`                            | L      |
| 4.9  | P2-6  | **Mode `strict`** : activer `strict: true` (26 erreurs aujourd'hui) ; bannir `any` et les casts `as` sur les données Supabase (règle ESLint)                                                                                                        | M      |
| 4.10 | —     | **Nettoyage transverse** : `console.*` → `Logger` ; commentaires obsolètes (« encrypted », « NOUVEAU », « À implémenter ») ; noms trompeurs (`PatientEncryptedPreviewV2`) ; coquilles de l'interface (« Péconisations »)                            | S      |

## Phase 5 — Base de données et edge functions

Toutes les modifications passent par des migrations versionnées (règle 3).

| #   | Point      | Tâche                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Taille |
| --- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 5.1 | P1-3, P0-8 | **Fonctions** : `DROP` des RPC de recommandations ; `REVOKE EXECUTE FROM anon` sur les fonctions admin ; `search_path` fixé partout                                                                                                                                                                                                                                                                                                                   | S      |
| 5.2 | P0-8       | **RLS** : activée sur `ai_request_log` et `signup_rate_limit_log` ; purge de `ai_request_log` ; vues en `security_invoker` si la RLS donne le même résultat (fait le 2026-10-02 : `20261001100400`, #57)                                                                                                                                                                                                                                              | S      |
| 5.3 | P2-2       | **Fait le 2026-10-02** (`20261001100100`, #64 : essai de 30 jours, `ensure_org_and_subscription`, `enforce_edge_signup_channel` supprimé), sauf les orphelins (`supabase/checks/20261001100100_orphelins.sql`, en attente). **Inscription** : une seule durée d'essai ; un seul chemin de création (trigger **ou** bootstrap) ; nettoyage des organisations orphelines et des comptes sans praticien ; `enforce_edge_signup_channel` réel ou supprimé | M      |
| 5.4 | P2-1, P2-8 | **Fait** (`extract-norms` supprimée le 2026-09-29 ; le reste le 2026-10-02, `20261001100200`, #65 ; 2 index de clé étrangère conservés). **Nettoyage** : supprimer l'edge `extract-norms` ; retirer les colonnes vestiges (`encrypted_org_key`, `stripe_customer_id`) et les index inutilisés ; alimenter ou supprimer `admin_audit_log`                                                                                                              | S      |
| 5.5 | P0-8       | **→ #58** **Auth** : activer la protection contre les mots de passe compromis                                                                                                                                                                                                                                                                                                                                                                         | S      |

## Phase 6 — Documentation

| #   | Tâche                                                                                                                                                                                                                      | Taille |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 6.1 | **JSDoc** sur les modules centraux : `StorageService`, `scoring`, `anonymizer`, `reevaluationHelpers`, `useAssessmentFlow`, `aiProxy`, les RPC utilisées. Le but est d'expliquer le _pourquoi_, pas de paraphraser le code | M      |
| 6.2 | **Mise à jour de `docs/`** après les phases 1 à 5 (les numéros de ligne auront bougé) ; TECH_DEBT ne garde que ce qui reste à faire                                                                                        | S      |
| 6.3 | **`.env.example`** commenté ; section « contribuer » (branches, `npm run check`, migrations) dans le README                                                                                                                | S      |

## Recette manuelle

La chaîne de génération IA a son test de bout en bout (`npm run e2e:ai`, [`AI_PIPELINE.md`](AI_PIPELINE.md) §9) : pour les points 2 et 3, la génération elle-même (payload, anonymisation, appel, réhydratation, crédit débité une fois) est vérifiée par Claude, pas à la main. Le reste n'a pas de test de bout en bout. Après chaque lot, dérouler les parcours concernés sur un compte de test :

1. **Connexion et PIN** : connexion, déverrouillage, verrouillage par inactivité, déconnexion puis reconnexion avec un autre compte (aucune donnée du premier ne doit apparaître).
2. **Bilan initial complet** : patient → scores (NS, ET, %, qualitatif, brut) → synthèse → génération IA → validation → export PDF. Vérifier que le PDF correspond à l'aperçu et que le crédit est décompté une seule fois.
3. **Réévaluation** d'un patient qui a un bilan initial : deltas, génération, export.
4. **Bilan historique** : saisie, « Sauver & quitter », reprise, finalisation, puis réévaluation à partir de ce bilan.
5. **Portail parents** : création du lien → saisie dans une fenêtre privée → import → vérifier en base que la ligne est supprimée.
6. **Test personnalisé** : création, visible sans rechargement, saisie, rapport.
7. **Personnalisation** : modifier le branding, recharger la page, vérifier qu'il est conservé.
8. **Sauvegarde** : export `.ergobilan`, puis import sur un autre compte.
9. **Admin** : liste et modification d'un test, ajout d'un sous-test, gestion des utilisateurs.
10. **Démo** : parcours complet sans aucun appel réseau vers `generate` ni écriture Supabase.

## Ordre et dépendances

```text
Phase 0 (filet) ──► Phase 1 (cassé) ──► Phase 2 (confidentialité) ─┐
                                   └─► Phase 3 (scores) ───────────┼─► Phase 4 (refactor) ─► Phase 6 (doc)
                         Phase 5 (DB) — lots indépendants, dès que 0.1 est fait ─┘
```

- **La phase 0 est non négociable** : sans elle, chaque correctif peut en casser un autre sans que personne ne le voie.
- **Les phases 2 et 3 peuvent avancer en parallèle.** Le chiffrement local (2.4) n'est pas un préalable au refactoring : il ne touche que `StorageService`, `exportService` et le déverrouillage.
- **Le refactoring (phase 4) vient après les correctifs** : on ne réorganise que du code qui fonctionne et qui est couvert par la recette.
