-- #57 (docs/TECH_DEBT.md P0-8) : les vues du catalogue passent en security_invoker.
--
-- Pourquoi elles étaient en security definer : `authenticated` n'a AUCUN droit SELECT
-- sur `official_tests` ni `official_subtests` (seulement sur `official_categories` et
-- `organization_members`). En security_invoker sans GRANT, les deux vues échoueraient
-- en « permission denied for table official_tests » et le catalogue ne se chargerait
-- plus (CatalogContext journalise l'erreur et reste vide).
--
-- Donc, dans cet ordre et dans une seule transaction :
--   1. GRANT SELECT par colonne (seulement les colonnes lues par les vues ; pas
--      `author`, `version`, `created_at`) à `authenticated`. Pas de droit pour `anon`.
--   2. Policies RESTRICTIVE « onboardé » en lecture : la policy SELECT de
--      `official_tests` n'exige pas l'onboarding ; ces policies alignent la lecture
--      directe des tables (désormais possible via l'API) sur le filtre des vues.
--   3. ALTER VIEW ... SET (security_invoker = on).
--
-- Les RPC admin_* et la création de tests perso sont SECURITY DEFINER (propriétaire
-- postgres, RLS non forcée) : elles ne sont pas touchées.
-- Vérification : supabase/checks/20261001100400_catalog_views_security_invoker.sql.
-- Retour arrière : supabase/rollback/20261001100400_catalog_views_security_invoker.down.sql.

GRANT SELECT (id, name, category_id, organization_id)
  ON public.official_tests TO authenticated;

GRANT SELECT (id, test_id, name, unit, score_type, organization_id, input_model,
              input_config, display_group_order, display_order)
  ON public.official_subtests TO authenticated;

CREATE POLICY catalog_read_requires_onboarded
  ON public.official_tests
  AS RESTRICTIVE
  FOR SELECT
  TO authenticated
  USING (public.is_current_user_onboarded());

CREATE POLICY catalog_read_requires_onboarded
  ON public.official_subtests
  AS RESTRICTIVE
  FOR SELECT
  TO authenticated
  USING (public.is_current_user_onboarded());

ALTER VIEW public.view_unified_catalog SET (security_invoker = on);
ALTER VIEW public.view_unified_subtests SET (security_invoker = on);
