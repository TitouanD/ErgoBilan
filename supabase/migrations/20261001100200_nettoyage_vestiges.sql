-- Nettoyage des vestiges en base (#65, docs/TECH_DEBT.md P2-5 et P2-8).
--
-- Vérifié en base le 2026-10-01 (statistiques depuis le 2025-12-08) et dans le code
-- de dev et de main (git grep, edges `generate` et `signup` déployées comprises) :
--
-- Index (idx_scan = 0, aucun ne porte de contrainte PK/UNIQUE) :
--   - signup_rate_limit_created_at_idx : supprimé (table vide, aucun appelant de
--     check_signup_rate_limit).
--   - idx_pending_questionnaires_practitioner : supprimé ; la clé étrangère
--     practitioner_id reste couverte par idx_pending_questionnaires_practitioner_created_at
--     (practitioner_id, created_at DESC), 520 scans.
--   - CONSERVÉS : idx_official_tests_category (seul index de la clé étrangère
--     fk_official_tests_category) et generation_log_user_created_at_idx (seul index de
--     la clé étrangère generation_log_user_id_fkey vers auth.users). Les supprimer fait
--     passer la suppression d'une catégorie ou d'un compte par un parcours complet de
--     la table, et l'advisor Supabase lèverait « unindexed foreign key ».
--
-- Colonnes :
--   - organization_members.encrypted_org_key : lue nulle part (ni client, ni edge, ni
--     vue, ni policy) ; seule handle_new_user l'écrivait (NULL), réécrite sans elle par
--     20261001100100. 4 lignes non nulles : clés enveloppées de l'ancien schéma
--     MasterKey/OrgKey, obsolète. Les droits SELECT/UPDATE de `authenticated` sur la
--     colonne disparaissent avec elle.
--   - organizations.stripe_customer_id : toujours NULL, lue nulle part.
--
-- Table admin_audit_log : 0 ligne, écrite par aucune fonction ; ses 2 policies, son
-- trigger et sa fonction update_admin_audit_log_timestamp (qui ne sert qu'à elle)
-- partent avec. Pas de CASCADE : un dépendant imprévu ferait échouer la migration.
--
-- Prérequis : 20261001100100 (handle_new_user ne doit plus citer encrypted_org_key).
-- Idempotente.

begin;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND (p.prosrc ILIKE '%encrypted_org_key%'
        OR p.prosrc ILIKE '%stripe_customer_id%'
        OR p.prosrc ILIKE '%admin_audit_log%')
      AND p.proname <> 'update_admin_audit_log_timestamp'
  ) THEN
    RAISE EXCEPTION 'Une fonction SQL cite encore une colonne ou la table supprimée : appliquer 20261001100100 d''abord';
  END IF;
END;
$$;

-- Index
DROP INDEX IF EXISTS public.signup_rate_limit_created_at_idx;
DROP INDEX IF EXISTS public.idx_pending_questionnaires_practitioner;

-- Colonnes
ALTER TABLE public.organization_members DROP COLUMN IF EXISTS encrypted_org_key;
ALTER TABLE public.organizations DROP COLUMN IF EXISTS stripe_customer_id;

-- admin_audit_log
DROP TABLE IF EXISTS public.admin_audit_log;
DROP FUNCTION IF EXISTS public.update_admin_audit_log_timestamp();

commit;
