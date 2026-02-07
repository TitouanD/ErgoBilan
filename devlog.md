
# AutoBilanErgo - Journal de Développement & Architecture

> **Architecture :** Cloud Native (Supabase PostgreSQL) + Chiffrement E2EE + Server-Side Authority
> **Version :** 1.5.2 (SQL Native Hardening)

## 1. Vue d'ensemble
AutoBilanErgo est une application web (SPA) conçue pour les ergothérapeutes. Elle permet de générer des bilans cliniques automatisés, assistés par l'IA (Gemini), tout en garantissant une confidentialité totale des données (Privacy by Design).

## 2. Historique Récent
*   **v1.5.2 (SQL Standardization) :**
    *   **Architecture :** Abandon définitif de l'abstraction NoSQL. Optimisation du code pour tirer parti de la puissance relationnelle de PostgreSQL (Jointures, Intégrité référentielle, Vues).
    *   **Nettoyage :** Suppression de toute dette technique liée à une hypothétique migration Firebase.
*   **v1.5.1 (Service Layer Hardening) :**
    *   **Refactoring Service Layer :** Centralisation complète des appels Database dans `StorageService`.
*   **v1.5.0 (Release Candidate) :**
    *   **Statut :** Feature Complete sur le stack Supabase.
    *   **Portail Famille :** Finalisation du protocole d'échange sécurisé.
    *   **IA & OCR :** Module d'ingestion des normes opérationnel.

## 3. Schéma de Données (Relationnel & Chiffré)

### A. Principes de Stockage "Blind Backend"
Le modèle repose sur une séparation stricte : le serveur gère l'authentification et le stockage relationnel, le client gère la cryptographie.

1.  **Entités Cliniques (Patients, Rapports, Sessions)**
    *   Utilisation de tables PostgreSQL standard.
    *   Les colonnes contenant des PII (Personal Identifiable Information) sont stockées sous forme de blobs chiffrés (AES-GCM).
    *   Structure type : `{ id (UUID), patient_id (FK), iv, encrypted_content, metadata_indexable }`.

2.  **Modèle Relationnel Fort**
    *   L'intégrité des données est garantie par des contraintes de clés étrangères (Foreign Keys) :
        *   `Organization` -> `Practitioners` (1:N)
        *   `Patient` -> `Reports` (1:N)
        *   `Patient` -> `Sessions` (1:N)
        *   `Official_Tests` -> `Official_Subtests` -> `Official_Norms` (Cascade)

### B. Tables Principales (PostgreSQL)

| Table | Rôle | Stratégie de Sécurité (RLS) |
| :--- | :--- | :--- |
| `patients` | Dossiers racine | Accès restreint à l'organisation du praticien. |
| `reports` | Rapports générés | Hérite des droits du patient (Row Level Security). |
| `sessions` | Résultats de tests | Hérite des droits du patient. |
| `official_tests` | Catalogue étalonnage | Lecture Publique / Écriture Admin ou Org propriétaire. |
| `drafts` | Sauvegarde volatile | Strictement privé (User ID). |

## 4. Stack Technique
*   **Frontend** : React 18, TailwindCSS, Lucide.
*   **State** : React Context API (Architecture Flux).
*   **Backend** : Supabase (PostgreSQL 15+, Auth, Edge Functions).
*   **IA** : Google Gemini 3 (Flash & Pro).
*   **Crypto** : Web Crypto API (AES-GCM 256 + PBKDF2).

## 5. Sécurité & Conformité
*   **HDS (Hébergeur Données Santé) :** L'architecture E2EE (End-to-End Encryption) est le pilier central. Le serveur ne stocke que du "bruit" chiffré.
*   **IA Privacy :** Anonymisation stricte via `utils/anonymizer.ts` AVANT l'envoi au LLM. Remplacement par placeholders (`{{PATIENT_NOM}}`).
