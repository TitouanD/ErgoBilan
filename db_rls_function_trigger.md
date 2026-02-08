# DB RLS / Functions / Triggers (Référence)

Ce document résume les éléments critiques liés à la sécurité, aux fonctions et aux triggers côté Supabase.

detail dans :  Supabase.csv

## Triggers clés (auth/signup)
- **`handle_new_user` (trigger)**
  - **Preuve CSV** : section `3_FUNCTION,handle_new_user`.
  - **Rôle** : à la création Auth, crée automatiquement :
    - `practitioners` (profil)
    - `organizations` (org par défaut)
    - `organization_members` (owner)
    - `subscriptions` (trial)

## Fonctions (SECURITY DEFINER)
- `bootstrap_org_for_user(p_user_id uuid, p_org_name text)`
- `check_is_admin()`
- `check_is_member_of(org_id)`
- `check_paid_access()`
- `check_rate_limit(p_max_per_hour)`
- `compute_score(...)`
- `consume_credit()`
- `enforce_practitioner_defaults()`
- `enforce_subscription_defaults()`
- `handle_new_user()`
- `protect_practitioner_sensitive_data()`
- `refund_credit(p_generation_id)`
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

## RPC de récupération
- **`bootstrap_org_for_user(p_user_id uuid, p_org_name text)`**
  - **Type** : `SECURITY DEFINER` (bypasse le RLS).
  - **But** : réparer les comptes dont l'org/membership a été supprimé après signup, ou lorsque le trigger `handle_new_user` n'a pas créé les lignes.
  - **Garde** : `auth.uid() = p_user_id` (un utilisateur ne peut bootstrapper que son propre compte).
  - **Retourne** : `uuid` de l'organisation (existante ou nouvellement créée).
  - **Migration** : `20260208_bootstrap_org_rpc.sql`
  - **Utilisation** : appelé côté client (`AuthWizard`, `AuthContext.unlockSession`) en cas d'absence d'org.

> Remarque : le trigger `handle_new_user` existe bien dans le CSV, donc **à l’inscription initiale** l’org est créée automatiquement. Le RPC sert uniquement à **réparer** les comptes dont les lignes ont été supprimées manuellement ensuite.
