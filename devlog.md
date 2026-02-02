
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


```sql
-- GESTION UTILISATEUR & CRÉDITS (Source de vérité)
-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.contribution_insights (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamp with time zone DEFAULT now(),
  age_months integer,
  gender text,
  scores_json jsonb,
  diagnosis_safe text,
  status text DEFAULT 'pending'::text,
  CONSTRAINT contribution_insights_pkey PRIMARY KEY (id)
);
CREATE TABLE public.contributions_queue (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid,
  source_type text NOT NULL,
  status text DEFAULT 'pending'::text,
  target_test_name text,
  raw_data_json jsonb,
  created_at timestamp with time zone DEFAULT now(),
  structure_type text CHECK (structure_type = ANY (ARRAY['PARAMETRIC'::text, 'LOOKUP'::text, 'MIXED'::text])),
  CONSTRAINT contributions_queue_pkey PRIMARY KEY (id),
  CONSTRAINT contributions_queue_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.drafts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  updated_at timestamp with time zone DEFAULT now(),
  iv text NOT NULL,
  encrypted_data text NOT NULL,
  patient_id uuid,
  CONSTRAINT drafts_pkey PRIMARY KEY (id),
  CONSTRAINT drafts_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT drafts_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id)
);
CREATE TABLE public.official_norms (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  subtest_id text NOT NULL,
  age_min_months integer,
  age_max_months integer,
  gender text,
  mean real,
  sd real,
  raw_min real,
  raw_max real,
  standard_score real,
  percentile real,
  CONSTRAINT official_norms_pkey PRIMARY KEY (id),
  CONSTRAINT official_norms_subtest_id_fkey FOREIGN KEY (subtest_id) REFERENCES public.official_subtests(id)
);
CREATE TABLE public.official_subtests (
  id text NOT NULL,
  test_id text NOT NULL,
  name text NOT NULL,
  unit text,
  score_type text NOT NULL,
  computation_mode text DEFAULT 'PARAMETRIC'::text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT official_subtests_pkey PRIMARY KEY (id),
  CONSTRAINT official_subtests_test_id_fkey FOREIGN KEY (test_id) REFERENCES public.official_tests(id)
);
CREATE TABLE public.official_tests (
  id text NOT NULL,
  name text NOT NULL,
  category_id text NOT NULL,
  author text,
  version text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT official_tests_pkey PRIMARY KEY (id)
);
CREATE TABLE public.patients (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  last_interaction timestamp with time zone DEFAULT now(),
  iv text NOT NULL,
  encrypted_identity text NOT NULL,
  CONSTRAINT patients_pkey PRIMARY KEY (id),
  CONSTRAINT patients_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.pending_questionnaires (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  practitioner_id uuid NOT NULL,
  label text,
  practitioner_encrypted_key text NOT NULL,
  family_encrypted_data text,
  status text DEFAULT 'pending'::text,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT pending_questionnaires_pkey PRIMARY KEY (id),
  CONSTRAINT pending_questionnaires_practitioner_id_fkey FOREIGN KEY (practitioner_id) REFERENCES public.practitioners(id)
);
CREATE TABLE public.practitioners (
  id uuid NOT NULL,
  email text NOT NULL UNIQUE,
  first_name text,
  last_name text,
  phone_pro text,
  siret text,
  address_pro text,
  encryption_salt text NOT NULL,
  encryption_validator text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  credits integer DEFAULT 0,
  is_admin boolean DEFAULT false,
  stripe_customer_id text,
  CONSTRAINT practitioners_pkey PRIMARY KEY (id),
  CONSTRAINT practitioners_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id)
);
CREATE TABLE public.reports (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  type text NOT NULL,
  status text NOT NULL,
  iv text NOT NULL,
  encrypted_content text NOT NULL,
  CONSTRAINT reports_pkey PRIMARY KEY (id),
  CONSTRAINT reports_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT reports_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id)
);
CREATE TABLE public.sessions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  date timestamp with time zone DEFAULT now(),
  test_id text NOT NULL,
  test_name text,
  iv text NOT NULL,
  encrypted_results text NOT NULL,
  CONSTRAINT sessions_pkey PRIMARY KEY (id),
  CONSTRAINT sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT sessions_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id)
);
CREATE TABLE public.subscriptions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  plan_id text NOT NULL DEFAULT 'free'::text,
  status text NOT NULL DEFAULT 'trialing'::text,
  trial_ends_at timestamp with time zone,
  current_period_end timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT subscriptions_pkey PRIMARY KEY (id),
  CONSTRAINT subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
```

## 4. Stack Technique
*   **Frontend** : React 18, TailwindCSS, Lucide.
*   **State** : React Context API.
*   **Backend** : Supabase (Auth, DB, Realtime, Edge Functions).
*   **IA** : Google Gemini 3 (Flash & Pro).
*   **Crypto** : Web Crypto API (PBKDF2 + AES-GCM).
