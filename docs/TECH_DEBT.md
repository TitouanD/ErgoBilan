# Registre de dette technique

Ce registre recense les bugs, risques et nettoyages connus. L'analyse initiale date du **2026-09-23** (code et base, via le MCP Supabase en lecture seule). Le **2026-09-24**, l'assainissement (branche `refactor/assainissement`, voir [PLAN_ASSAINISSEMENT.md](PLAN_ASSAINISSEMENT.md)) en a traité la plus grande partie. Le **2026-09-25**, la branche a été fusionnée dans `main`, les 4 migrations appliquées et l'edge `generate` déployée (v52). Le **2026-10-02**, cinq migrations du lot suivant ont été appliquées et `generate` redéployée (voir « Mise en production du 2026-10-02 »). Ce document donne l'état de chaque point après ce travail.

**Depuis le 2026-09-29, ce qui reste à faire est suivi dans les [issues GitHub](https://github.com/TitouanD/ErgoBilan/issues)** (voir [ISSUES.md](ISSUES.md)). Ce registre ne garde que l'historique des points traités ; chaque point encore ouvert renvoie à son issue (« → #n »).

Priorités :

- **P0** : confidentialité et sécurité des données de santé.
- **P1** : bug visible par l'utilisateur ou fonctionnalité cassée.
- **P2** : dette structurelle, hygiène, performance.

Statuts :

- **Résolu** : corrigé dans le code et vérifié (`npm run check`, parcours démo dans le navigateur).
- **Manuel** : réglage à faire dans le dashboard Supabase.
- **Ouvert** : non traité ; suivi dans l'issue indiquée.
- **Reporté** / **Risque accepté** : décision de ne pas traiter pour l'instant.

## Tableau de bord

| Point | Sujet                                                | Statut                              |
| ----- | ---------------------------------------------------- | ----------------------------------- |
| P0-1  | Données de santé en clair dans IndexedDB et l'export | Reporté (décision 2026-09-25) → #56 |
| P0-2  | La déconnexion laisse la base ouverte                | Résolu                              |
| P0-3  | L'interface annonce « chiffré »                      | Résolu                              |
| P0-4  | Anonymisation incomplète avant Gemini                | Résolu                              |
| P0-5  | La regex d'anonymisation corrompt des mots           | Résolu                              |
| P0-6  | PIN cassable hors ligne                              | Risque accepté (2026-09-25)         |
| P0-7  | Durcissement edge functions et portail               | Résolu                              |
| P0-8  | Hygiène de la base                                   | Résolu (2026-10-02), sauf → #58     |
| P1-1  | Création de test personnalisé                        | Résolu                              |
| P1-2  | Signalement de type de score                         | Résolu (fonction retirée)           |
| P1-3  | RPC mortes                                           | Résolu                              |
| P1-4  | Purge des questionnaires du portail                  | Résolu                              |
| P1-5  | Style IA appris jamais utilisé                       | Résolu                              |
| P1-6  | Plantage après téléchargement du PDF                 | Résolu                              |
| P1-7  | Mise en page affichée ≠ exportée                     | Résolu                              |
| P1-8  | Crédits et sessions de génération                    | Résolu (2026-10-02)                 |
| P1-9  | Échelles et interprétation des scores                | Résolu                              |
| P1-10 | Saisie `raw_only` / `computed_items`                 | Résolu                              |
| P1-11 | Réévaluation                                         | Résolu                              |
| P1-12 | Brouillons                                           | Résolu                              |
| P1-13 | Calcul de l'âge                                      | Résolu                              |
| P1-14 | Admin : ajout de sous-test                           | Résolu                              |
| P1-15 | Parcours, divers                                     | Résolu                              |
| P1-16 | Création du lien famille                             | Résolu                              |
| P1-17 | Personnalisation du rapport non sauvegardée          | Résolu                              |
| P1-18 | Realtime des crédits inopérant                       | Résolu (abonnement retiré)          |
| P1-19 | Migration du validateur PIN en échec silencieux      | Résolu                              |
| P1-20 | Erreurs TypeScript                                   | Résolu (`strict`, 0 erreur)         |
| P2-1  | Schéma, migrations, `extract-norms` hors du repo     | Résolu (2026-10-02, #63)            |
| P2-2  | Création de compte                                   | Résolu (2026-10-02, #64)            |
| P2-3  | `App.tsx` trop gros                                  | Résolu                              |
| P2-4  | Doublons                                             | Résolu                              |
| P2-5  | Code mort                                            | Résolu (2026-10-02)                 |
| P2-6  | Outillage                                            | Résolu                              |
| P2-7  | Composants React recréés, mutations d'état           | Résolu                              |
| P2-8  | Base de données, divers                              | Résolu (2026-10-02)                 |
| P2-9  | Bugs trouvés au test navigateur du 2026-09-24        | Résolu                              |
| P2-10 | Points relevés à la relecture de la doc (2026-09-25) | Résolu                              |

## Mise en production du 2026-09-25

- Migrations `supabase/migrations/2026092508*` appliquées (droits des RPC, colonnes du portail, purges pg_cron, RLS des journaux).
- Edge `generate` déployée (v52) avec la CLI : `npx supabase functions deploy generate --project-ref hxlsjpkwrqunuqpaukmg --no-verify-jwt --use-api`.
- L'edge `extract-norms` est supprimée (constaté le 2026-09-29). Protection contre les mots de passe compromis (Auth) à activer à la main → #58.

## Mise en production du 2026-10-02

- Migrations appliquées dans l'ordre par `npx supabase db push --linked` : `20261001100000_generation_log_kind.sql` (#60), `20261001100100_inscription_essai_30j.sql` (#64), `20261001100200_nettoyage_vestiges.sql` (#65), `20261001100300_catalogue_corrections.sql` (#50), `20261001100400_catalog_views_security_invoker.sql` (#57). Détail : [DATA_MODEL.md](DATA_MODEL.md) « Schéma et migrations ».
- Edge `generate` déployée depuis le repo après `20261001100000` : `sessionKind` (journalise `generation_log.kind`) et prompt de réévaluation « bilan de référence » (#85). Vérifiée en réel (`E2E_AI=all`, 4 appels, 2 crédits).
- Catalogue vérifié après #57 : un non admin voit 42 tests et 342 sous-tests, un admin 44 et 345, un compte non onboardé rien, `anon` reçoit 42501 ; l'advisor ne signale plus `security_definer_view`.
- Les 60 migrations historiques sont dans le repo (`npx supabase migration fetch --linked`, #63) ; local et distant identiques.
- Orphelins de P2-2 supprimés par Titouan le 2026-10-02 (0 organisation sans membre, 0 compte sans praticien) ; `supabase/schema.sql` ajouté (P2-1).

## Abonnement Stripe (#107) : en test, passage en production à faire

Paiement des formules et des crédits par Stripe, deux soldes de crédits ([ADR 0002](adr/0002-credits-sans-report.md)), plus d'état `subscription_locked` ni de formule illimitée. Code écrit et testé (migration rejouée sur PGlite par `supabase/billing.test.ts`, `supabase/functions/_shared/billing.test.ts`, `components/shared/PricingModal.test.tsx`). Détail : [DATA_MODEL.md](DATA_MODEL.md), [WORKFLOWS.md](WORKFLOWS.md) « Abonnement et paiement ».

Fait le 2026-10-12 : migration `20261012100000_abonnement_stripe.sql` appliquée, `billing` et `stripe-webhook` déployées, compte Stripe de test configuré (produits, prix, portail client, webhook).

Reste à faire :

- fusionner #107 dans `main` rapidement : d'ici là, une inscription en production voit 0 crédit ;
- régénérer `supabase/schema.sql` ;
- passage de Stripe du mode test (bac à sable) à la production : prix aux mêmes clés de recherche (`formule_<plan>`, `unite_<plan>`), point de terminaison du webhook, portail client, clés de production, informations publiques (URL des CGV, exigée par la case à cocher de Checkout).

Points ouverts :

- politique « réservé aux professionnels » (CGU, CGV : pas de droit de rétractation) et article L221-3 du Code de la consommation à faire valider juridiquement ;
- moyens de paiement à restreindre à la carte (avec Apple Pay et Google Pay) dans le tableau de bord Stripe : la version de l'API utilisée ne prend plus `payment_method_types`.

## Observabilité Sentry (2026-09-25)

Instrumentation complète front et edge (voir [ARCHITECTURE.md](ARCHITECTURE.md), section Sentry). `generate` (v53) et `signup` (v28) ont été redéployées le 2026-09-25. Vérification du secret `SENTRY_DSN_BACKEND` et du jeton Vercel `SENTRY_AUTH_TOKEN` → #58. `VITE_SENTRY_ENVIRONMENT` est optionnel (sinon `VERCEL_ENV` est utilisé).

- Tests en local : `VITE_SENTRY_DSN_FRONTEND` et `VITE_SENTRY_ENABLE_IN_DEV=true` dans `.env.local`.

## P0 — Confidentialité et sécurité

### P0-1 Données de santé en clair au repos — Reporté → #56

**Décision du 2026-09-25** : le fonctionnement actuel est accepté. Le PIN est un verrou léger (il faut déjà un accès au poste) et le praticien est responsable de ses données. Au plus, une légère obfuscation du fichier `.ergobilan`, facultative.

- **Où** : tables Dexie de `services/localDB.ts` (`patient`, `tests`, `results`, `report`, `draftData` stockés tels quels) ; export `.ergobilan` en JSON clair (`services/exportService.ts`).
- **Impact** : toute personne ayant accès au navigateur ou au fichier d'export lit les dossiers. Le PIN n'est qu'un verrou d'écran ; la clé qui en dérive ne protège que les clés des questionnaires du portail.
- **Correctif retenu** si le sujet revient → #56.
- Les libellés de l'interface ne prétendent plus que les données sont chiffrées (P0-3).

### P0-2 La déconnexion laisse la base ouverte — Résolu

`StorageService.reset()` ferme la base Dexie (`closeLocalDB`) et vide l'état du module. `logout` et `lock` (`contexts/AuthContext.tsx`) l'appellent.

### P0-3 L'interface annonce « chiffré » — Résolu

Libellés corrigés dans `Step1Admin`, `AuthWizard` et `PinUnlock` (« Privé · Pseudonymisé avant l'envoi à l'IA »).

### P0-4 Anonymisation incomplète — Résolu

Toute la charge utile est construite par `utils/aiPayload.ts` puis pseudonymisée d'un bloc par `anonymizeDeep` (`utils/anonymizer.ts`) : observations, synthèse, rapport précédent en réévaluation, diffs de style. La table couvre le patient, les deux parents (noms, téléphones, e-mails), la fratrie, les professionnels du suivi, l'école, l'enseignant et les médecins. Depuis #53 et #54, c'est le générateur (`utils/reportGenerator.ts`) qui anonymise : table, mots masqués par le praticien, dates précises (voir AI_PIPELINE §4).

### P0-5 La regex corrompt des mots — Résolu

Frontières Unicode (`\p{L}\p{N}`), placeholders numérotés et réversibles, réhydratation échappée en HTML. Couvert par `utils/anonymizer.test.ts` (« Ali » / « qualité », « Eva » / « Evaluation »).

### P0-6 Le PIN peut être cassé hors ligne — Risque accepté

**Décision du 2026-09-25** : risque accepté avec P0-1 ; pas de clé de secours pour l'instant.

- PIN de 6 chiffres ; sel et validateur PBKDF2 lisibles par l'utilisateur dans `practitioners` ; verrouillage après erreurs en `localStorage` ; sel modifiable par UPDATE (DB).
- Ne devient critique qu'avec P0-1. À traiter ensemble : code plus long ou phrase de passe, validateur non renvoyé au client ou lié à un secret serveur.

### P0-7 Durcissement des edge functions et du portail — Résolu

- `generate` : loopback autorisé seulement hors production, CORS qui renvoie l'origine autorisée (plus de `*`), plus de repli « fail-open » sur des RPC absentes.
- Portail : la clé ne circule plus que dans le fragment `#key=` (repli `?key=` supprimé).
- Colonnes modifiables par la famille : restreintes par GRANT de colonne et `WITH CHECK status = 'completed'` dans `20260925082742_portal_family_column_grants.sql`.

### P0-8 Hygiène de la base — Résolu (2026-10-02), sauf → #58

- RLS sur `ai_request_log` et `signup_rate_limit_log` : `20260925082802_rls_on_internal_logs.sql`.
- REVOKE `anon` sur les RPC `admin_*` et `search_path` fixé : `20260925082729_fix_client_rpc_grants.sql`.
- Vues `view_unified_*` en `security_invoker = on`, GRANT SELECT par colonne à `authenticated` sur `official_tests` et `official_subtests`, policy RESTRICTIVE `catalog_read_requires_onboarded` : `20261001100400_catalog_views_security_invoker.sql` (#57, appliquée le 2026-10-02 ; retour arrière dans `supabase/rollback/`).
- **Manuel** : protection contre les mots de passe compromis → #58.

## P1 — Bugs fonctionnels

### P1-1 Création de test personnalisé — Résolu

- Côté client : catégorie `autre`, échelle par défaut `none`, `reloadCatalog()` forcé après création (`TestCatalogModal`).
- GRANT EXECUTE à `authenticated` (migration `20260925082729`, appliquée).

### P1-2 Signalement de type de score — Résolu

La fonctionnalité avait été retirée volontairement (commit `f579589`) ; le composant orphelin `ScoreTypeReportModal` a été supprimé.

### P1-3 RPC mortes — Résolu

`get_contextual_recommendations` et `upsert_recommendation` (table `recommendation_crowd` disparue) ont été supprimées (migration `20260925082729`).

### P1-4 Purge du portail — Résolu

- `purge_pending_questionnaires` + pg_cron (14 j `pending`, 30 j `completed`) dans `20260925082801_scheduled_cleanups.sql`. L'edge `purge-pending`, jamais déployée, est supprimée du repo.
- Import d'un questionnaire (`hooks/usePendingProcessor.ts`) : le patient est créé en local, puis la ligne distante est supprimée ; si la suppression échoue, la création locale est annulée. Plus de doublon possible.

### P1-5 Style IA appris — Résolu

`practitioner` est passé à `useAssessmentFlow` ; les préférences sont envoyées aux deux générations et `refreshProfile` les recharge après apprentissage.

### P1-6 Plantage après le PDF — Résolu

`const toast = useToast()` dans `ExportPage`.

### P1-7 Mise en page affichée ≠ exportée — Résolu

- La disposition des pages est remontée dans `ExportPage` et partagée par `ReportView` (édition, déplacement) et `PdfDocument` (prop `pages`).
- Chaque page de l'aperçu commence une nouvelle page du PDF (corrigé le 2026-09-25 : le PDF enchaînait tout).
- `chartType` et `scoreDisplayModes` sont enregistrés dans le branding.
- La disposition des pages est enregistrée avec le bilan en cours (`reportPages`, donc dans le brouillon) puis avec le rapport finalisé (`report.pages`) ; elle est reprise par `resolvePages` (`utils/reportData.ts`), repli sur la disposition par défaut (#59).
- La section `objectifs` est masquée partout (`HIDDEN_SECTION_IDS` dans `utils/reportData.ts`).

### P1-8 Crédits et sessions de génération — Résolu (2026-10-02)

- Un diagnostic en échec libère le verrou de session : le retry fonctionne sans nouveau crédit.
- Une réponse vide ou un JSON invalide de Gemini compte comme un échec.
- Les sessions `pending` abandonnées sont remboursées par `sweep_stale_generations` (pg_cron, 30 min).
- Les 2 lignes bloquées depuis le 22/02/2026 sont remboursées par ce job.
- Type de génération journalisé dans `generation_log.kind` (`report_bio`, `report_reevaluation`) par `consume_credit_for_user(p_user_id, p_kind?)` : `20261001100000_generation_log_kind.sql` (#60) et edge `generate` du 2026-10-02.

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

`services/admin.ts` envoie `none` / `numeric_4mode` / `{}` ; la RPC `admin_save_test_detail` reçoit les mêmes défauts dans la migration `20260925082729`.

### P1-15 Parcours, divers — Résolu

Résolus : deltas dans l'aperçu et le PDF de réévaluation (#61, colonne « Évolution »), `previousAssessmentId` renseigné, « Réévaluation 1 clic » refusée sans bilan de référence (message explicite), brouillon de réévaluation repris depuis le dashboard, suivi à +6 mois créé pour tous les parcours, « Sauver & quitter » conserve la date du bilan historique, garde du stepper propre à chaque parcours, coquille « Péconisations », ajout d'un test absent du bilan de référence pendant une réévaluation (#62).

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

### P2-1 Schéma, migrations et fonctions hors du repo — Partiel → #63

- Les 60 migrations historiques sont dans le repo depuis le 2026-10-02 (`npx supabase migration fetch --linked`) ; local et distant identiques.
- **Résolu** : la création des tables, absente des migrations, est dans `supabase/schema.sql` (2026-10-02).
- `extract-norms` : supprimée (constaté le 2026-09-29).

### P2-2 Création de compte — Résolu (2026-10-02, #64)

`20261001100100_inscription_essai_30j.sql` (#64) :

- une seule implémentation, `ensure_org_and_subscription` (interne, aucun droit client, verrou consultatif par utilisateur) : `handle_new_user` et `bootstrap_org_for_user` lui délèguent ; organisation « Mon Cabinet » ;
- essai de 30 jours partout (plus de 14 jours) ;
- `handle_new_user` ne bloque toujours pas l'inscription, mais journalise l'erreur (`RAISE WARNING` avec SQLSTATE) ;
- `enforce_edge_signup_channel` (vide) et son trigger supprimés : l'inscription passe par `supabase.auth.signUp`, protégée par le CAPTCHA Turnstile et les limites d'Auth ; l'edge `signup` fait l'onboarding ensuite.
- **Résolu** : les 4 organisations sans membre et les 2 comptes Auth sans praticien ont été supprimés par Titouan le 2026-10-02 (`supabase/checks/20261001100100_orphelins.sql`).

### P2-3 `App.tsx` trop gros — Résolu

`App.tsx` n'est plus qu'un routeur. Extraits : `components/app/` (`LandingPage`, `AppHeader`, `ReportViewerOverlay`), `components/assessment/AssessmentWorkspace.tsx`, `hooks/useAssessmentLauncher.ts`. La reconstruction des tests depuis les résultats plats est dans `utils/assessment.ts`.

### P2-4 Doublons — Résolu

Un seul tableau de scores (`ScoreTable`), une seule finalisation (`useAssessmentFlow.finalize`), un seul chemin de génération (`utils/reportGenerator.ts`, depuis #53 ; `AIService` avant), des données de graphiques partagées entre l'aperçu et le PDF (`utils/reportData.ts`), un index du catalogue (`utils/catalogIndex.ts`) au lieu de 7 tables de noms.

### P2-5 Code mort — Résolu

Supprimés : environ 580 lignes de `ScorePage`, `scoringEngine`, `subtestMatcher`, `subtestDisplay`, `featureFlags`, `subtestAliases` et son test, `TEST_CATALOG`, les fixtures d'extraction, `services/subscription.ts`, `ReevaluationTableView`, `ScoreTypeReportModal`, `wrapKey` / `unwrapKey`, les types morts. `organization_members.encrypted_org_key` et `organizations.stripe_customer_id` ont été supprimées en base le 2026-10-02 (`20261001100200_nettoyage_vestiges.sql`, #65). Les champs legacy de `ScoreResult` restent lus pour les anciens bilans (`normalizeScoreResult`).

### P2-6 Outillage — Résolu

`strict`, scripts `typecheck` et `check`, CI GitHub (`.github/workflows/ci.yml`), règle ESLint `no-unused-vars`, 5 fichiers de tests (42 tests) sur les fonctions pures, `.env.example`, Markdown couvert par Prettier. `.env` et `.env.production` ne sont plus suivis par git : variables dans Vercel (#66).

### P2-7 React — Résolu

Les composants de `ReportView` sont définis au niveau du module ; les mises à jour de `ScorePage` sont immuables.

### P2-8 Base de données, divers — Résolu (2026-10-02)

- Purge d'`ai_request_log` : fait (migration `20260925082801`).
- `20261001100200_nettoyage_vestiges.sql` (#65) : index `signup_rate_limit_created_at_idx` et `idx_pending_questionnaires_practitioner` supprimés ; `idx_official_tests_category` et `generation_log_user_created_at_idx` conservés (seuls index d'une clé étrangère) ; table `admin_audit_log` et fonction `update_admin_audit_log_timestamp` supprimées.

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

### P2-10 Points relevés à la relecture de la doc (2026-09-25) — Résolu

La réécriture des docs contre le code a fait apparaître d'autres défauts.

Corrigés :

- **Faux diffs de style** : `originalContent` gardait le Markdown d'origine alors que `contentFormat` passe à `html` dès qu'une section est éditée ; ouvrir puis enregistrer une section sans rien changer envoyait un diff. `originalContent` est désormais toujours du HTML.
- **Style de la réévaluation** : les préconisations de réévaluation partagent les règles des recommandations du bilan initial ; les autres sections de réévaluation, sans case dans le schéma de feedback, n'alimentent que les règles globales.
- **« Réessayer » après un échec du diagnostic** : il relançait bio + diagnostic et ouvrait une nouvelle session (nouveau crédit). Le résultat « bio » est gardé en mémoire 15 minutes et la relance reprend au diagnostic dans la même session (`AIService.generateInitialReport`). `INVALID_GENERATION_SESSION` a un message lisible.
- **Métriques mixtes en réévaluation** : un score ressaisi dans une autre métrique était affiché « non mesuré » tout en ayant un delta. La valeur est convertie dans la métrique de référence ; « non mesuré » ne dépend plus que de l'absence de saisie, et « non comparable » s'affiche si l'échelle est inconnue.
- **Scores masqués** : les tests ou sous-tests absents du catalogue (test privé supprimé, observation libre) disparaissaient de la réévaluation et, pour un sous-test supprimé, du bilan initial. `resolveTestDef` (`utils/catalogIndex.ts`) les affiche avec une définition de repli.
- **Champs de catalogue inutiles** (#68) : `SubtestDef.displayName`, jamais rempli, est retiré avec ses replis (le nom du catalogue suffit) ; `subtests_count` n'est plus demandé à `view_unified_catalog`.
- **Liste des patients paginée en mémoire** (#67) : `loadPatientListPage` lisait toute la table avant de découper la page ; elle lit désormais la page dans Dexie (`offset().limit()` sur l'index `lastInteraction`, sans changement de schéma). Ordre, `hasMore` et `nextOffset` inchangés, épinglés par `services/storage.test.ts`.
- **Patient en double possible** : `Step1Admin`, `HistoricalPatientForm` et `persistPatient` créaient le patient sans passer par la promesse partagée du contexte. Ils utilisent tous `useAssessment().ensurePatientId`.
- **Import d'un questionnaire** : si l'enregistrement du brouillon échouait, le patient créé restait orphelin. Le retour arrière couvre maintenant le brouillon et la suppression distante.
- **Section `objectifs`** : encore visible dans les rapports archivés et demandée dans le bilan historique ; masquée partout.
- **Légendes percentile** : « inférieur à 2 » et « entre 2 et 16 » alors que les seuils réels sont 2,3 et 15,9 ; libellés alignés.
- **Divers** : message quand l'application est verrouillée au moment de finaliser (échec silencieux avant), garde contre le double clic sur « Terminer », bouton « Générer (simulation) » en démo au lieu de « 1 crédit », texte légal (`LegalModal`) qui parlait d'anonymisation avec « L'enfant » au lieu de pseudonymisation réversible, commentaire inexact dans la migration `20260925082729`.

À noter :

- `enforce_public_acl_on_ddl` : `search_path` désormais fixé à `public` (constaté en base le 2026-09-29).
