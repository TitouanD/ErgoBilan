
# AutoBilanErgo - Journal de Développement & Architecture

> **Architecture :** Cloud Native (Supabase PostgreSQL) + Chiffrement E2EE + Server-Side Authority
> **Version :** 1.6.1 (Data Integrity & Relational Fix)

## 1. Vue d'ensemble
AutoBilanErgo est une application web (SPA) conçue pour les ergothérapeutes. Elle permet de générer des bilans cliniques automatisés, assistés par l'IA (Gemini), tout en garantissant une confidentialité totale des données (Privacy by Design).

## 2. Historique Récent
*   **v1.6.1 (Data Integrity Fix) :**
    *   **Architecture Relationnelle Stricte :** Alignement du code (`StorageService`) sur le schéma BDD réel (Source de Vérité). Abandon définitif de la tentative de stockage "Blob Monolithique" dans la table `patients`.
    *   **Data Split :**
        *   `patients` : Contient uniquement l'identité chiffrée (`encrypted_identity`).
        *   `sessions` : Stocke les résultats des tests (`encrypted_results`).
        *   `reports` : Stocke les textes générés (`encrypted_content`).
    *   **Draft-First Workflow :** Toute modification en cours passe par la table `drafts`. Le "Commit" vers les tables finales (`sessions`, `reports`) ne se fait qu'à la validation explicite.
    *   **Gestion "Archived" :** Le statut archivé est encapsulé dans le blob chiffré de l'identité (Soft Logic), car la colonne n'existe pas en clair.

*   **v1.6.0 (UX & Onboarding) :**
    *   **Mode Démo :** Implémentation d'un environnement "bac à sable" complet.
    *   **Onboarding Gamifié :** Nouveau parcours d'accueil.
    *   **Paywall & Credits UI :** Intégration des interfaces de monétisation.

## 3. Schéma de Données (Relationnel & Chiffré)

### A. Principes de Stockage "Blind Backend"
Le modèle repose sur une séparation stricte : le serveur gère l'authentification et le stockage relationnel, le client gère la cryptographie.

1.  **Entités Cliniques (Patients, Rapports, Sessions)**
    *   Utilisation de tables PostgreSQL standard liées par Foreign Keys.
    *   Les colonnes contenant des PII sont chiffrées (AES-GCM).

2.  **Modèle Relationnel Fort**
    *   L'intégrité des données est garantie par des contraintes de clés étrangères :
        *   `Organization` -> `Practitioners` (1:N)
        *   `Patient` -> `Reports` (1:N)
        *   `Patient` -> `Sessions` (1:N)

### B. Tables Principales (PostgreSQL)

| Table | Rôle | Stratégie de Sécurité (RLS) |
| :--- | :--- | :--- |
| `patients` | Dossiers racine (Identité) | Accès via Organisation (`check_is_member_of`). |
| `reports` | Rapports générés (Textes) | Hérite des droits du patient. |
| `sessions` | Résultats de tests (Data) | Hérite des droits du patient. |
| `drafts` | Sauvegarde volatile | Strictement privé (`user_id = auth.uid()`). |
| `contribution_insights` | Télémétrie anonyme | Insert Authenticated / Select Admin. |

## 4. Stack Technique
*   **Frontend** : React 18, TailwindCSS, Lucide.
*   **State** : React Context API (Architecture Flux).
*   **Backend** : Supabase (PostgreSQL 15+, Auth, Edge Functions).
*   **IA** : Google Gemini 3 (Flash & Pro).
*   **Crypto** : Web Crypto API (AES-GCM 256 + PBKDF2).

## 5. Sécurité & Conformité
*   **HDS (Hébergeur Données Santé) :** L'architecture E2EE est le pilier central.
*   **IA Privacy :** Anonymisation stricte via `utils/anonymizer.ts` AVANT l'envoi au LLM.
