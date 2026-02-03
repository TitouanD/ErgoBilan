
# AutoBilanErgo - Journal de Développement & Architecture

> **Architecture :** Cloud Native (Supabase) + Chiffrement E2EE + Server-Side Authority
> **Version :** 1.3.0 (Organization Based Schema)

## 1. Vue d'ensemble
AutoBilanErgo est une application web (SPA) conçue pour les ergothérapeutes. Elle permet de générer des bilans cliniques automatisés, assistés par l'IA (Gemini), tout en garantissant une confidentialité totale des données.

## 2. Historique Récent
*   **Fix v1.3.0 (Correctif Schema Mismatch) :**
    *   Alignement du code `StorageService` avec la base de données.
    *   Suppression de l'envoi de `user_id` vers la table `patients` (qui n'a plus cette colonne).
    *   Utilisation exclusive de `organization_id` pour lier les patients aux cabinets.
    *   Récupération automatique de l'ID organisation si manquant dans l'objet patient.

## 3. Schéma SQL de Production (Réel)

Données extraites de l'audit de production. Ce schéma prévaut sur toute documentation antérieure.

### A. Tables Cliniques (Données Chiffrées E2EE)
Ces tables ne contiennent aucune donnée intelligible pour le serveur (uniquement IV + Content chiffré).

1.  **`patients`**
    *   `id` (uuid) : Clé primaire.
    *   `organization_id` (uuid) : Lien vers le cabinet (**Remplace user_id**).
    *   `encrypted_identity` (text) : Nom, Prénom, etc. chiffrés.
    *   `encrypted_file_key` (text) : Clé AES du dossier, chiffrée avec la clé Orga.
    *   `iv` (text) : Vecteur d'initialisation.
    *   `last_interaction`, `updated_at`, `created_at`.

2.  **`reports`**
    *   `id`, `patient_id`.
    *   `user_id` (uuid) : L'auteur du rapport (existe toujours ici).
    *   `encrypted_content` (text) : JSON du bilan.
    *   `status`, `type`.

3.  **`sessions`** (Résultats de tests)
    *   `id`, `patient_id`.
    *   `user_id` (uuid) : L'auteur de la saisie.
    *   `test_id`, `test_name`.
    *   `encrypted_results` (text).

4.  **`drafts`** (Brouillons volatils)
    *   `id`, `user_id` (Le brouillon est personnel).
    *   `patient_id` (Optionnel).
    *   `encrypted_data`.

5.  **`pending_questionnaires`** (Portail Famille)
    *   `id`, `practitioner_id` (Lien Praticien).
    *   `practitioner_encrypted_key` (Pour déchiffrement par le pro).
    *   `family_encrypted_data` (Réponses famille).
    *   `status`.

### B. Tables Structurelles (Identity & Access)

1.  **`practitioners`** (Profil Public/Privé)
    *   `id` (PK, FK auth.users).
    *   `email`, `first_name`, `last_name`.
    *   `credits` (int).
    *   `encryption_salt`, `encryption_validator` (Sécurité PIN).
    *   `is_admin`.

2.  **`organizations`** (Cabinet)
    *   `id`, `name`, `stripe_customer_id`.

3.  **`organization_members`** (Permissions)
    *   `user_id`, `organization_id`, `role`.
    *   `encrypted_org_key` (Clé du cabinet chiffrée pour le membre).

4.  **`subscriptions`** (Abonnements)
    *   `id`, `user_id`.
    *   `plan_id`, `status`.
    *   `trial_ends_at`.

### C. Tables Référentielles (Catalogue Tests)

1.  **`official_tests`** : Définition des tests (WISC-V, MABC-2...).
2.  **`official_subtests`** : Détail des épreuves.
3.  **`official_norms`** : Tables de conversion (Lookups & Paramétriques).
4.  **`contribution_insights`** : Données statistiques.
5.  **`contributions_queue`** : File d'attente pour validation admin.

## 4. Stack Technique
*   **Frontend** : React 18, TailwindCSS, Lucide.
*   **State** : React Context API.
*   **Backend** : Supabase (Auth, DB, Realtime, Edge Functions).
*   **IA** : Google Gemini 3 (Flash & Pro).
*   **Crypto** : Web Crypto API (PBKDF2 + AES-GCM).
