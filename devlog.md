
# AutoBilanErgo - Journal de Développement & Architecture

> **Architecture :** Cloud Native (Supabase) + Chiffrement E2EE + Server-Side Authority
> **Version :** 1.4.0 (Schema Sync & Preview Optimization)

## 1. Vue d'ensemble
AutoBilanErgo est une application web (SPA) conçue pour les ergothérapeutes. Elle permet de générer des bilans cliniques automatisés, assistés par l'IA (Gemini), tout en garantissant une confidentialité totale des données.

## 2. Historique Récent
*   **v1.4.0 (Schema Synchronization) :**
    *   Correction critique : Ajout de `organization_id` sur `pending_questionnaires`.
    *   Optimisation Dashboard : Ajout de `encrypted_preview` et `preview_iv` sur `patients` pour chargement rapide sans déchiffrement lourd.
*   **v1.3.0 (Organization Based Schema) :**
    *   Migration complète vers un modèle multi-tenant basé sur `organization_id`.

## 3. Schéma SQL de Production (Audit 1.4.0)

### A. Tables Cliniques (Données Chiffrées E2EE)
Ces tables ne contiennent aucune donnée intelligible pour le serveur (uniquement IV + Content chiffré).

1.  **`patients`**
    *   `id` (uuid) : Clé primaire.
    *   `organization_id` (uuid) : Lien Cabinet.
    *   `encrypted_identity` (text) : Données complètes chiffrées (Nom, Prénom, Anamnèse...).
    *   `encrypted_preview` (text) : **[NOUVEAU]** Données légères (Nom, Prénom, Age) pour affichage liste rapide.
    *   `preview_iv` (text) : **[NOUVEAU]** IV spécifique au preview.
    *   `encrypted_file_key` (text) : Clé AES du dossier, chiffrée avec la clé Orga.
    *   `iv` (text) : Vecteur d'initialisation (Identity).
    *   `last_interaction`, `updated_at`, `created_at`.

2.  **`reports`**
    *   `id`, `patient_id`.
    *   `user_id` (uuid) : Auteur.
    *   `encrypted_content` (text) : JSON du bilan.
    *   `status`, `type`.

3.  **`sessions`** (Résultats de tests)
    *   `id`, `patient_id`.
    *   `user_id` (uuid).
    *   `test_id`, `test_name`.
    *   `encrypted_results` (text).

4.  **`drafts`** (Brouillons volatils)
    *   `id`, `user_id` (Privé).
    *   `patient_id` (Optionnel).
    *   `encrypted_data`.

5.  **`pending_questionnaires`** (Portail Famille)
    *   `id` (uuid).
    *   `practitioner_id` (uuid) : Lien Praticien.
    *   `organization_id` (uuid) : **[FIX]** Lien Cabinet (Requis pour RLS).
    *   `practitioner_encrypted_key` (text).
    *   `family_encrypted_data` (text).
    *   `status`, `label`, `created_at`.

### B. Tables Structurelles (Identity & Access)

1.  **`practitioners`**
    *   `id` (PK, FK auth.users).
    *   `email`, `first_name`, `last_name`.
    *   `credits` (int).
    *   `encryption_salt`, `encryption_validator`.
    *   `is_admin`.

2.  **`organizations`**
    *   `id`, `name`, `stripe_customer_id`.

3.  **`organization_members`**
    *   `user_id`, `organization_id`, `role`.
    *   `encrypted_org_key`.

4.  **`subscriptions`**
    *   `id`, `user_id`.
    *   `plan_id`, `status`.
    *   `trial_ends_at`, `current_period_end`.

### C. Tables Référentielles (Catalogue Tests)

1.  **`official_tests`**
    *   `id`, `name`, `category_id`, `author`.
    *   `organization_id` : Permet les tests privés (User Created).

2.  **`official_subtests`**
    *   `id`, `test_id`, `name`, `score_type`, `computation_mode`.
    *   `organization_id`.

3.  **`official_norms`**
    *   `id`, `subtest_id`.
    *   `age_min_months`, `age_max_months`.
    *   `raw_min`, `raw_max` (Lookup).
    *   `mean`, `sd` (Parametric).
    *   `standard_score`, `percentile`, `z_score`.
    *   `organization_id`.

4.  **`contribution_insights`** (Analytics)
    *   `id`, `test_id`, `raw_score`, `computed_standard`.

## 4. Stack Technique
*   **Frontend** : React 18, TailwindCSS, Lucide.
*   **State** : React Context API.
*   **Backend** : Supabase (Auth, DB, Realtime, Edge Functions).
*   **IA** : Google Gemini 3 (Flash & Pro).
*   **Crypto** : Web Crypto API (PBKDF2 + AES-GCM).
