
# AutoBilanErgo - Journal de Développement & Architecture

> **Architecture :** Cloud Native (Supabase V1 -> Firebase V2 Cible) + Chiffrement E2EE + Server-Side Authority
> **Version :** 1.5.0 (Release Candidate - Supabase Implementation)

## 1. Vue d'ensemble
AutoBilanErgo est une application web (SPA) conçue pour les ergothérapeutes. Elle permet de générer des bilans cliniques automatisés, assistés par l'IA (Gemini), tout en garantissant une confidentialité totale des données (Privacy by Design).

## 2. Historique Récent
*   **v1.5.0 (Release Candidate) :**
    *   **Statut :** Feature Complete sur le stack Supabase.
    *   **Portail Famille :** Finalisation du protocole d'échange sécurisé (URL Hash Fragment) permettant la collecte de données sans compte utilisateur pour les parents.
    *   **IA & OCR :** Module d'ingestion des normes (Contribution Studio) via Gemini Vision opérationnel.
*   **v1.4.3 (Strategic Review - Migration Firebase) :**
    *   **Stratégie Backend :** L'architecture a été validée pour une migration future vers **Firebase** (Firestore + Auth + Cloud Functions).
    *   **Isolation :** Les appels DB sont encapsulés dans `StorageService` et `SubscriptionService`. Le remplacement de Supabase par Firebase nécessitera uniquement la réécriture de ces couches de service, sans impact sur l'UI ou la logique de chiffrement.
*   **v1.4.2 (Backend Implementation) :**
    *   **Socle Actuel :** Validation de Supabase pour la V1 (Triggers PostgreSQL, RLS, Relations SQL pour le catalogue de tests).

## 3. Schéma de Données (Transition SQL -> NoSQL)

### A. Principes de Stockage "Blind Backend"
Le modèle repose sur une séparation stricte : le serveur gère l'authentification et le stockage, le client gère la cryptographie. Ce modèle est compatible avec Firestore (NoSQL).

1.  **Entités Cliniques (Patients, Rapports, Sessions)**
    *   Ne stockent **JAMAIS** de PII (Personal Identifiable Information) en clair.
    *   Structure type : `{ id, iv, encrypted_content, metadata_non_identifiante }`.

2.  **Gestion des Clés (Key Hierarchy)**
    *   **MasterKey :** Dérivée du PIN Praticien (PBKDF2). Volatile (RAM uniquement).
    *   **OrgKey :** Clé du cabinet, chiffrée par la MasterKey (Wrapped).
    *   **FileKey :** Clé du dossier patient, chiffrée par l'OrgKey.

### B. Mapping Tables (Supabase) vers Collections (Firebase Futur)

| Table SQL (Actuel) | Collection NoSQL (Cible) | Notes Migration |
| :--- | :--- | :--- |
| `patients` | `patients/{patientId}` | Structure JSON native de Firestore idéale pour les champs chiffrés. |
| `reports` | `patients/{patientId}/reports/{reportId}` | Sous-collection pour scalabilité. |
| `sessions` | `patients/{patientId}/sessions/{sessionId}` | Sous-collection. |
| `official_tests` | `catalogs/global/tests/{testId}` | Données publiques en lecture seule. |
| `drafts` | `users/{userId}/drafts/{draftId}` | Données volatiles. |

## 4. Stack Technique
*   **Frontend** : React 18, TailwindCSS, Lucide.
*   **State** : React Context API (Architecture Flux).
*   **Backend (V1 - Actuel)** : Supabase (PostgreSQL, Auth, Edge Functions).
*   **Backend (V2 - Cible)** : Firebase (Firestore, Auth, Cloud Functions).
*   **IA** : Google Gemini 3 (Flash & Pro).
*   **Crypto** : Web Crypto API (AES-GCM 256 + PBKDF2).

## 5. Sécurité & Conformité
*   **HDS (Hébergeur Données Santé) :** L'architecture E2EE (End-to-End Encryption) est le pilier central. Le serveur ne stocke que du "bruit" chiffré, rendant le choix du provider (Supabase ou Firebase) agnostique du point de vue de la confidentialité des données patients.
*   **IA Privacy :** Anonymisation stricte via `utils/anonymizer.ts` AVANT l'envoi au LLM. Remplacement par placeholders (`{{PATIENT_NOM}}`).
