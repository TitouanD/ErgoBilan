# Registre de dette technique

Ce registre recense les bugs, risques et nettoyages connus. L'analyse initiale date du **2026-09-23** (code et base, via le MCP Supabase en lecture seule). Le **2026-09-24**, l'assainissement (branche `refactor/assainissement`, voir [PLAN_ASSAINISSEMENT.md](PLAN_ASSAINISSEMENT.md)) en a traité la plus grande partie. Ce document donne l'état de chaque point après ce travail.

Priorités :

- **P0** : confidentialité et sécurité des données de santé.
- **P1** : bug visible par l'utilisateur ou fonctionnalité cassée.
- **P2** : dette structurelle, hygiène, performance.

Statuts :

- **Résolu** : corrigé dans le code et vérifié (`npm run check`, parcours démo dans le navigateur).
- **À déployer** : corrigé dans le repo, mais il reste à appliquer une migration (`supabase/migrations/20260924*`) ou à déployer l'edge function `generate`. Ces actions touchent la production et demandent un accord explicite.
- **Manuel** : réglage à faire dans le dashboard Supabase.
- **Ouvert** : non traité.

## Tableau de bord

| Point | Sujet                                                | Statut                        |
| ----- | ---------------------------------------------------- | ----------------------------- |
| P0-1  | Données de santé en clair dans IndexedDB et l'export | **Ouvert** (tâche dédiée)     |
| P0-2  | La déconnexion laisse la base ouverte                | Résolu                        |
| P0-3  | L'interface annonce « chiffré »                      | Résolu                        |
| P0-4  | Anonymisation incomplète avant Gemini                | Résolu                        |
| P0-5  | La regex d'anonymisation corrompt des mots           | Résolu                        |
| P0-6  | PIN cassable hors ligne                              | **Ouvert** (lié à P0-1)       |
| P0-7  | Durcissement edge functions et portail               | Code résolu, **à déployer**   |
| P0-8  | Hygiène de la base                                   | **À déployer** + manuel       |
| P1-1  | Création de test personnalisé                        | Code résolu, **à déployer**   |
| P1-2  | Signalement de type de score                         | Résolu (fonction retirée)     |
| P1-3  | RPC mortes                                           | **À déployer**                |
| P1-4  | Purge des questionnaires du portail                  | Code résolu, **à déployer**   |
| P1-5  | Style IA appris jamais utilisé                       | Résolu                        |
| P1-6  | Plantage après téléchargement du PDF                 | Résolu                        |
| P1-7  | Mise en page affichée ≠ exportée                     | Résolu                        |
| P1-8  | Crédits et sessions de génération                    | Code résolu, **à déployer**   |
| P1-9  | Échelles et interprétation des scores                | Résolu                        |
| P1-10 | Saisie `raw_only` / `computed_items`                 | Résolu                        |
| P1-11 | Réévaluation                                         | Résolu                        |
| P1-12 | Brouillons                                           | Résolu                        |
| P1-13 | Calcul de l'âge                                      | Résolu                        |
| P1-14 | Admin : ajout de sous-test                           | Résolu (RPC : à déployer)     |
| P1-15 | Parcours, divers                                     | Résolu, sauf 2 points ouverts |
| P1-16 | Création du lien famille                             | Résolu                        |
| P1-17 | Personnalisation du rapport non sauvegardée          | Résolu                        |
| P1-18 | Realtime des crédits inopérant                       | Résolu (abonnement retiré)    |
| P1-19 | Migration du validateur PIN en échec silencieux      | Résolu                        |
| P1-20 | Erreurs TypeScript                                   | Résolu (`strict`, 0 erreur)   |
| P2-1  | Schéma, migrations, `extract-norms` hors du repo     | **Ouvert**                    |
| P2-2  | Création de compte                                   | **Ouvert**                    |
| P2-3  | `App.tsx` trop gros                                  | Résolu                        |
| P2-4  | Doublons                                             | Résolu                        |
| P2-5  | Code mort                                            | Résolu (reste 2 colonnes DB)  |
| P2-6  | Outillage                                            | Résolu (reste `.env` suivis)  |
| P2-7  | Composants React recréés, mutations d'état           | Résolu                        |
| P2-8  | Base de données, divers                              | Partiel, **à déployer**       |
| P2-9  | Bugs trouvés au test navigateur du 2026-09-24        | Résolu                        |
| P2-10 | Points relevés à la relecture de la doc (2026-09-25) | Résolu, sauf 4 points ouverts |

## Actions en attente sur la production

Rien de ce qui suit n'a été appliqué. Chaque action demande l'accord du responsable du projet.

1. **Migrations** (dans l'ordre) :
   - `20260924100000_fix_client_rpc_grants.sql` : GRANT de `practitioner_save_custom_test` à `authenticated` (P1-1), REVOKE `anon` sur les RPC `admin_*`, `search_path` fixé, `admin_save_test_detail` avec les bons défauts (P1-14), DROP des RPC mortes (P1-3).
   - `20260924100100_portal_family_column_grants.sql` : la famille ne peut plus lire ou écrire que ses colonnes (P0-7).
   - `20260924100200_scheduled_cleanups.sql` : purges pg_cron des questionnaires (14 j `pending`, 30 j `completed`), remboursement des sessions de génération abandonnées (30 min) et purge d'`ai_request_log` (2 j) (P1-4, P1-8, P2-8).
   - `20260924100300_rls_on_internal_logs.sql` : RLS activée sur les deux journaux internes (P0-8).
   - Puis régénérer `types/supabase.ts`.
2. **Edge function `generate`** : déployer `index.ts` et `prompts.ts` (P0-7, P1-8). La version en production (v51) est antérieure. Avant le déploiement, vérifier que le secret `AI_ALLOWED_ORIGINS` contient l'URL de l'application : sans lui, le filtrage des origines dépend de `APP_ENV` / `DENO_DEPLOYMENT_ID`, dont la présence sur le runtime Supabase n'a pas été vérifiée.
3. **Réglages manuels** :
   - activer la protection contre les mots de passe compromis (Auth) ;
   - supprimer l'edge function `extract-norms`, déployée mais absente du repo et inutilisée (P2-1).

## P0 — Confidentialité et sécurité

### P0-1 Données de santé en clair au repos — Ouvert

- **Où** : tables Dexie de `services/localDB.ts` (`patient`, `tests`, `results`, `report`, `draftData` stockés tels quels) ; export `.ergobilan` en JSON clair (`services/exportService.ts`).
- **Impact** : toute personne ayant accès au navigateur ou au fichier d'export lit les dossiers. Le PIN n'est qu'un verrou d'écran ; la clé qui en dérive ne protège que les clés des questionnaires du portail.
- **Correctif retenu**, à mener dans une tâche dédiée :
  1. Générer une clé de données AES-GCM non extractible, enveloppée par la clé dérivée du PIN (les anciennes `wrapKey` / `unwrapKey`, jamais utilisées, ont été supprimées : à réécrire proprement).
  2. Chiffrer `patient`, `draftData`, `tests`, `results` et `report` dans `StorageService`, en gardant en clair le minimum nécessaire aux index (id, dates, `archived`).
  3. Chiffrer l'export (format v2, v1 toujours lisible).
  4. Migrer les données existantes au premier déverrouillage.
- Les libellés de l'interface ne prétendent plus que les données sont chiffrées (P0-3).

### P0-2 La déconnexion laisse la base ouverte — Résolu

`StorageService.reset()` ferme la base Dexie (`closeLocalDB`) et vide l'état du module. `logout` et `lock` (`contexts/AuthContext.tsx`) l'appellent.

### P0-3 L'interface annonce « chiffré » — Résolu

Libellés corrigés dans `Step1Admin`, `AuthWizard` et `PinUnlock` (« Privé · Pseudonymisé avant l'envoi à l'IA »).

### P0-4 Anonymisation incomplète — Résolu

Toute la charge utile est construite par `utils/aiPayload.ts` puis pseudonymisée d'un bloc par `anonymizeDeep` (`utils/anonymizer.ts`) : observations, synthèse, rapport précédent en réévaluation, diffs de style. La table couvre le patient, les deux parents (noms, téléphones, e-mails), la fratrie, les professionnels du suivi, l'école, l'enseignant et les médecins.

### P0-5 La regex corrompt des mots — Résolu

Frontières Unicode (`\p{L}\p{N}`), placeholders numérotés et réversibles, réhydratation échappée en HTML. Couvert par `utils/anonymizer.test.ts` (« Ali » / « qualité », « Eva » / « Evaluation »).

### P0-6 Le PIN peut être cassé hors ligne — Ouvert

- PIN de 6 chiffres ; sel et validateur PBKDF2 lisibles par l'utilisateur dans `practitioners` ; verrouillage après erreurs en `localStorage` ; sel modifiable par UPDATE (DB).
- Ne devient critique qu'avec P0-1. À traiter ensemble : code plus long ou phrase de passe, validateur non renvoyé au client ou lié à un secret serveur.

### P0-7 Durcissement des edge functions et du portail — Code résolu, à déployer

- `generate` : loopback autorisé seulement hors production, CORS qui renvoie l'origine autorisée (plus de `*`), plus de repli « fail-open » sur des RPC absentes. **Edge non déployée.**
- Portail : la clé ne circule plus que dans le fragment `#key=` (repli `?key=` supprimé).
- Colonnes modifiables par la famille : restreintes par GRANT de colonne et `WITH CHECK status = 'completed'` dans `20260924100100_portal_family_column_grants.sql`. **Migration non appliquée.**

### P0-8 Hygiène de la base — À déployer + manuel

- RLS sur `ai_request_log` et `signup_rate_limit_log` : `20260924100300_rls_on_internal_logs.sql`.
- REVOKE `anon` sur les RPC `admin_*` et `search_path` fixé : `20260924100000_fix_client_rpc_grants.sql`.
- **Ouvert** : les vues `view_unified_*` sont `security definer` ; envisager `security_invoker = on` après vérification que la RLS donne le même résultat.
- **Manuel** : protection contre les mots de passe compromis à activer.

## P1 — Bugs fonctionnels

### P1-1 Création de test personnalisé — Code résolu, à déployer

- Côté client : catégorie `autre`, échelle par défaut `none`, `reloadCatalog()` forcé après création (`TestCatalogModal`).
- Reste le GRANT EXECUTE à `authenticated` (migration `20260924100000`). Tant qu'elle n'est pas appliquée, la création échoue en production avec « permission denied ».

### P1-2 Signalement de type de score — Résolu

La fonctionnalité avait été retirée volontairement (commit `f579589`) ; le composant orphelin `ScoreTypeReportModal` a été supprimé.

### P1-3 RPC mortes — À déployer

`get_contextual_recommendations` et `upsert_recommendation` (table `recommendation_crowd` disparue) sont supprimées par la migration `20260924100000`.

### P1-4 Purge du portail — Code résolu, à déployer

- `purge_pending_questionnaires` + pg_cron (14 j `pending`, 30 j `completed`) dans `20260924100200_scheduled_cleanups.sql`. L'edge `purge-pending`, jamais déployée, est supprimée du repo.
- Import d'un questionnaire (`hooks/usePendingProcessor.ts`) : le patient est créé en local, puis la ligne distante est supprimée ; si la suppression échoue, la création locale est annulée. Plus de doublon possible.

### P1-5 Style IA appris — Résolu

`practitioner` est passé à `useAssessmentFlow` ; les préférences sont envoyées aux deux générations et `refreshProfile` les recharge après apprentissage.

### P1-6 Plantage après le PDF — Résolu

`const toast = useToast()` dans `ExportPage`.

### P1-7 Mise en page affichée ≠ exportée — Résolu

- La disposition des pages est remontée dans `ExportPage` et partagée par `ReportView` (édition, déplacement) et `PdfDocument` (prop `pages`).
- Chaque page de l'aperçu commence une nouvelle page du PDF (corrigé le 2026-09-25 : le PDF enchaînait tout).
- `chartType` et `scoreDisplayModes` sont enregistrés dans le branding.
- **Ouvert** : la disposition des pages n'est pas enregistrée ; elle revient à la disposition par défaut si l'on quitte l'étape d'export.
- La section `objectifs` est masquée partout (`HIDDEN_SECTION_IDS` dans `utils/reportData.ts`).

### P1-8 Crédits et sessions de génération — Code résolu, à déployer

- Un diagnostic en échec libère le verrou de session : le retry fonctionne sans nouveau crédit.
- Une réponse vide ou un JSON invalide de Gemini compte comme un échec.
- Les sessions `pending` abandonnées sont remboursées par `sweep_stale_generations` (pg_cron, 30 min).
- **Edge et migration à déployer.** Les 2 lignes bloquées depuis le 22/02/2026 seront remboursées au premier passage du job.
- **Ouvert** : le type de génération n'est toujours pas journalisé dans `generation_log`.

### P1-9 Échelles et interprétation — Résolu

- Échelle inconnue → `none` (`resolveScaleType`, `utils/scoring.ts`), plus jamais `standard` par défaut. Les sous-tests `none` affichent leur valeur saisie.
- Un seul référentiel de zones : z ≤ −2 difficulté, z ≤ −1 fragilité (≈ P2,3 et P15,9 en percentile), utilisé par la saisie, l'aperçu et le PDF.
- Deltas de réévaluation en unités z (seuil ±0,5 ET) ; `detectMetric` ne suppose plus NS pour du brut.
- L'échelle, le z et le percentile sont envoyés à l'IA (`buildScoresEvidence`).

### P1-10 Saisie `raw_only` / `computed_items` — Résolu

`ScoreTable` (tableau unique pour le bilan initial et la réévaluation) rend la colonne « Brut » saisissable. `computed_items`, utilisé par aucun sous-test, est retiré du modèle client.

### P1-11 Réévaluation — Résolu

- Elle démarre avec des scores vides construits depuis le bilan de référence : un sous-test non repassé est « non mesuré », plus « stable ».
- La démo simule la génération ; « Continuer » est disponible sans génération ; le profil adulte/pédiatrique est envoyé ; les 4 sections générées sont toutes conservées.

### P1-12 Brouillons — Résolu

`historicalDate` et `previousAssessmentId` sont sauvegardés ; l'autosave couvre les trois parcours et ignore les sauvegardes périmées ; les sections du bilan historique vivent dans le contexte ; `resetAssessment` passe avant `deleteDraft` ; `saveDraft` et `addAssessment` sont transactionnels.

### P1-13 Calcul de l'âge — Résolu

`calculateAge(dob, referenceDate)` (`utils/patient.ts`) compare correctement les jours (couvert par `utils/patient.test.ts`). L'âge affiché (dashboard, fiche, nouveau bilan) est recalculé depuis la date de naissance au lieu de la valeur figée à l'enregistrement.

### P1-14 Admin : ajout de sous-test — Résolu

`services/admin.ts` envoie `none` / `numeric_4mode` / `{}` ; la RPC `admin_save_test_detail` reçoit les mêmes défauts dans la migration `20260924100000`.

### P1-15 Parcours, divers — Résolu, sauf 2 points

Résolus : `previousAssessmentId` renseigné, « Réévaluation 1 clic » refusée sans bilan de référence (message explicite), brouillon de réévaluation repris depuis le dashboard, suivi à +6 mois créé pour tous les parcours, « Sauver & quitter » conserve la date du bilan historique, garde du stepper propre à chaque parcours, coquille « Péconisations ».

Ouverts (évolutions plutôt que bugs) :

- les deltas ne figurent pas dans le PDF (ils restent recalculables : les scores et le lien vers le bilan de référence sont enregistrés) ;
- on ne peut pas ajouter un nouveau test pendant une réévaluation (seuls les tests du bilan de référence sont proposés).

### P1-16 Création du lien famille — Résolu

`bootstrap_org_for_user` renvoie l'uuid directement ; `hooks/useLinkManager.ts` le lit comme tel, et le client Supabase est désormais typé (`types/supabase.ts`), ce qui aurait signalé l'erreur.

### P1-17 Personnalisation du rapport — Résolu

`ProfileService` (`services/profile.ts`) lit et écrit `practitioners.branding_config` (défauts dans `data/brandingDefaults.ts`) ; `updateBranding` enregistre avec un délai anti-rebond.

### P1-18 Realtime des crédits — Résolu

L'abonnement inopérant est retiré ; les crédits sont rechargés après chaque génération.

### P1-19 Validateur PIN — Résolu

`PinUnlock` ne tente plus de réécrire un validateur protégé par trigger. Les validateurs à 100 000 itérations restent acceptés (`verifyPin`).

### P1-20 Erreurs TypeScript — Résolu

`strict: true`, 0 erreur ; `npm run typecheck` et la CI le vérifient.

## P2 — Structure, hygiène, performance

### P2-1 Schéma, migrations et fonctions hors du repo — Ouvert

- Les 60 migrations historiques appliquées en base ne sont pas dans le repo ; seules les 4 nouvelles (`20260924*`) y sont. Faire un `npx supabase db pull` pour rapatrier le schéma et réaligner l'historique.
- `extract-norms` (v77) est déployée mais absente du repo et inutilisée : la supprimer (manuel).

### P2-2 Création de compte — Ouvert

- `enforce_edge_signup_channel` ne fait rien (`RETURN NEW`) : une inscription directe via `auth.signUp` contourne le rate limit de l'edge `signup`. À vérifier dans les réglages Auth.
- Durée d'essai incohérente : 14 jours demandés par `handle_new_user` et `bootstrap_org_for_user`, 30 jours imposés par le trigger `enforce_subscription_defaults` (c'est lui qui s'applique). Décision produit à prendre.
- 4 organisations sans membre, 6 comptes auth pour 4 praticiens ; `handle_new_user` avale ses erreurs.

### P2-3 `App.tsx` trop gros — Résolu

`App.tsx` n'est plus qu'un routeur. Extraits : `components/app/` (`LandingPage`, `AppHeader`, `ReportViewerOverlay`), `components/assessment/AssessmentWorkspace.tsx`, `hooks/useAssessmentLauncher.ts`. La reconstruction des tests depuis les résultats plats est dans `utils/assessment.ts`.

### P2-4 Doublons — Résolu

Un seul tableau de scores (`ScoreTable`), une seule finalisation (`useAssessmentFlow.finalize`), un seul chemin de génération (`AIService`), des données de graphiques partagées entre l'aperçu et le PDF (`utils/reportData.ts`), un index du catalogue (`utils/catalogIndex.ts`) au lieu de 7 tables de noms.

### P2-5 Code mort — Résolu

Supprimés : environ 580 lignes de `ScorePage`, `scoringEngine`, `subtestMatcher`, `subtestDisplay`, `featureFlags`, `subtestAliases` et son test, `TEST_CATALOG`, les fixtures d'extraction, `services/subscription.ts`, `ReevaluationTableView`, `ScoreTypeReportModal`, `wrapKey` / `unwrapKey`, les types morts. Restent en base : `organization_members.encrypted_org_key` et `organizations.stripe_customer_id`. Les champs legacy de `ScoreResult` restent lus pour les anciens bilans (`normalizeScoreResult`).

### P2-6 Outillage — Résolu

`strict`, scripts `typecheck` et `check`, CI GitHub (`.github/workflows/ci.yml`), règle ESLint `no-unused-vars`, 5 fichiers de tests (42 tests) sur les fonctions pures, `.env.example`, Markdown couvert par Prettier. Reste : `.env` et `.env.production` sont encore suivis par git (variables `VITE_*` publiques seulement).

### P2-7 React — Résolu

Les composants de `ReportView` sont définis au niveau du module ; les mises à jour de `ScorePage` sont immuables.

### P2-8 Base de données, divers — Partiel

- Purge d'`ai_request_log` : migration `20260924100200` (à déployer).
- Ouverts : 4 index inutilisés (`generation_log_user_created_at_idx`, `signup_rate_limit_created_at_idx`, `idx_pending_questionnaires_practitioner`, `idx_official_tests_category`), `admin_audit_log` jamais alimenté.

### P2-9 Bugs trouvés au test navigateur du 2026-09-24 — Résolu

Parcours démo complet (accueil, import d'un questionnaire, bilan initial en 5 étapes, PDF, réévaluation, bilan antérieur, portail famille) :

- le mode démo n'avait pas de catalogue (les vues exigent un compte) : tests affichés par leur identifiant, sans échelle ni conversion. Ajout de `data/demoCatalog.ts`, et données démo réalignées sur les vrais identifiants ;
- « Réévaluation 1 clic » sans effet en démo (patient sans `id`) ;
- âge figé à la valeur enregistrée (dashboard, fiche, en-tête du rapport de réévaluation) ;
- « 10 ans ans » dans le résumé de la fratrie ;
- `<button>` imbriqué dans le catalogue de tests (erreur React) ;
- extension TipTap `underline` en double (déjà incluse dans StarterKit v3) ;
- graduations percentile qui se chevauchaient dans le PDF, encadré « Guide de lecture » coupé entre deux pages ;
- en-tête praticien (crédits, avatar) affiché sur le portail famille ;
- texte démo de réévaluation qui citait un autre patient.

### P2-10 Points relevés à la relecture de la doc (2026-09-25) — Résolu, sauf 4 points

La réécriture des docs contre le code a fait apparaître d'autres défauts.

Corrigés :

- **Faux diffs de style** : `originalContent` gardait le Markdown d'origine alors que `contentFormat` passe à `html` dès qu'une section est éditée ; ouvrir puis enregistrer une section sans rien changer envoyait un diff. `originalContent` est désormais toujours du HTML.
- **Style de la réévaluation** : les préconisations de réévaluation partagent les règles des recommandations du bilan initial ; les autres sections de réévaluation, sans case dans le schéma de feedback, n'alimentent que les règles globales.
- **« Réessayer » après un échec du diagnostic** : il relançait bio + diagnostic et ouvrait une nouvelle session (nouveau crédit). Le résultat « bio » est gardé en mémoire 15 minutes et la relance reprend au diagnostic dans la même session (`AIService.generateInitialReport`). `INVALID_GENERATION_SESSION` a un message lisible.
- **Métriques mixtes en réévaluation** : un score ressaisi dans une autre métrique était affiché « non mesuré » tout en ayant un delta. La valeur est convertie dans la métrique de référence ; « non mesuré » ne dépend plus que de l'absence de saisie, et « non comparable » s'affiche si l'échelle est inconnue.
- **Scores masqués** : les tests ou sous-tests absents du catalogue (test privé supprimé, observation libre) disparaissaient de la réévaluation et, pour un sous-test supprimé, du bilan initial. `resolveTestDef` (`utils/catalogIndex.ts`) les affiche avec une définition de repli.
- **Patient en double possible** : `Step1Admin`, `HistoricalPatientForm` et `persistPatient` créaient le patient sans passer par la promesse partagée du contexte. Ils utilisent tous `useAssessment().ensurePatientId`.
- **Import d'un questionnaire** : si l'enregistrement du brouillon échouait, le patient créé restait orphelin. Le retour arrière couvre maintenant le brouillon et la suppression distante.
- **Section `objectifs`** : encore visible dans les rapports archivés et demandée dans le bilan historique ; masquée partout.
- **Légendes percentile** : « inférieur à 2 » et « entre 2 et 16 » alors que les seuils réels sont 2,3 et 15,9 ; libellés alignés.
- **Divers** : message quand l'application est verrouillée au moment de finaliser (échec silencieux avant), garde contre le double clic sur « Terminer », bouton « Générer (simulation) » en démo au lieu de « 1 crédit », texte légal (`LegalModal`) qui parlait d'anonymisation avec « L'enfant » au lieu de pseudonymisation réversible, commentaire inexact dans la migration `20260924100000`.

Ouverts :

- disposition des pages non enregistrée (voir P1-7) ;
- `loadPatientListPage` lit toute la table `patients` puis pagine en mémoire (acceptable avec quelques centaines de dossiers) ;
- `SubtestDef.displayName` n'est jamais rempli et `subtests_count` est chargé sans être utilisé ;
- `enforce_public_acl_on_ddl` n'a pas de `search_path` fixé (à inclure dans un audit des fonctions SQL).
