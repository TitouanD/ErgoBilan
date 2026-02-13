
# ErgoBilan - Journal de DÃ©veloppement & Architecture

> **Architecture :** Cloud Native (Supabase PostgreSQL) + Chiffrement E2EE + Server-Side Authority
> **Version :** 1.6.1 (Data Integrity & Relational Fix)

## 1. Vue d'ensemble
ErgoBilan est une application web (SPA) conÃ§ue pour les ergothÃ©rapeutes. Elle permet de gÃ©nÃ©rer des bilans cliniques automatisÃ©s, assistÃ©s par l'IA (Gemini), tout en garantissant une confidentialitÃ© totale des donnÃ©es (Privacy by Design).

## 2. Historique RÃ©cent
*   **v1.6.1 (Data Integrity Fix) :**
    *   **Architecture Relationnelle Stricte :** Alignement du code (`StorageService`) sur le schÃ©ma BDD rÃ©el (Source de VÃ©ritÃ©). Abandon dÃ©finitif de la tentative de stockage "Blob Monolithique" dans la table `patients`.
    *   **Data Split :**
        *   `patients` : Contient uniquement l'identitÃ© chiffrÃ©e (`encrypted_identity`).
        *   `sessions` : Stocke les rÃ©sultats des tests (`encrypted_results`).
        *   `reports` : Stocke les textes gÃ©nÃ©rÃ©s (`encrypted_content`).
    *   **Draft-First Workflow :** Toute modification en cours passe par la table `drafts`. Le "Commit" vers les tables finales (`sessions`, `reports`) ne se fait qu'Ã  la validation explicite.
    *   **Gestion "Archived" :** Le statut archivÃ© est encapsulÃ© dans le blob chiffrÃ© de l'identitÃ© (Soft Logic), car la colonne n'existe pas en clair.

*   **v1.6.0 (UX & Onboarding) :**
    *   **Mode DÃ©mo :** ImplÃ©mentation d'un environnement "bac Ã  sable" complet.
    *   **Onboarding GamifiÃ© :** Nouveau parcours d'accueil.
    *   **Paywall & Credits UI :** IntÃ©gration des interfaces de monÃ©tisation.

## 3. SchÃ©ma de DonnÃ©es (Relationnel & ChiffrÃ©)

### A. Principes de Stockage "Blind Backend"
Le modÃ¨le repose sur une sÃ©paration stricte : le serveur gÃ¨re l'authentification et le stockage relationnel, le client gÃ¨re la cryptographie.

1.  **EntitÃ©s Cliniques (Patients, Rapports, Sessions)**
    *   Utilisation de tables PostgreSQL standard liÃ©es par Foreign Keys.
    *   Les colonnes contenant des PII sont chiffrÃ©es (AES-GCM).

2.  **ModÃ¨le Relationnel Fort**
    *   L'intÃ©gritÃ© des donnÃ©es est garantie par des contraintes de clÃ©s Ã©trangÃ¨res :
        *   `Organization` -> `Practitioners` (1:N)
        *   `Patient` -> `Reports` (1:N)
        *   `Patient` -> `Sessions` (1:N)

### B. Tables Principales (PostgreSQL)

| Table | RÃ´le | StratÃ©gie de SÃ©curitÃ© (RLS) |
| :--- | :--- | :--- |
| `patients` | Dossiers racine (IdentitÃ©) | AccÃ¨s via Organisation (`check_is_member_of`). |
| `reports` | Rapports gÃ©nÃ©rÃ©s (Textes) | HÃ©rite des droits du patient. |
| `sessions` | RÃ©sultats de tests (Data) | HÃ©rite des droits du patient. |
| `drafts` | Sauvegarde volatile | Strictement privÃ© (`user_id = auth.uid()`). |
| `contribution_insights` | TÃ©lÃ©mÃ©trie anonyme | Insert Authenticated / Select Admin. |

## 4. Stack Technique
*   **Frontend** : React 18, TailwindCSS, Lucide.
*   **State** : React Context API (Architecture Flux).
*   **Backend** : Supabase (PostgreSQL 15+, Auth, Edge Functions).
*   **IA** : Google Gemini 3 (Flash & Pro).
*   **Crypto** : Web Crypto API (AES-GCM 256 + PBKDF2).

## 5. SÃ©curitÃ© & ConformitÃ©
*   **HDS (HÃ©bergeur DonnÃ©es SantÃ©) :** L'architecture E2EE est le pilier central.
*   **IA Privacy :** Anonymisation stricte via `utils/anonymizer.ts` AVANT l'envoi au LLM.
