# DB RLS / Functions / Triggers (Référence)

Ce document résume les éléments critiques liés à la sécurité, aux fonctions et aux triggers côté Supabase.

Source de verite: [Supabase.csv](Supabase.csv)

## Triggers clés (auth/signup)
- **`handle_new_user` (trigger)**
  - **Preuve CSV** : `FUNCTIONS,public,handle_new_user`.
  - **Rôle** : à la création Auth, crée automatiquement :
    - `practitioners` (profil)
    - `organizations` (org par défaut)
    - `organization_members` (owner)
    - `subscriptions` (trial)
- **`on_auth_user_created` (trigger sur `auth.users`)**
  - **Preuve CSV** : `TRIGGERS,auth,users,on_auth_user_created` (si présent).
  - **Rôle** : appelle `handle_new_user` à l'inscription Supabase.

## Fonctions (SECURITY DEFINER)
- `bootstrap_practitioner_for_user(p_user_id uuid, p_email text)`
- `bootstrap_org_for_user(p_user_id uuid, p_org_name text)`
- `check_is_admin()`
- `check_is_member_of(org_id)`
- `check_paid_access()`
- `check_rate_limit(p_max_per_hour)`
- `check_signup_rate_limit(p_ip_hash, p_email_hash, p_max_per_hour)`
- `compute_score(...)`
- `consume_credit()`
- `enforce_practitioner_defaults()`
- `enforce_subscription_defaults()`
- `handle_new_user()`
- `protect_practitioner_sensitive_data()`
- `refund_credit(p_generation_id)`
- `purge_signup_rate_limit_log(p_retention_hours)`
- `rls_auto_enable()`

## Fonctions (SECURITY INVOKER / autres)
- `norm_name(input text)`
- `prevent_sensitive_updates()`
- `unaccent(text)`
- `unaccent(regdictionary, text)`
- `unaccent_init(internal)`
- `unaccent_lexize(internal, internal, internal, internal)`

## RLS clés
- `organizations`: accès conditionné par `organization_members`.
- `organization_members`:
  - `update_own_key` (update sur `encrypted_org_key` si `user_id = auth.uid()`).
  - `view_own_membership` (select).
- `practitioners`: `auth.uid() = id`.
- `patients/sessions/reports`: accès via org du patient.
- `generation_log`: accès propriétaire (`user_id = auth.uid()`).
- `ai_request_log`: RLS activé, insertion uniquement via `check_rate_limit()`.
- `signup_rate_limit_log`: RLS activé, insertion uniquement via `check_signup_rate_limit()`.

## RPC de récupération
- **`bootstrap_practitioner_for_user(p_user_id uuid, p_email text)`**
  - **Type** : `SECURITY DEFINER` (bypasse le RLS).
  - **But** : réparer les comptes où la ligne `practitioners` n'a pas ete creee.
  - **Garde** : `auth.uid() = p_user_id` (un utilisateur ne peut bootstrapper que son propre compte).
  - **Retourne** : `boolean`.
  - **Migration** : `20260209_bootstrap_practitioner_rpc.sql`
  - **Utilisation** : appelé côté client si aucun profil praticien n'est trouve.
- **`bootstrap_org_for_user(p_user_id uuid, p_org_name text)`**
  - **Type** : `SECURITY DEFINER` (bypasse le RLS).
  - **But** : réparer les comptes dont l'org/membership a été supprimé après signup, ou lorsque le trigger `handle_new_user` n'a pas créé les lignes.
  - **Garde** : `auth.uid() = p_user_id` (un utilisateur ne peut bootstrapper que son propre compte).
  - **Retourne** : `uuid` de l'organisation (existante ou nouvellement créée).
  - **Migration** : `20260208_bootstrap_org_rpc.sql`
  - **Utilisation** : appelé côté client (`AuthWizard`, `AuthContext.unlockSession`) en cas d'absence d'org.

> Remarque : si le trigger sur `auth.users` n'est pas present, `handle_new_user` ne s'executera pas. Dans ce cas, `bootstrap_practitioner_for_user` et `bootstrap_org_for_user` servent de reparation.
