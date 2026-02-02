
# AutoBilanErgo - Journal de Développement & Architecture

> **Architecture :** Cloud Native (Supabase) + Chiffrement E2EE + Server-Side Authority
> **Version :** 1.2.0 (Context API & Secure Gateway)

## 1. Vue d'ensemble
AutoBilanErgo est une application web (SPA) conçue pour les ergothérapeutes. Elle permet de générer des bilans cliniques automatisés, assistés par l'IA (Gemini), tout en garantissant une confidentialité totale des données.

## 2. Architecture Technique (Mise à jour v1.2)

### A. Flux de Données React (Context API)
L'application a été refondue pour éliminer le "Prop Drilling" et améliorer les performances.
*   **AuthContext** : Gère la session Supabase, le profil praticien et la clé de déchiffrement (SessionKey).
*   **AssessmentContext** : Gère l'état volatile d'un bilan en cours d'édition.
*   **Avantage** : La modification d'un champ dans un formulaire ne provoque plus le re-rendu complet de l'application.

### B. Sécurité Renforcée (Gatekeeper Pattern)
L'appel à l'IA n'est plus direct. Il passe par un service sécurisé :
1.  **SubscriptionService** : Appelle une procédure stockée RPC (`consume_credit`) sur PostgreSQL. C'est la base de données qui valide la transaction, empêchant toute manipulation client-side du solde.
2.  **AIService** : Ne déclenche l'appel Gemini que si le crédit a été consommé avec succès.
3.  **Privacy Airlock** : Une étape de validation force le praticien à vérifier les données anonymisées avant l'envoi.

### C. Zone "Vault" (Espace Praticien - E2EE)
Données **chiffrées côté client (AES-GCM)** avec une clé dérivée du PIN praticien. Supabase ne voit que des BLOBs illisibles.
*   `patients`, `reports`, `sessions` : Données cliniques chiffrées.

## 3. Schéma SQL de Production

Structure des tables critiques :

```sql
-- GESTION UTILISATEUR & CRÉDITS (Source de vérité)
CREATE TABLE public.practitioners (
  id uuid NOT NULL PRIMARY KEY REFERENCES auth.users(id),
  email text NOT NULL UNIQUE,
  credits integer DEFAULT 0,          -- Solde de crédits (Géré par RPC)
  is_admin boolean DEFAULT false,     -- Flag Admin
  encryption_salt text NOT NULL,
  encryption_validator text NOT NULL,
  created_at timestamp with time zone DEFAULT now()
);

-- QUEUE DE CONTRIBUTIONS
CREATE TABLE public.contributions_queue (
  id uuid PRIMARY KEY,
  structure_type text CHECK (structure_type IN ('PARAMETRIC', 'LOOKUP')),
  raw_data_json jsonb,
  status text DEFAULT 'pending'
);
```

## 4. Stack Technique
*   **Frontend** : React 18, TailwindCSS, Lucide.
*   **State** : React Context API.
*   **Backend** : Supabase (Auth, DB, Realtime, Edge Functions).
*   **IA** : Google Gemini 3 (Flash & Pro).
*   **Crypto** : Web Crypto API (PBKDF2 + AES-GCM).
