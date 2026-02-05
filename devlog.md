
# AutoBilanErgo - Journal de Développement & Architecture

> **Architecture :** Cloud Native (Supabase Actuel / Firebase Cible) + Chiffrement E2EE + Server-Side Authority
> **Version :** 1.4.3 (Strategic Review)

## 1. Vue d'ensemble
AutoBilanErgo est une application web (SPA) conçue pour les ergothérapeutes. Elle permet de générer des bilans cliniques automatisés, assistés par l'IA (Gemini), tout en garantissant une confidentialité totale des données.

## 2. Historique Récent
*   **v1.4.3 (Strategic Review) :**
    *   **Stratégie Backend :** Réintégration de Firebase (Firestore + Auth) comme option d'infrastructure cible à moyen/long terme.
    *   **Directive Architecture :** Les futurs développements doivent favoriser le découplage entre la logique métier et le provider de base de données (Pattern Repository/Service) pour faciliter la migration SQL vers NoSQL.
*   **v1.4.2 (Backend Implementation) :**
    *   **Socle Actuel :** Validation de Supabase pour la V1 (Triggers PostgreSQL, RLS, Relations SQL pour le catalogue de tests).
*   **v1.4.1 (Audit Sécurité) :**
    *   **Audit Architecture :** Validation du pattern "Zero Knowledge". Le backend ne voit jamais les données claires.

## 3. Schéma de Données (PostgreSQL Actuel -> NoSQL Futur)

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

### B. Tables Principales (Supabase Actuel)

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
*   **Backend (V1)** : Supabase (PostgreSQL, Auth, Edge Functions).
*   **Backend (Cible V2)** : Firebase (Firestore, Auth, Cloud Functions).
*   **IA** : Google Gemini 3 (Flash & Pro).
*   **Crypto** : Web Crypto API (AES-GCM 256 + PBKDF2).

## 5. Sécurité & Conformité
*   **HDS (Hébergeur Données Santé) :** L'architecture E2EE est le pilier central. Le serveur ne stocke que du "bruit" chiffré.
*   **IA Privacy :** Anonymisation stricte via `utils/anonymizer.ts` AVANT l'envoi au LLM. Remplacement par placeholders (`{{PATIENT_NOM}}`).
