# Modèle de données

Ce document décrit où vivent les données d'ErgoBilan et sous quelle forme :

1. les types métier TypeScript (`types.ts`) ;
2. la base locale IndexedDB (Dexie), qui contient **toutes les données de santé** ;
3. le fichier de sauvegarde `.ergobilan` ;
4. la base Supabase, qui ne contient **aucune donnée patient en clair**.

Les informations Supabase ont été relevées directement en base, en lecture seule, le **2026-09-23**. Les effets des quatre migrations de `supabase/migrations/`, appliquées le 2026-09-25, sont intégrés ci-dessous. L'état de chaque point est dans [TECH_DEBT.md](TECH_DEBT.md).

## Vue d'ensemble

| Donnée                                                | Où                                                | Chiffrée ?                                              |
| ----------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------- |
| Dossier patient (identité, anamnèse, famille, école…) | IndexedDB `ErgoBilanDB_<userId>` table `patients` | **Non**                                                 |
| Bilans finalisés (scores, rapport)                    | IndexedDB table `assessments`                     | **Non**                                                 |
| Brouillons en cours                                   | IndexedDB table `drafts`                          | **Non**                                                 |
| Suivis / relances                                     | IndexedDB table `followups`                       | **Non**                                                 |
| Sauvegarde `.ergobilan`                               | Fichier téléchargé                                | **Non** (JSON brut)                                     |
| Compte, profil praticien, crédits, abonnement         | Supabase (`practitioners`, `subscriptions`)       | Non (pas de donnée de santé)                            |
| Mise en page du rapport (branding)                    | Supabase `practitioners.branding_config`          | Non                                                     |
| Catalogue de tests                                    | Supabase (`official_*`)                           | Non                                                     |
| Questionnaire parents en transit                      | Supabase `pending_questionnaires`                 | **Oui**, AES-GCM côté client, clé dans le hash de l'URL |
| Préférences de style IA                               | Supabase `practitioners.ai_style_preferences`     | Non (censé ne contenir aucune donnée personnelle)       |

Le PIN du praticien sert uniquement de verrou d'écran. Il ne chiffre pas les données au repos : c'est le point P0-1 de [TECH_DEBT.md](TECH_DEBT.md).

## Types métier (`types.ts`)

| Type                                  | Rôle                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Patient`                             | Fiche patient à plat (~110 champs, presque tous `string`) : identité, parents, garde, fratrie (`Sibling`), scolarité, AVS, médecins, suivis paramédicaux (`ParamedicalTracking`), développement, autonomie, comportement, écriture, objectifs.                                                                                                                                  |
| `ScoreResult`                         | Un score saisi : `value` + `unit` (`NS` \| `ET` \| `%` \| `qualitative` \| `raw`), plus `observation`, `qualitativeLabel`, `customLabel`. Seule la dernière métrique saisie est stockée, les autres sont recalculées. 14 champs legacy `@deprecated` restent déclarés pour **lire** les anciens bilans (`normalizeScoreResult`, voir [SCORING_CATALOG.md](SCORING_CATALOG.md)). |
| `TestData`                            | `{ [testId]: { [subtestId]: ScoreResult } }`.                                                                                                                                                                                                                                                                                                                                   |
| `Observations`                        | Legacy : seul `anamnese` sert encore (notes cliniques envoyées à l'IA).                                                                                                                                                                                                                                                                                                         |
| `ClinicalSynthesis`                   | Saisies du praticien avant génération : `diagnosticInput`, `projectInput`, `recommendationsInput`.                                                                                                                                                                                                                                                                              |
| `ReportSection`                       | Section du rapport : `id`, `title`, `content`, `originalContent` (texte IA d'origine, toujours en HTML, sert à apprendre le style), `contentFormat` (`plain` ou absent = texte IA, `html` = édité dans TipTap, voir `utils/reportContent.ts`), `status`, `isAiGenerated`.                                                                                                       |
| `BrandingConfig`                      | Mise en page de l'export (couleurs, police, en-tête, bloc patient, pied de page, logo) plus `chartType` et `scoreDisplayModes` (mode d'affichage des scores par test). Lu et écrit dans `practitioners.branding_config` par `ProfileService` (`services/profile.ts`), défauts dans `data/brandingDefaults.ts`.                                                                  |
| `PractitionerProfile` / `UserProfile` | Profil praticien ; crédits, abonnement et branding.                                                                                                                                                                                                                                                                                                                             |
| `PatientAssessment`                   | Bilan finalisé : `kind` (`initial` \| `reevaluation` ; un bilan historique est enregistré en `initial`), `date`, `hasFormalReport`, `testName`, `previousAssessmentId`, `tests`, `results` (copie à plat de `tests`, gardée pour les anciens bilans), `report` (sections). Construit par `buildAssessmentRecord` (`utils/assessment.ts`).                                       |
| `PatientFile`                         | Agrégat patient + bilans + suivi + `previewMeta`.                                                                                                                                                                                                                                                                                                                               |
| `PatientDashboardPreviewMeta`         | Résumé précalculé pour les cartes du dashboard (progression, compteurs, drapeaux).                                                                                                                                                                                                                                                                                              |
| `PatientPreviewPayload`               | `previewMeta` + identité, calculé par `StorageService` (rien n'y est chiffré).                                                                                                                                                                                                                                                                                                  |
| `PatientFollowup`                     | Relance de réévaluation (`upcoming` / `due` / `overdue` / `scheduled` / `completed` / `snoozed`).                                                                                                                                                                                                                                                                               |
| `PendingQuestionnaire`                | Miroir client d'une ligne `pending_questionnaires`.                                                                                                                                                                                                                                                                                                                             |
| `DraftPayload`                        | Contenu d'un brouillon : `patient`, `tests`, `observations`, `synthesis`, `sections`, `reportType` (`initial` \| `reevaluation` \| `historique`), `historicalDate`, `previousAssessmentId`, `step`, `version` (3), `timestamp`. Construit par `buildDraft` (`utils/assessmentSession.ts`).                                                                                      |
| `DashboardDraftMeta`                  | Résumé d'un brouillon pour le dashboard (`updatedAt`, `step`, `reportType`).                                                                                                                                                                                                                                                                                                    |
| `Admin*`                              | Types de l'administration (`AdminTestSummary`, `AdminTestRecord`, `AdminSubtestRecord`, `AdminUserRow`, `AdminUserUpdatePayload`).                                                                                                                                                                                                                                              |

Les types Supabase du client sont dans `types/supabase.ts` : générés depuis le schéma distant puis réduits (seules les RPC appelables par le navigateur, sans `Relationships`). À régénérer après application des migrations.

## Base locale IndexedDB (Dexie)

Définie dans `services/localDB.ts`. Chaque utilisateur a **sa propre base** `ErgoBilanDB_<userId>` (classe `ErgoBilanDB`, schéma `version(1)`). L'isolation repose uniquement sur ce nom : les requêtes ne filtrent pas par utilisateur.

| Table         | Clés / index                    | Ligne                | Contenu                                                                                           |
| ------------- | ------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------- |
| `patients`    | `id, lastInteraction, archived` | `LocalPatientRow`    | `patient: Patient` complet, `archived`, `previewMeta`, horodatages. `id` = `crypto.randomUUID()`. |
| `drafts`      | `++id, patientId, updatedAt`    | `LocalDraftRow`      | Un brouillon par patient (`draftData: DraftPayload`).                                             |
| `assessments` | `id, patientId, date`           | `LocalAssessmentRow` | Bilans finalisés.                                                                                 |
| `followups`   | `id, &patientId` (unique)       | `LocalFollowupRow`   | Un suivi par patient.                                                                             |

- **Instances** : `getLocalDB` les met en cache ; `closeLocalDB` ferme la base et la retire du cache. `StorageService.reset()` l'appelle à la déconnexion et au verrouillage.
- **Migration legacy** : `migrateLegacyDB` déplace une seule fois les lignes de l'ancienne base globale `ErgoBilanDB` (schéma avec `userId`) vers la base de l'utilisateur. Elle est lancée sans attente par `StorageService.setCurrentUser`.
- **Façade** : tout accès passe par `StorageService` (`services/storage.ts`), après `setCurrentUser(userId)` :
  - patients : `createPatient`, `ensurePatientId`, `syncPatientIdentityPreview`, `saveFile`, `deleteFile` (transaction sur les quatre tables), `toggleArchive` ;
  - bilans : `addAssessment` écrit le bilan et recalcule l'identité et le `previewMeta` du patient **dans une seule transaction** ; conversions `rowToAssessment` / `assessmentToRow` ;
  - brouillons : `saveDraft` (lecture puis écriture dans une transaction, donc jamais deux brouillons pour un patient), `getDraft`, `deleteDraft`, `getDraftsMetadata` ;
  - lecture : `loadPatientListPage` (50 par page, découpée en mémoire après lecture de toute la table ; répare en tâche de fond les `previewMeta` périmés), `loadPatientPreviewById`, `loadPatientHistoryPage` (60 bilans par page), `loadPatientDetails` ;
  - suivis : `getPatientFollowup`, `upsertPatientFollowup`, `markFollowupCompleted`, `snoozeFollowup`. Le statut est recalculé à la lecture : `due` entre l'échéance et 6 mois après, `overdue` au-delà.
- **Suivi par défaut** : `finalize` (`utils/assessmentSession.ts`) crée un suivi `upcoming` à 6 mois après chaque bilan finalisé, quel que soit le parcours.
- **Mode démo** : toutes les écritures sont ignorées et les lectures renvoient les patients de `data/demoData.ts`.

## Sauvegarde `.ergobilan`

`services/exportService.ts` produit un fichier JSON **non chiffré** (avertissement en en-tête du fichier) :

```ts
{
  version: (1, exportedAt, patients, drafts /* sans id */, assessments, followups);
}
```

`importFromFile` refuse toute autre version que 1 et fusionne le contenu dans la base de l'utilisateur courant, en une transaction (upsert par UUID ; les brouillons des patients importés sont remplacés). `peekBundle` compte les lignes sans importer. La date de la dernière sauvegarde est suivie par `utils/backupTracking.ts`.

## Supabase — schéma `public`

Vérifié en base le 2026-09-23. Projet `hxlsjpkwrqunuqpaukmg`. Le nombre de lignes est donné à cette date.

### Catalogue de tests

| Table                 | Lignes | Colonnes clés                                                                                                                                                                                                                                                                                                                       |
| --------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `official_categories` | 10     | `id` (text), `label`, `icon_key` (nom d'icône lucide, défaut `Box`), `sort_order`, `description`                                                                                                                                                                                                                                    |
| `official_tests`      | 44     | `id` (text), `name`, `category_id` → categories, `author`, `version`, `organization_id` → organizations (**NULL = test officiel**, sinon test perso)                                                                                                                                                                                |
| `official_subtests`   | 329    | `id` (text), `test_id` → tests, `name`, `unit`, `score_type` (standard \| scaled \| t-score \| percentile \| sten \| stanine \| none, défaut `none`), `input_model` (numeric_4mode \| qualitative_category \| custom_text, défaut `numeric_4mode`), `input_config` jsonb, `display_order`, `display_group_order`, `organization_id` |

La contrainte de `input_model` correspond au type client `SubtestInputModel` depuis la migration `20260929100000_retrait_harris_brut.sql` (#49), qui retire `raw_only` et `computed_items` ; une valeur inconnue est lue comme `numeric_4mode`.

Le client lit le catalogue **uniquement via deux vues** (`contexts/CatalogContext.tsx`, fonction `load`) :

- `view_unified_catalog` : tests visibles, avec catégorie, icône et `subtests_count` ;
- `view_unified_subtests` : sous-tests visibles.

Les deux vues filtrent sur `is_current_user_onboarded()`, sur la visibilité (officiel, ou organisation dont l'appelant est membre) et sur la première organisation de l'appelant. Ce sont des vues « security definer » : elles s'exécutent avec les droits de leur propriétaire et contournent donc la RLS des tables. Le filtrage est codé dans la vue elle-même. Voir [SCORING_CATALOG.md](SCORING_CATALOG.md) pour l'usage.

### Comptes et abonnements

| Table                  | Lignes | Colonnes clés                                                                                                                                                                                                                                                                               |
| ---------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `practitioners`        | 4      | `id` = `auth.users.id`, `email`, nom, prénom, `phone_pro`, `siret`, `address_pro`, `encryption_salt` / `encryption_validator` (PIN ; `'pending'` tant que le PIN n'est pas configuré), `credits` (≥ 0, défaut 3), `is_admin`, `ai_style_preferences` (≤ 2000 car.), `branding_config` jsonb |
| `organizations`        | 8      | `id`, `name`, `stripe_customer_id` (inutilisé)                                                                                                                                                                                                                                              |
| `organization_members` | 4      | PK (`organization_id`, `user_id`), `role` (défaut `owner`), `encrypted_org_key` (vestige de l'ancien chiffrement)                                                                                                                                                                           |
| `subscriptions`        | 4      | `user_id` (unique), `plan_id` (free \| essential \| performance \| expert), `status` (active \| trialing \| canceled \| past_due \| inactive), `trial_ends_at`, `current_period_end`, `monthly_extraction_quota`                                                                            |

Les incohérences relevées le 2026-09-23 (organisations sans membre, comptes `auth.users` sans `practitioners`) sont décrites au point P2-2 de [TECH_DEBT.md](TECH_DEBT.md).

**« Onboardé »** : `is_current_user_onboarded()` renvoie vrai quand le praticien a un `encryption_salt` et un `encryption_validator` différents de `'pending'`, c'est-à-dire quand son PIN est configuré. Presque toute la RLS dépend de cette fonction.

### Portail parents

| Table                    | Lignes | Colonnes clés                                                                                                                                                                                            |
| ------------------------ | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pending_questionnaires` | 0      | `id`, `practitioner_id`, `organization_id`, `label`, `status` (texte libre, `pending` par défaut), `access_token` (en clair), `practitioner_encrypted_key`, `family_encrypted_data` (réponses chiffrées) |

L'accès de la famille (rôle `anon`) passe par l'en-tête HTTP `x-questionnaire-token`, comparé à `access_token` dans la RLS. Le portail (`components/portal/PatientPortal.tsx`) ne lit que `status` et `family_encrypted_data` et n'écrit que ces deux colonnes. Le déroulé complet est décrit dans [WORKFLOWS.md](WORKFLOWS.md).

### Journaux

| Table                   | Lignes | RLS | Rôle                                                                                                                                                                                              |
| ----------------------- | ------ | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `generation_log`        | 33     | oui | Une ligne par génération IA facturée. `status` : pending → completed \| failed → refunded. `error_code` sert aussi de verrou (`LOCK:<epoch>:<uuid>`). Le type de génération n'est pas enregistré. |
| `ai_request_log`        | 68     | oui | Journal du rate limit IA (`user_id`, `created_at`). Purgé à 2 jours par pg_cron.                                                                                                                  |
| `signup_rate_limit_log` | 0      | oui | Rate limit de l'inscription (hash d'IP et d'e-mail). Purgé toutes les heures par pg_cron.                                                                                                         |
| `admin_audit_log`       | 0      | oui | Prévu pour tracer les actions admin, jamais alimenté.                                                                                                                                             |

`ai_request_log` et `signup_rate_limit_log` ont la RLS activée sans policy (`20260924100300_rls_on_internal_logs.sql`) et aucun droit pour `anon` ni `authenticated`. Seules les fonctions SECURITY DEFINER (propriétaire des tables) et le `service_role` y écrivent.

### Droits des rôles clients (GRANT)

| Objet                                           | `anon`                                                                                                                                                                 | `authenticated`                |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `practitioners`                                 | —                                                                                                                                                                      | SELECT, UPDATE                 |
| `organization_members`                          | —                                                                                                                                                                      | SELECT, UPDATE                 |
| `subscriptions`, `official_categories`          | —                                                                                                                                                                      | SELECT                         |
| `pending_questionnaires`                        | SELECT, UPDATE sur toutes les colonnes. **À appliquer** : SELECT (`id`, `status`, `family_encrypted_data`, `access_token`), UPDATE (`family_encrypted_data`, `status`) | SELECT, INSERT, UPDATE, DELETE |
| `view_unified_catalog`, `view_unified_subtests` | —                                                                                                                                                                      | SELECT                         |
| Autres tables                                   | —                                                                                                                                                                      | —                              |

`official_tests` et `official_subtests` ont des policies d'écriture mais **aucun GRANT**. Toute écriture dans le catalogue passe donc par des RPC SECURITY DEFINER. La restriction par colonne du portail vient de `20260924100100_portal_family_column_grants.sql`.

### Politiques RLS

Les policies `authenticated_requires_onboarded_profile` sont **RESTRICTIVE** : elles s'ajoutent en ET aux autres. Toutes les autres policies sont PERMISSIVE.

| Table                    | Policies (résumé)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `practitioners`          | SELECT et UPDATE sur sa propre ligne (`auth.uid() = id`). Pas d'INSERT : la ligne est créée par un trigger ou une RPC.                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `organizations`          | ALL sur les organisations dont on est membre ; RESTRICTIVE onboardé.                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `organization_members`   | SELECT et UPDATE de sa propre adhésion, DELETE si le rôle n'est pas `owner` ; RESTRICTIVE onboardé.                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `subscriptions`          | SELECT de son abonnement ; RESTRICTIVE onboardé.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `pending_questionnaires` | Praticien : SELECT, INSERT, UPDATE, DELETE dans ses organisations (INSERT seulement si `practitioner_id = auth.uid()`) ; RESTRICTIVE onboardé. **Famille (`anon`)** : SELECT si le jeton correspond ; UPDATE (`family_update_by_token`) si le jeton correspond et `status = 'pending'`, avec `WITH CHECK (family_encrypted_data IS NOT NULL AND status = 'completed')`. La famille n'a de droits que sur les colonnes `id`, `status`, `family_encrypted_data`, `access_token` (lecture) et `family_encrypted_data`, `status` (écriture). |
| `generation_log`         | SELECT de ses lignes ; RESTRICTIVE onboardé. Aucun GRANT, donc la table n'est pas lisible depuis le client.                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `official_categories`    | SELECT si onboardé.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `official_tests`         | SELECT si admin, officiel ou test de son organisation ; INSERT de tests privés dans son organisation ; UPDATE et DELETE si admin ou test de son organisation.                                                                                                                                                                                                                                                                                                                                                                            |
| `official_subtests`      | SELECT si officiel ou sous-test de son organisation ; INSERT, UPDATE, DELETE réservés aux admins.                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `admin_audit_log`        | SELECT et INSERT réservés aux admins.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

### Fonctions (RPC)

Toutes sont dans `public` et en `SECURITY DEFINER`, sauf mention contraire. « Exécutable par » indique le droit EXECUTE réel après les migrations du 2026-09-25.

| Fonction                                                                                       | Exécutable par      | Garde / rôle                                                                                                                                                     | Appelée par                                                                |
| ---------------------------------------------------------------------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `bootstrap_practitioner_for_user(p_user_id, p_email)`                                          | authenticated       | `auth.uid() = p_user_id` ; crée la ligne `practitioners` (PIN `pending`)                                                                                         | `AuthContext` (`loadUser`, réparation), edge `signup`                      |
| `bootstrap_org_for_user(p_user_id, p_org_name)`                                                | authenticated       | `auth.uid() = p_user_id` et onboardé ; crée l'organisation, l'adhésion `owner` et l'abonnement d'essai s'ils manquent ; renvoie l'uuid de l'organisation         | `AuthContext` (`hydrateProfile`), `hooks/useLinkManager.ts`, edge `signup` |
| `is_current_user_onboarded()`                                                                  | authenticated       | PIN configuré ; exécutée avec `row_security=off`                                                                                                                 | RLS, vues                                                                  |
| `check_is_admin()`, `admin_check()`                                                            | authenticated       | Onboardé et `is_admin`                                                                                                                                           | RLS, `AdminService.adminCheck`, `AuthContext`                              |
| `check_is_member_of(org_id)`                                                                   | authenticated       | Appartenance à l'organisation                                                                                                                                    | RLS, vues                                                                  |
| `admin_list_tests`, `admin_get_test_detail`, `admin_delete_test`, `admin_delete_subtest`       | authenticated       | `check_is_admin()` en tête de fonction                                                                                                                           | `AdminService` (`services/admin.ts`)                                       |
| `admin_save_test_detail`                                                                       | authenticated       | `check_is_admin()` ; ne fait qu'un `UPDATE` sur `official_tests`, puis upsert des sous-tests. Défauts : `none` / `numeric_4mode` / `{}`                          | `AdminService.saveTestDetail`                                              |
| `admin_list_users`, `admin_update_user`                                                        | authenticated       | `check_is_admin()` ; `admin_update_user` contourne les triggers de protection via `app.internal_operation`                                                       | `AdminService.listUsers`, `.updateUser`                                    |
| `admin_get_ai_health_stats()`                                                                  | authenticated       | `check_is_admin()` ; statistiques sur 30 jours de `generation_log`                                                                                               | `AdminService.getAIHealthStats` (`OpsMonitoring`)                          |
| `practitioner_save_custom_test(payload)`                                                       | authenticated       | Crée un test et ses sous-tests dans l'organisation de l'appelant                                                                                                 | `AdminService.saveCustomTest`                                              |
| `consume_credit_for_user(p_user_id)`                                                           | service_role        | Vérifie PIN, abonnement actif ou en essai, crédits ; décrémente sauf pour les admins et le plan expert actif ; insère `generation_log` pending et renvoie son id | edge `generate`                                                            |
| `claim_generation_session(p_generation_id, p_user_id, p_lock_ttl_seconds)`                     | service_role        | Verrou optimiste de 300 s par défaut dans `error_code`                                                                                                           | edge `generate`                                                            |
| `finalize_generation_internal(p_generation_id, p_user_id, p_success, p_error_code)`            | service_role        | Succès → completed ; échec → failed puis refunded, avec recrédit sauf admin et expert                                                                            | edge `generate`, `sweep_stale_generations`                                 |
| `check_rate_limit_for_user(p_user_id, p_max_per_hour)`                                         | service_role        | 10 appels par heure par défaut, verrou advisory, insère dans `ai_request_log`                                                                                    | edge `generate`                                                            |
| `consume_credit()`, `finalize_generation()`, `check_rate_limit()`                              | service_role        | Anciennes variantes basées sur `auth.uid()`. L'edge `generate` ne les appelle plus (supprimées des replis en v52)                                                | edge `generate` v51 (repli)                                                |
| `check_signup_rate_limit(...)`, `purge_signup_rate_limit_log(...)`                             | service_role        | Rate limit de l'inscription                                                                                                                                      | edge `signup`, pg_cron                                                     |
| `purge_pending_questionnaires`, `sweep_stale_generations`, `purge_ai_request_log`              | aucun rôle client   | Purges planifiées, `row_security = off` (voir pg_cron)                                                                                                           | pg_cron                                                                    |
| `get_contextual_recommendations`, `upsert_recommendation`                                      | authenticated, anon | **Cassées** : elles visent `recommendation_crowd`, table qui n'existe plus. Non utilisées. **À appliquer** : DROP                                                | —                                                                          |
| `is_practitioner_pin_configured`, `extract_trailing_tag`, `normalize_subtest_abbreviation_tag` | —                   | Utilitaires internes                                                                                                                                             | —                                                                          |

Cinq fonctions n'ont pas de `search_path` fixé : `admin_save_test_detail`, `practitioner_save_custom_test`, `get_contextual_recommendations`, `upsert_recommendation` et `enforce_public_acl_on_ddl` (trigger d'événement DDL). La migration `20260924100000` fixe les deux premières et supprime les deux suivantes ; `enforce_public_acl_on_ddl` reste sans `search_path`.

### Triggers

| Objet                  | Trigger                                                                | Effet                                                                                                                                                                           |
| ---------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth.users`           | `on_auth_user_created` (AFTER INSERT) → `handle_new_user`              | Crée `practitioners` (3 crédits), une organisation « Cabinet <email> », l'adhésion `owner` et l'abonnement d'essai. Les erreurs sont avalées (`RAISE WARNING`).                 |
| `auth.users`           | `tr_enforce_edge_signup_channel` (BEFORE INSERT)                       | **Sans effet** (`RETURN NEW`) : il n'empêche pas une inscription qui ne passerait pas par l'edge `signup`.                                                                      |
| `practitioners`        | `on_practitioner_save` → `enforce_practitioner_defaults`               | À l'INSERT, force 3 crédits et `is_admin = false`. À l'UPDATE par un utilisateur authentifié, remet silencieusement `credits` et `is_admin` à leur valeur d'origine.            |
| `practitioners`        | `tr_protect_practitioner_data` → `protect_practitioner_sensitive_data` | Lève une exception si `credits`, `is_admin` ou un `encryption_validator` déjà défini sont modifiés. Exceptions : `postgres`, `service_role`, `app.internal_operation = 'true'`. |
| `subscriptions`        | `on_subscription_insert` → `enforce_subscription_defaults`             | Force `free` / `trialing` avec un essai et une période de **30 jours**. Cela écrase les 14 jours demandés par `handle_new_user` et `bootstrap_org_for_user`.                    |
| `organization_members` | `tr_protect_organization_member_role`                                  | Empêche un non-admin de modifier son propre rôle.                                                                                                                               |
| `admin_audit_log`      | `admin_audit_log_timestamp`                                            | Met à jour `updated_at`.                                                                                                                                                        |

### Tâches planifiées (pg_cron)

| Job                            | Planification                   | Commande                                                                                     | État            |
| ------------------------------ | ------------------------------- | -------------------------------------------------------------------------------------------- | --------------- |
| `purge_signup_rl`              | `0 * * * *` (toutes les heures) | `SELECT public.purge_signup_rate_limit_log();`                                               | En production   |
| `purge_pending_questionnaires` | `15 3 * * *` (chaque nuit)      | Supprime les questionnaires `pending` de plus de 14 jours et `completed` de plus de 30 jours | **À appliquer** |
| `sweep_stale_generations`      | `*/15 * * * *`                  | Rembourse les `generation_log` restés `pending` plus de 30 min (`ABANDONED_SESSION`)         | **À appliquer** |
| `purge_ai_request_log`         | `30 3 * * *` (chaque nuit)      | Supprime les lignes d'`ai_request_log` de plus de 2 jours                                    | **À appliquer** |

Ces trois jobs viennent de `20260924100200_scheduled_cleanups.sql`. Tant qu'elle n'est pas appliquée, rien ne purge `pending_questionnaires`, `ai_request_log` ni les lignes `generation_log` restées en `pending`.

### Extensions installées

`pgcrypto`, `pg_trgm`, `unaccent`, `uuid-ossp`, `pg_cron`, `pg_stat_statements`, `supabase_vault`, `plpgsql`.

### Edge functions

| Slug            | Version déployée | `verify_jwt` | Dans le repo                                              | Rôle                                                                                                                       |
| --------------- | ---------------- | ------------ | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `generate`      | 52               | false        | `supabase/functions/generate/` (`index.ts`, `prompts.ts`) | Génération IA (Gemini), crédits, rate limit. Déployée depuis le repo le 2026-09-25. Voir [AI_PIPELINE.md](AI_PIPELINE.md). |
| `signup`        | 27               | false        | `supabase/functions/signup/index.ts`                      | Inscription avec Turnstile et rate limit, puis bootstrap.                                                                  |
| `extract-norms` | 77               | false        | **absente**                                               | Extraction de normes (ancienne fonctionnalité, non appelée par le client). À supprimer (manuel).                           |

`purge-pending`, jamais déployée, a été supprimée du repo ; elle est remplacée par le job `purge_pending_questionnaires`. Comme `verify_jwt` est désactivé, chaque fonction vérifie elle-même le JWT.

## Schéma et migrations

`supabase/migrations/` ne contient que les quatre migrations de l'assainissement, appliquées le 2026-09-25 :

- `20260924100000_fix_client_rpc_grants.sql`
- `20260924100100_portal_family_column_grants.sql`
- `20260924100200_scheduled_cleanups.sql`
- `20260924100300_rls_on_internal_logs.sql`

La base garde la trace de **60 migrations** historiques appliquées, de `20260305000001_audit_corrections` à `20260724201933_add_branding_config_column`, qui ne sont pas dans le repo. Le schéma de référence, la RLS, les fonctions et `extract-norms` n'existent donc qu'en production (point P2-1). Pour les versionner :

```bash
npx supabase db pull            # génère une migration de référence à partir du schéma distant
npx supabase functions download extract-norms
```

Avant toute modification de la base, lire l'état réel avec le MCP Supabase ou `supabase db dump`, et non ce document, qui peut dater.
