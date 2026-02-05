
# AutoBilanErgo - Journal de Développement & Architecture

> **Architecture :** Cloud Native (Supabase Native) + Chiffrement E2EE + Server-Side Authority
> **Version :** 1.4.2 (Backend Strategy Confirmed)

## 1. Vue d'ensemble
AutoBilanErgo est une application web (SPA) conçue pour les ergothérapeutes. Elle permet de générer des bilans cliniques automatisés, assistés par l'IA (Gemini), tout en garantissant une confidentialité totale des données.

## 2. Historique Récent
*   **v1.4.2 (Backend Strategy Confirmed) :**
    *   **Décision Architecturale :** Abandon définitif de la piste Firebase. Validation de Supabase comme infrastructure pérenne.
    *   **Impact :** Autorisation d'utiliser des fonctionnalités spécifiques à PostgreSQL (Triggers avancés, Extensions) pour optimiser les performances.
*   **v1.4.1 (Audit Sécurité) :**
    *   **Audit Architecture :** Validation du pattern "Zero Knowledge". Le backend ne voit jamais les données claires.
*   **v1.4.0 (Schema Synchronization) :**
    *   Correction critique : Ajout de `organization_id` sur `pending_questionnaires`.
    *   Optimisation Dashboard : Ajout de `encrypted_preview` et `preview_iv` sur `patients` pour chargement rapide.

## 3. Schéma de Données (PostgreSQL + E2EE)

### A. Principes de Stockage "Blind Backend"
Le modèle repose sur une séparation stricte : le serveur gère l'authentification et le stockage, le client gère la cryptographie.

1.  **Entités Cliniques (Patients, Rapports, Sessions)**
    *   Ne stockent **JAMAIS** de PII (Personal Identifiable Information) en clair.
    *   Structure type : `{ id, iv, encrypted_content, metadata_non_identifiante }`.
    *   Les métadonnées en clair (dates, statuts, IDs techniques) ne doivent pas permettre l'identification du patient.

2.  **Gestion des Clés (Key Hierarchy)**
    *   **MasterKey :** Dérivée du PIN Praticien (PBKDF2). Volatile (RAM uniquement).
    *   **OrgKey :** Clé du cabinet, chiffrée par la MasterKey (Wrapped).
    *   **FileKey :** Clé du dossier patient, chiffrée par l'OrgKey.

### B. Tables Principales (Supabase)

1.  **`patients`**
    *   `id` (UUID), `organization_id`.
    *   `encrypted_identity`, `iv`.
    *   `encrypted_preview`, `preview_iv`.
    *   `encrypted_file_key`.

2.  **`reports`** & **`sessions`**
    *   Conteneurs de blobs chiffrés liés par `patient_id`.

3.  **`pending_questionnaires`** (Portail Famille)
    *   Zone tampon pour l'ingestion de données externes.
    *   Utilise un mécanisme de clé éphémère transmise via l'URL (Hash Fragment).

## 4. Stack Technique
*   **Frontend** : React 18, TailwindCSS, Lucide.
*   **State** : React Context API.
*   **Backend** : Supabase (PostgreSQL, Auth, Edge Functions).
*   **IA** : Google Gemini 3 (Flash & Pro).
*   **Crypto** : Web Crypto API (AES-GCM 256 + PBKDF2).

## 5. Sécurité & Conformité
*   **HDS (Hébergeur Données Santé) :** L'architecture E2EE est le pilier central. Le serveur ne stocke que du "bruit" chiffré.
*   **IA Privacy :** Anonymisation stricte via `utils/anonymizer.ts` AVANT l'envoi au LLM. Remplacement par placeholders (`{{PATIENT_NOM}}`).
