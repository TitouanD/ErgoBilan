-- Retour arrière de supabase/migrations/20261001100400_catalog_views_security_invoker.sql (#57).
-- Hors du dossier migrations : à lancer à la main, en une transaction, si la
-- vérification échoue. Rétablit exactement l'état du 2026-10-01 (vues en definer,
-- aucun droit de `authenticated` sur official_tests / official_subtests).

BEGIN;

ALTER VIEW public.view_unified_catalog RESET (security_invoker);
ALTER VIEW public.view_unified_subtests RESET (security_invoker);

DROP POLICY IF EXISTS catalog_read_requires_onboarded ON public.official_tests;
DROP POLICY IF EXISTS catalog_read_requires_onboarded ON public.official_subtests;

REVOKE SELECT (id, name, category_id, organization_id)
  ON public.official_tests FROM authenticated;

REVOKE SELECT (id, test_id, name, unit, score_type, organization_id, input_model,
               input_config, display_group_order, display_order)
  ON public.official_subtests FROM authenticated;

COMMIT;

-- Contrôle après retour arrière (attendu : reloptions NULL, 0 policy, false/false) :
-- select relname, reloptions from pg_class where relname in ('view_unified_catalog','view_unified_subtests');
-- select count(*) from pg_policies where policyname = 'catalog_read_requires_onboarded';
-- select has_any_column_privilege('authenticated','public.official_tests','SELECT'),
--        has_any_column_privilege('authenticated','public.official_subtests','SELECT');
