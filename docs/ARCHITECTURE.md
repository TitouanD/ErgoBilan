# Architecture d'ErgoBilan

> État du code sur la branche `refactor/assainissement` (septembre 2026, après l'assainissement décrit dans [PLAN_ASSAINISSEMENT.md](PLAN_ASSAINISSEMENT.md)). Les faits sur la base Supabase (tables, RPC, edge functions déployées) ont été relevés en lecture seule le 2026-09-23. Toute description « backend aveugle / MasterKey → OrgKey → FileKey » rencontrée ailleurs est obsolète.

## 1. Vue d'ensemble

SPA React 19 (Vite, TypeScript) pour ergothérapeutes pédiatriques. **Local-first** : toutes les données patients (identité, anamnèse, scores, rapports, brouillons, suivis) vivent **en clair** dans IndexedDB, une base Dexie par praticien ([TECH_DEBT.md](TECH_DEBT.md) P0-1). Supabase ne sert qu'aux données non médicales (compte, abonnement, crédits, catalogue de tests) et au transit chiffré des questionnaires du portail parents. La génération de rapports passe par l'edge function `generate`, qui appelle Gemini.

```text
┌──────────────────────── Navigateur du praticien ────────────────────────┐
│ React 19 (App.tsx = providers + routeur interne `mode`)                 │
│  ├─ Contexts : Theme / Auth / Catalog / Toast / Assessment              │
│  ├─ StorageService ──► Dexie  ErgoBilanDB_${userId}  (EN CLAIR)         │
│  ├─ ExportService  ──► fichier .ergobilan (JSON non chiffré)            │
│  ├─ reportGenerator (aiPayload + anonymisation) ──► charge utile        │
│  └─ utils/crypto   ──► PIN→PBKDF2 (verrou), AES-GCM (portail)           │
└──────────────┬──────────────────────────────────────────┬──────────────┘
               │ supabase-js typé (JWT)                   │ fetch /functions/v1/generate
┌──────────────▼───────────────── Supabase ───────────────▼──────────────┐
│ Auth (email+mdp, Turnstile)   Postgres + RLS            Edge functions  │
│                               practitioners,            generate ──────┼──► Gemini API
│                               subscriptions,            signup         │
│                               catalogue (vues),         extract-norms* │
│                               pending_questionnaires    (* hors repo)  │
└──────────────▲─────────────────────────────────────────────────────────┘
               │ client anonyme + header x-questionnaire-token
┌──────────────┴──────── Portail parents (même SPA) ─────────────────────┐
│ /?q_id=<id>&t=<token>#key=<clé AES>  → PatientPortal (chiffre/déchiffre)│
└─────────────────────────────────────────────────────────────────────────┘
```

## 2. Stack et outillage

| Domaine        | Choix                                                                         |
| -------------- | ----------------------------------------------------------------------------- |
| UI             | React 19.2, Tailwind 3, lucide-react, TipTap 3 (éditeur), Recharts 3, dnd-kit |
| PDF            | `@react-pdf/renderer` (chunk `pdf-vendor`, `vite.config.ts`)                  |
| Stockage local | Dexie 4 (IndexedDB)                                                           |
| Backend        | `@supabase/supabase-js` 2.39.7 (épinglé), edge functions Deno                 |
| Observabilité  | `@sentry/react`, `@vercel/analytics`, `@vercel/speed-insights`                |
| Anti-bot       | `@marsidev/react-turnstile` (captcha Supabase Auth)                           |
| Outillage      | Vite 6, TypeScript ~5.8 (`strict`), Vitest 4, ESLint 9, Prettier 3            |

Scripts `package.json` : `dev` (Vite, port 3000), `build`, `preview`, `test` (`vitest run`), `test:watch`, `lint` (`--max-warnings 0`), `lint:fix`, `typecheck` (`tsc --noEmit`), `format`, `format:check` (Markdown compris), et `check` = lint + typecheck + test + build, à lancer avant de rendre la main.

- Tests : `vitest.config.ts` inclut `utils/**/*.test.ts`, `services/**/*.test.ts` (IndexedDB simulée par `fake-indexeddb`) et `components/**/*.test.tsx` (jsdom).
- CI : `.github/workflows/ci.yml` lance `npm run check` (Node 20) sur les push vers `main` et les pull requests, avec des valeurs factices pour `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`.
- Types Supabase générés dans `types/supabase.ts` ; le client est créé par `createClient<Database>` (`services/db.ts`).
- `supabase/migrations/` ne contient que les 4 migrations `20260924*`, appliquées le 2026-09-25 ; l'historique des migrations de la base n'est pas dans le repo ([TECH_DEBT.md](TECH_DEBT.md) P2-1).

## 3. Arborescence commentée

| Chemin                                                                         | Rôle                                                                                                                                     |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `index.tsx`                                                                    | Point d'entrée : `initSentry()`, profiler Sentry, `<Analytics/>`, `<SpeedInsights/>`                                                     |
| `App.tsx`                                                                      | Providers + `AppRouter` : routage par état `mode`, branchement des hooks, rendu de l'écran courant                                       |
| `components/app/`                                                              | `LandingPage` (accueil, modale de connexion, entrées portail et démo), `AppHeader` (crédits, menu compte, backup), `ReportViewerOverlay` |
| `components/assessment/AssessmentWorkspace.tsx`                                | Stepper et étapes des trois parcours, gardes de navigation, modales (quitter, confirmation de génération, erreur IA)                     |
| `components/assessment/`                                                       | Étapes par parcours (`initial/`, `reevaluation/`, `historical/`), pages partagées (`pages/`), composants partagés (`shared/`)            |
| `components/assessment/pages/score/`                                           | `TestCatalogModal` (choix de tests, test personnalisé), `ScoreSummaryPanel` (z moyen par test), utilisés par `ScorePage`                 |
| `components/assessment/shared/ScoreTable.tsx`                                  | Tableau de saisie des scores unique (`ScorePage` et réévaluation `Step1Scores`)                                                          |
| `components/dashboard/`, `portal/`, `auth/`, `admin/`, `shared/`               | Tableau de bord et fiche patient, portail parents, auth/PIN, panneau admin, modales et formulaires partagés                              |
| `contexts/`                                                                    | 5 contextes React (§4)                                                                                                                   |
| `hooks/useAssessmentLauncher.ts`                                               | `startAssessment` / `resumeDraft` : adaptateur de `start` / `resume` (messages)                                                          |
| `hooks/useAssessmentFlow.ts`                                                   | `generateInitialReport`, `generateReevaluation`, `finalize`, `saveAndQuit`                                                               |
| `hooks/useDataLoader.ts`                                                       | Chargement paginé des patients, index des brouillons, questionnaires en attente (+ realtime `dashboard-pending`)                         |
| `hooks/useLinkManager.ts`, `usePendingProcessor.ts`                            | Liens du portail parents ; import d'un questionnaire rempli                                                                              |
| `hooks/useFavoriteTests.ts`, `useVoiceDictation.ts`                            | Tests favoris/récents (localStorage) ; dictée vocale                                                                                     |
| `services/db.ts`                                                               | Client Supabase typé, `ensureFreshSession`, `getVerifiedAccessToken`                                                                     |
| `services/localDB.ts`, `storage.ts`                                            | Schéma Dexie par utilisateur (+ migration de l'ancienne base globale) ; façade `StorageService`                                          |
| `services/exportService.ts`                                                    | Export/import du fichier de sauvegarde `.ergobilan`                                                                                      |
| `services/profile.ts`                                                          | `ProfileService` : profil, abonnement, branding (`practitioners.branding_config`), préférences de style IA                               |
| `services/ai.ts` → `aiProxy.ts`                                                | Les deux générateurs (edge, démo) ; transport HTTP de l'edge function `generate`                                                         |
| `services/admin.ts`, `sentryService.ts`                                        | RPC `admin_*` et `practitioner_save_custom_test` ; init Sentry front                                                                     |
| `utils/patient.ts`                                                             | Âge (`calculateAge(dob, referenceDate)`, `getPatientAgeForIdentity`), `isPatientCreationReady`, signature d'identité                     |
| `utils/reportGenerator.ts`, `aiPayload.ts`, `anonymizer.ts`, `suspectTerms.ts` | Seul point d'appel à l'IA : charge utile, anonymisation (`createAnonymization`), mots suspects, réhydratation                            |
| `utils/resolvedScore.ts`                                                       | Score résolu : seul point d'entrée pour lire un score (noms, échelle, z, percentile, zone, format)                                       |
| `utils/scoring.ts`, `catalogIndex.ts`, `catalogNames.ts`, `subtestOrdering.ts` | Calculs, échelles et zones ; index O(1) du catalogue ; normalisation des noms pour la recherche ; ordre d'affichage                      |
| `utils/assessment.ts`                                                          | Construction d'un bilan finalisé, bilan de référence, reconstruction des tests depuis `results`                                          |
| `utils/reevaluationHelpers.ts`                                                 | Deltas de réévaluation en unités z, résumés envoyés à l'IA                                                                               |
| `utils/reportData.ts`, `reportContent.ts`, `reportTheme.ts`                    | Données des graphiques et mise en page (aperçu et PDF), conversions de contenu des sections, thème du rapport                            |
| `utils/crypto.ts`, `pdfRenderer.tsx`, `pdfStyles.ts`, autres                   | Web Crypto (§8) ; rendu PDF ; `textSanitizer`, `logger`, `backupTracking`, `aiHelpers`                                                   |
| `data/`                                                                        | Types du catalogue + `ICON_MAP` (`testCatalog.ts`), `brandingDefaults.ts`, données démo (`demoData`, `demoCatalog`, `demoReport`)        |
| `supabase/functions/`                                                          | `generate/` (`index.ts` + `prompts.ts`), `signup/`, `_shared/sentry.ts`                                                                  |

## 4. Arbre des providers et contextes

`index.tsx` monte `<React.StrictMode>` → App enveloppé par `withSentryProfiler` + `<Analytics/>` + `<SpeedInsights/>`. Puis `App` :

```text
ThemeProvider → AuthProvider → CatalogProvider → ToastProvider → AssessmentProvider → AppRouter
```

| Contexte                | Rôle                                                                                                                                                                                                                                                                                               |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ThemeContext.tsx`      | Clair/sombre, persisté dans `localStorage` sous `ergobilan.theme`                                                                                                                                                                                                                                  |
| `AuthContext.tsx`       | Machine d'état typée `AuthState` : session Supabase, `practitioner`, `userProfile` (crédits, plan, branding), `sessionKey`, mode démo, verrou d'inactivité de 15 min, heartbeat JWT toutes les 4 min, `updateBranding` (enregistrement différé de 800 ms), `verifyAdminAccess` (RPC `admin_check`) |
| `CatalogContext.tsx`    | Catalogue chargé à la demande (`ensureCatalogLoaded`, `reloadCatalog`) depuis `view_unified_catalog` / `view_unified_subtests`, exposé avec son `index` (`utils/catalogIndex.ts`). Sans session (mode démo), il utilise `data/demoCatalog.ts`. Oublié à la déconnexion                             |
| `ToastContext.tsx`      | Notifications éphémères (`const toast = useToast()`)                                                                                                                                                                                                                                               |
| `AssessmentContext.tsx` | Expose le bilan en cours (`utils/assessmentInProgress.ts` : état, modifications, intentions de cycle de vie, création de la fiche, autosave du brouillon pour les trois parcours) ; la fiche patient fait foi pour l'identité (voir [WORKFLOWS.md](WORKFLOWS.md) §5)                               |

`ToastProvider` est placé sous `AuthProvider` et `CatalogProvider` : ces deux contextes ne peuvent donc pas afficher de toast.

## 5. Routage interne

Il n'y a pas de routeur d'URL. `AppRouter` garde un état `mode` (`landing`, `dashboard`, `detail`, `assessment`, `portal`, `admin`, `profile`) et `previousMode` (retour depuis le profil). Avant de regarder `mode`, le rendu court-circuite dans cet ordre : portail parents, chargement (`isLoading` ou `authenticating`), `network_error` (`NetworkErrorScreen`), écran PIN si `authState === 'locked'` hors démo.

| `mode`       | Déclencheurs                                                                                               | Rendu                                                                                         |
| ------------ | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `landing`    | Valeur initiale ; `authState` `unauthenticated` ou `registering`                                           | `LandingPage` (connexion, `AuthWizard`, boutons « Espace Famille » et démo)                   |
| `dashboard`  | Passage de `landing` à `authenticated`, `subscription_locked` (+ paywall), retour depuis un autre écran    | `Dashboard`                                                                                   |
| `detail`     | `openPatient` depuis le dashboard (`StorageService.loadPatientDetails`)                                    | `PatientDetail` ; `ReportViewerOverlay` en superposition pour un bilan archivé                |
| `assessment` | `startAssessment` (nouveau bilan, bilan antérieur, réévaluation), `resumeDraft`, import d'un questionnaire | `AssessmentWorkspace`                                                                         |
| `portal`     | Lien famille détecté au premier rendu, ou bouton « Espace Famille »                                        | `PatientPortal` seul, sans en-tête praticien                                                  |
| `admin`      | `openAdmin` après `verifyAdminAccess()` côté serveur                                                       | `AdminPanel` en plein écran, qui revérifie avec `AdminService.adminCheck` (RPC `admin_check`) |
| `profile`    | Menu compte ou lien depuis l'éditeur de design de l'export                                                 | `ProfileEditor`, qui revient à `previousMode`                                                 |

Hors `landing`, `admin` et `portal`, l'écran est entouré de `AppHeader`, du bandeau démo, de `GlobalErrorBoundary` et d'`OfflineIndicator`. Les écrans lourds (`PatientDetail`, `ProfileEditor`, `AdminPanel`, `PricingModal`, `OnboardingExperience`, et la plupart des étapes de bilan) sont chargés avec `React.lazy`.

**Portail parents** : `detectPortalUrl` est évalué au premier rendu ; il renvoie l'URL si elle contient `q_id` en query **et** `key=` dans le hash. `PatientPortal` est alors rendu immédiatement, sans chargement d'auth ni écran PIN. En quittant le portail, `?q_id=…#key=…` est retiré de la barre d'adresse (`history.replaceState`). Format du lien : `/?q_id=<id>&t=<access_token>#key=<clé>` (`hooks/useLinkManager.ts` → `handleGenerateLink`).

## 6. Cycle d'authentification

**Inscription** (`components/auth/AuthWizard.tsx` → `handleFinalSubmit`) :

1. `setWizardActive(true)` bloque `loadUser` pendant que le wizard travaille, puis `supabase.auth.signUp` est appelé avec `options.captchaToken` si Turnstile est configuré. Le captcha est vérifié par **Supabase Auth**, pas par l'edge function. Il est désactivé en mode complétion de profil.
2. Si Supabase ne renvoie pas de session (email à confirmer), le wizard s'arrête et `LandingPage` affiche l'écran « Confirmer le mail ».
3. `setupPin(pin)` génère le salt et le validator côté client (PIN de 6 chiffres).
4. `supabase.functions.invoke('signup')` : l'edge function valide le JWT elle-même, appelle la RPC `bootstrap_practitioner_for_user`, met à jour `practitioners` avec l'identité et `encryption_salt` / `encryption_validator`, puis appelle `bootstrap_org_for_user`.
5. `handleWizardComplete` (`App.tsx`) : `setSessionKey`, `reloadUserFromSession`, puis `unlockSession` si l'état revient à `locked`, et affichage de l'onboarding.

**Connexion** : `LandingPage` → `handleLogin` appelle `signInWithPassword`, avec captcha Turnstile si configuré. Au démarrage (`AuthProvider`, effet d'initialisation), la session en cache (`localStorage`, clé `ergobilan.auth`) est réutilisée, sauf si la dernière connexion date de plus de `VITE_FORCE_PASSWORD_REAUTH_DAYS` jours (2 par défaut, 0 désactive). Un timeout de sécurité de 8 s bascule en `network_error`.

**Phase 1, fast-lock** (`loadUser`) : seule la ligne `practitioners` est lue. Si le salt ou le validator manque, ou vaut `pending`, l'état passe à `registering` et le wizard s'ouvre en complétion de profil. Sinon l'état passe à `locked`. Si aucune ligne n'existe, la RPC `bootstrap_practitioner_for_user` sert de réparation.

**Déverrouillage PIN** (`components/auth/PinUnlock.tsx`) : la vérification se lance dès le 6ᵉ chiffre (`verifyPin`). Les validators créés à 100 000 itérations restent acceptés mais ne sont plus réécrits ([TECH_DEBT.md](TECH_DEBT.md) P1-19). Anti-brute-force : 5 essais, puis blocages de 30 s à 10 min, stockés dans `localStorage` sous `pin_lockout` (purement client). Ensuite `unlockSession` rafraîchit le JWT, stocke `sessionKey`, appelle `StorageService.setCurrentUser` (ouvre la base Dexie et lance la migration de l'ancienne base globale), puis `hydrateProfile`.

**Phase 2** (`hydrateProfile`) : `bootstrap_org_for_user` et `ProfileService.getUserProfile` tournent en parallèle. Sans abonnement `active` ou `trialing` (ou sans ligne `subscriptions`), l'état passe à `subscription_locked` et le paywall s'affiche. En cas d'erreur ou de timeout, l'app dégrade vers `authenticated`. Il n'y a plus d'abonnement realtime aux crédits : `refreshProfile` les recharge après chaque génération.

**Verrouillage / déconnexion** : `lockSession` (inactivité) et `logout` appellent `StorageService.reset()`, qui ferme la base Dexie (`closeLocalDB`) et oublie l'utilisateur courant. `useDataLoader` vide aussi les listes en mémoire quand l'état passe à `locked` ou `unauthenticated`. Les données restent néanmoins lisibles en clair dans IndexedDB sur le poste (P0-1).

**Mode démo** : `startDemo` passe `StorageService` en démo, crée un praticien fictif (plan « expert », branding personnalisé) et une clé aléatoire. Aucun appel Supabase ni IA : voir [WORKFLOWS.md](WORKFLOWS.md) §9.

## 7. Frontière local / Supabase

| Donnée                                                                                                 | Où elle vit                                                         | Chiffrée ?                                        |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- | ------------------------------------------------- |
| Patients (identité, anamnèse, aperçu dashboard `previewMeta`)                                          | Dexie `ErgoBilanDB_${userId}.patients`                              | Non                                               |
| Bilans (scores, rapports, `kind`, `previousAssessmentId`)                                              | Dexie `.assessments`                                                | Non                                               |
| Brouillons, rappels                                                                                    | Dexie `.drafts`, `.followups`                                       | Non                                               |
| Sauvegarde `.ergobilan`                                                                                | Fichier téléchargé (`ExportService.exportAll`)                      | Non                                               |
| Profil praticien, crédits, `is_admin`, `ai_style_preferences`, `branding_config`                       | Supabase `practitioners`                                            | Non                                               |
| Salt + validator du PIN                                                                                | Supabase `practitioners.encryption_salt` / `encryption_validator`   | Le validator est un jeton AES-GCM                 |
| Abonnement                                                                                             | Supabase `subscriptions`                                            | Non                                               |
| Organisation                                                                                           | Supabase (RPC `bootstrap_org_for_user`)                             | Non                                               |
| Catalogue de tests                                                                                     | Supabase (`view_unified_*`, `official_categories`, RPC `admin_*`)   | Non                                               |
| Questionnaire parents                                                                                  | Supabase `pending_questionnaires.family_encrypted_data`             | Oui, AES-GCM avec la clé du lien                  |
| Clé du questionnaire                                                                                   | Hash de l'URL + `pending_questionnaires.practitioner_encrypted_key` | Oui dans la table, chiffrée par `sessionKey`      |
| Journal des générations, rate limit                                                                    | Supabase `generation_log`, `ai_request_log` + RPC                   | Non                                               |
| Texte envoyé à Gemini                                                                                  | Transit via `generate`                                              | Pseudonymisé (`createAnonymization`), pas chiffré |
| Thème, favoris/récents, blocage PIN, date du dernier backup, brouillon d'inscription, session Supabase | `localStorage`                                                      | Non                                               |

Un questionnaire importé est enregistré en local, puis la ligne distante est supprimée ; si la suppression échoue, l'import local est annulé (`usePendingProcessor`). La purge automatique des questionnaires non importés dépend de la migration `20260924100200_scheduled_cleanups.sql` (pg_cron), appliquée le 2026-09-25.

## 8. Crypto réellement utilisée (`utils/crypto.ts`)

- **Dérivation** : `deriveMasterKey` utilise PBKDF2-SHA256 avec 600 000 itérations et produit une clé AES-GCM 256 bits exportable. Le salt fait 16 octets aléatoires encodés en hex et passés comme **texte** UTF-8.
- **Chiffrement** : `encryptData` / `decryptData` appliquent AES-GCM à `JSON.stringify(data)`, avec un IV de 12 octets en hex et un contenu en base64. Le format stocké est `"<ivHex>:<base64>"`.
- **PIN** : `setupPin` produit le validator, chiffrement de la constante `ERGOBILAN_VALID_TOKEN`. `verifyPin` teste 600 000 puis 100 000 itérations et renvoie toujours la clé dérivée à 600 000 itérations. Salt et validator étant lisibles dans `practitioners`, le PIN peut être retrouvé hors ligne (P0-6).
- **`sessionKey`** : clé dérivée du PIN, gardée en mémoire React. Elle sert de verrou (sa présence vaut déverrouillage) et à chiffrer/déchiffrer la clé des questionnaires (`useLinkManager`, `usePendingProcessor`). **Elle ne chiffre pas les données au repos.** Les anciennes `wrapKey` / `unwrapKey` ont été supprimées.
- **Portail** : `generateQuestionnaireKey` crée une clé AES-GCM 256 aléatoire, exportée en JWK puis en base64 ; `importQuestionnaireKey` la relit depuis `#key=` (la clé ne passe plus jamais en query string). Côté parent, `PatientPortal` utilise un client anonyme avec le header `x-questionnaire-token` pour les politiques RLS, déchiffre les données existantes, puis chiffre la réponse et passe la ligne à `completed`.

## 9. Edge functions, déploiement et observabilité

| Function        | Repo                                                  | Déployée         | Rôle                                                                                                                                                                                                                                                                                                                                                                    |
| --------------- | ----------------------------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `generate`      | `supabase/functions/generate/index.ts` + `prompts.ts` | v52 (2026-09-25) | Gemini `gemini-3-flash-preview`. Contrôle d'origine (CORS qui renvoie l'origine autorisée), JWT, rate limit (`check_rate_limit_for_user`), limite de payload, crédit (`consume_credit_for_user`), session dans `generation_log`. Tâches : `report_bio`, `report_diagnostic`, `report_reevaluation`, `extract_style_feedback`. Détail : [AI_PIPELINE.md](AI_PIPELINE.md) |
| `signup`        | `supabase/functions/signup/index.ts`                  | oui (v27)        | Provisioning praticien, organisation et matériel PIN (§6)                                                                                                                                                                                                                                                                                                               |
| `extract-norms` | **absente**                                           | oui (v77)        | Code absent du repo, inutilisée ; à supprimer (P2-1)                                                                                                                                                                                                                                                                                                                    |

Le code de `generate` et `signup` du repo diffère de la version déployée (`generate` v52, `signup` v27) par l'instrumentation Sentry ajoutée le 2026-09-25, qui reste à déployer (voir [TECH_DEBT.md](TECH_DEBT.md)). L'ancienne edge `purge-pending`, jamais déployée, a été supprimée au profit de la migration pg_cron. `supabase/config.toml` déclare `verify_jwt = false` pour `generate` et `signup`, qui valident le JWT elles-mêmes. Côté front, `aiProxy` appelle `generate` avec `fetch` (et non `functions.invoke`), avec un timeout de 180 s.

**Déploiement** : hébergement Vercel. Seules `main` (production, `app.ergobilan.com`) et `dev` (recette, `dev.ergobilan.com`, preview) sont construites : `vercel.json` (`git.deploymentEnabled`) et l'Ignored Build Step du projet. `vite.config.ts` injecte `__APP_RELEASE__` (depuis `VERCEL_GIT_COMMIT_SHA`) et `__APP_ENV__` (`VERCEL_ENV`) ; hors production, la page porte `noindex` et l'app affiche un badge « Version de test ». Sur `dev`, `VITE_TEST_ACCESS_EMAILS` restreint la connexion aux comptes listés (`utils/testAccess.ts`, voir [ISSUES.md](ISSUES.md)). Les actions en attente sur la production (migrations, déploiement de `generate`, réglages manuels) sont listées dans [TECH_DEBT.md](TECH_DEBT.md).

**Sentry** (org `ergobilan`, région `de`, projets `ergobilan-frontend` et `ergobilan-backend`) :

- **Front** (`services/sentryService.ts`) : actif sur tout build (`vite build`, donc production et preview Vercel) dès qu'un DSN est fourni ; en `npm run dev`, seulement avec `VITE_SENTRY_ENABLE_IN_DEV=true` et le DSN dans `.env.local`. Environnement : `VITE_SENTRY_ENVIRONMENT`, sinon `VERCEL_ENV` (`production` / `preview`), injecté par `vite.config.ts` dans `__APP_ENV__`. Collecte : erreurs (y compris via les hooks React 19 `onUncaughtError` / `onCaughtError` / `onRecoverableError` de `createRoot`), traces (`tracesSampleRate` 1.0 par défaut), logs structurés (`enableLogs`) et Session Replay sur erreur seulement (`replaysOnErrorSampleRate` 1.0, `replaysSessionSampleRate` 0), avec tout le texte et toutes les saisies masqués et les médias bloqués ; pas de Replay sur le portail famille. Chaque événement porte l'identifiant Supabase de l'utilisateur (aucun e-mail, `sendDefaultPii: false`) et les tags `app_mode`, `auth_state`, `demo_mode`, `report_type`, `assessment_step`. Le contexte `ai_last_call` décrit le dernier appel à `generate` (tâche, tentative, statut HTTP, code d'erreur edge, durée, `generationId`).
- **Nettoyage** : seuls les champs libres sont nettoyés (message, `extra`, contextes posés par l'app, breadcrumbs, logs, descriptions de spans) ; les structures du SDK (piles, navigateur, OS) sont conservées. Les URL perdent leur fragment (clé du portail) et la valeur de `q_id`. Les propagations de trace (`sentry-trace`, `baggage`) sont limitées à la même origine, car le CORS des edge functions ne les autorise pas : front et edge se corrèlent par `generation_id` et par l'utilisateur.
- **Retours utilisateurs** : le bouton « Signaler » de `AppHeader` et l'écran d'erreur (`GlobalErrorBoundary`) ouvrent `components/shared/FeedbackModal.tsx`, qui envoie un retour Sentry avec `sendAppFeedback` (`Sentry.captureFeedback`). Il n'y a pas de widget Sentry ni de capture d'écran, car une capture ne serait pas masquée. Depuis l'écran d'erreur, le retour est associé à la dernière erreur capturée. E-mail facultatif en démo seulement ; hors démo, l'identifiant suffit. Rien n'est proposé sur le portail famille. Les retours ne passent pas par `beforeSend` (réservé aux erreurs) : un processeur d'événements leur applique `scrubFeedback` (message nettoyé comme un champ libre, URL nettoyée, nom retiré, e-mail saisi conservé). `/issues` les relève et en fait des issues GitHub ([ISSUES.md](ISSUES.md)).
- **`Logger`** (`utils/logger.ts`) : `info` / `warn` / `debug` créent un breadcrumb et un log Sentry ; `error` crée en plus une issue (niveau error), `capture` une issue de niveau warning (échec géré). La console n'est utilisée qu'en dev.
- **Source maps** : générées (`hidden`) et envoyées par `@sentry/vite-plugin` seulement si `SENTRY_AUTH_TOKEN` est défini au build, puis supprimées de `dist/` ; sans jeton, aucune source map n'est produite.
- **Tunnel** : en build de production, le SDK envoie à `/monitoring` (même origine), que `vercel.json` réécrit vers l'ingestion Sentry du projet `ergobilan-frontend`. Les bloqueurs de publicité ne coupent donc plus les événements. En `npm run dev`, envoi direct à Sentry. Si le DSN front change, mettre à jour `vercel.json`.
- **Edge** (`supabase/functions/_shared/sentry.ts`, client minimal sans SDK) : `captureEdgeException` (pile V8 analysée), `captureEdgeMessage` (échec géré, niveau warning par défaut) et `createTrail` (étapes de la requête envoyées en breadcrumbs). Chaque événement porte l'utilisateur, la méthode et le chemin de la requête (jamais le corps) et le tag `generation_id`. `generate` remonte les échecs Gemini (code, statuts HTTP, message d'erreur Gemini tronqué, `finishReason`, `blockReason`, jetons, durée, nombre de tentatives, sans prompt ni réponse), les erreurs des RPC de crédits et de session, `SERVER_MISCONFIGURED`, `PAYLOAD_TOO_LARGE`, `INVALID_GENERATION_SESSION` et `GENERATION_SESSION_BUSY`. `signup` remonte `PRACTITIONER_SETUP_FAILED` et `ORG_SETUP_FAILED`. Sans le secret `SENTRY_DSN_BACKEND`, rien n'est envoyé.

**Variables d'environnement** (noms seulement ; modèle dans `.env.example`) :

| Portée                    | Variables                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Front (`import.meta.env`) | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_SUPABASE_TURNSTILE_SITE_KEY` (repli `VITE_TURNSTILE_SITE_KEY`), `VITE_SENTRY_DSN_FRONTEND`, `VITE_SENTRY_ENVIRONMENT`, `VITE_SENTRY_RELEASE`, `VITE_SENTRY_ENABLE_IN_DEV`, `VITE_SENTRY_TRACES_SAMPLE_RATE`, `VITE_SENTRY_REPLAYS_SESSION_SAMPLE_RATE`, `VITE_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE`, `VITE_FORCE_PASSWORD_REAUTH_DAYS` |
| Build                     | `VERCEL_GIT_COMMIT_SHA`, `GITHUB_SHA`, `COMMIT_SHA`, `VERCEL_ENV`, `SENTRY_AUTH_TOKEN` (+ `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_URL` optionnels) (`vite.config.ts`)                                                                                                                                                                                                                      |
| Edge `generate`           | `GEMINI_API_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_TIMEOUT_MS`, `AI_MAX_REQUESTS_PER_HOUR`, `GEMINI_MAX_RETRIES`, `GEMINI_RETRY_BASE_MS`, `GENERATION_REUSE_WINDOW_MINUTES`, `GENERATION_LOCK_TTL_SECONDS`, `GENERATE_MAX_PAYLOAD_BYTES`, `APP_ENV`/`ENV`, `AI_ALLOW_LOOPBACK_ORIGINS`, `AI_DEV_MODE`, `AI_ALLOWED_ORIGINS`                       |
| Edge `signup`             | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SIGNUP_MAX_BODY_BYTES`                                                                                                                                                                                                                                                                                                                               |
| Edge Sentry               | `SENTRY_DSN_BACKEND`, `SENTRY_ENV`, `SENTRY_RELEASE`                                                                                                                                                                                                                                                                                                                                       |

En développement, `services/db.ts` utilise une URL et une clé publishable Supabase codées en dur si les variables sont absentes ; en production, leur absence lève une erreur au chargement. Aucun fichier `.env` n'est versionné (`.gitignore`) : les builds Vercel (`main` et `dev`) prennent leurs variables dans les variables d'environnement du projet Vercel, et le développement local dans `.env.local` (#66).

## 10. Autres documents

- [WORKFLOWS.md](WORKFLOWS.md) : parcours bilan initial, réévaluation, historique, brouillons, finalisation, portail, export, démo.
- [DATA_MODEL.md](DATA_MODEL.md) : types `types.ts`, schéma Dexie, `.ergobilan`, schéma Supabase.
- [AI_PIPELINE.md](AI_PIPELINE.md) : charge utile, anonymisation, edge `generate`, crédits, style appris.
- [SCORING_CATALOG.md](SCORING_CATALOG.md) : catalogue de tests, saisie et affichage des scores.
- [TECH_DEBT.md](TECH_DEBT.md) : état de chaque point de dette et actions en attente sur la production.
