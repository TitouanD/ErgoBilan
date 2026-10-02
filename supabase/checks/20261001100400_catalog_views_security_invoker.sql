-- Vérification de supabase/migrations/20261001100400_catalog_views_security_invoker.sql (#57).
-- À lancer JUSTE APRÈS l'application, avec l'accord de Titouan. Chaque bloc est une
-- transaction annulée (ROLLBACK) : rien n'est écrit. Si un résultat diffère de
-- l'attendu : lancer supabase/rollback/20261001100400_catalog_views_security_invoker.down.sql.
--
-- Comptes relevés le 2026-10-01 (en lecture, comme postgres, en rejouant la logique
-- des vues pour chaque praticien) :
--   official_categories 9 ; official_tests 44 (42 officiels, 2 perso de l'org
--   9ad49003-…) ; official_subtests 352 (3 perso, tous rattachés aux 2 tests perso).
--   5 praticiens, tous onboardés, chacun membre d'une seule organisation.
--   - praticien non admin (ex. 37ad5867-e4c8-440b-aee3-f895db0a69e0) :
--       view_unified_catalog 42 lignes, md5(ids triés) d4a9e0af1343e8afc5093feb93202d2d,
--       somme subtests_count 349 ;
--       view_unified_subtests 349 lignes, md5 11eefd837679abc143f3d0f66c9ac8ce.
--   - admin avec tests perso (84a72bb8-8e23-46b0-bd96-84343cb35309, org 9ad49003-…) :
--       view_unified_catalog 44 lignes, md5 a8cb551b9b8fc5197043a3ee9bb746a8 ;
--       view_unified_subtests 352 lignes, md5 7e00028757cb31bca5ccb44f0cfdddf1.
--   - anon : aucun GRANT sur les vues -> erreur 42501, avant comme après.
-- Le catalogue peut avoir changé entre-temps (#50) : en cas d'écart, rejouer d'abord
-- la requête 0 qui recalcule l'attendu comme postgres.

-- 0. Attendu recalculé (comme postgres, hors simulation) ------------------------------
select 'tests_off' k, count(*) n, md5(string_agg(t.id, ',' order by t.id)) h
  from official_tests t join official_categories c on c.id = t.category_id
 where t.organization_id is null
union all
select 'tests_admin', count(*), md5(string_agg(t.id, ',' order by t.id))
  from official_tests t join official_categories c on c.id = t.category_id
 where t.organization_id is null or t.organization_id = '9ad49003-ecb5-4a9f-bb7c-8299796216ff'
union all
select 'subs_off', count(*), md5(string_agg(s.id, ',' order by s.id))
  from official_subtests s join official_tests t on t.id = s.test_id
 where s.organization_id is null and t.organization_id is null
union all
select 'subs_admin', count(*), md5(string_agg(s.id, ',' order by s.id))
  from official_subtests s join official_tests t on t.id = s.test_id
 where (s.organization_id is null or s.organization_id = '9ad49003-ecb5-4a9f-bb7c-8299796216ff')
   and (t.organization_id is null or t.organization_id = '9ad49003-ecb5-4a9f-bb7c-8299796216ff');

-- 1. État des objets ------------------------------------------------------------------
-- Attendu : reloptions {security_invoker=on} pour les deux vues.
select relname, reloptions from pg_class
 where relnamespace = 'public'::regnamespace
   and relname in ('view_unified_catalog', 'view_unified_subtests');
-- Attendu : 2 lignes (official_tests, official_subtests), RESTRICTIVE, SELECT, {authenticated}.
select tablename, policyname, permissive, cmd, roles from pg_policies
 where policyname = 'catalog_read_requires_onboarded';
-- Attendu : true, true, false, false (anon n'a rien).
select has_any_column_privilege('authenticated', 'public.official_tests', 'SELECT'),
       has_any_column_privilege('authenticated', 'public.official_subtests', 'SELECT'),
       has_any_column_privilege('anon', 'public.official_tests', 'SELECT'),
       has_any_column_privilege('anon', 'public.official_subtests', 'SELECT');

-- 2. Praticien non admin, sans test perso ----------------------------------------------
-- Attendu : 42 | d4a9e0af1343e8afc5093feb93202d2d | 349 | 349 | 11eefd837679abc143f3d0f66c9ac8ce
begin;
select set_config('request.jwt.claims',
  '{"sub":"37ad5867-e4c8-440b-aee3-f895db0a69e0","role":"authenticated"}', true);
set local role authenticated;
select (select count(*) from view_unified_catalog) tests,
       (select md5(string_agg(id, ',' order by id)) from view_unified_catalog) tests_md5,
       (select sum(subtests_count) from view_unified_catalog) subtests_count_sum,
       (select count(*) from view_unified_subtests) subtests,
       (select md5(string_agg(id, ',' order by id)) from view_unified_subtests) subtests_md5;
rollback;

-- 3. Admin avec 2 tests perso dans son organisation -------------------------------------
-- Attendu : 44 | a8cb551b9b8fc5197043a3ee9bb746a8 | 352 | 7e00028757cb31bca5ccb44f0cfdddf1
begin;
select set_config('request.jwt.claims',
  '{"sub":"84a72bb8-8e23-46b0-bd96-84343cb35309","role":"authenticated"}', true);
set local role authenticated;
select (select count(*) from view_unified_catalog) tests,
       (select md5(string_agg(id, ',' order by id)) from view_unified_catalog) tests_md5,
       (select count(*) from view_unified_subtests) subtests,
       (select md5(string_agg(id, ',' order by id)) from view_unified_subtests) subtests_md5;
rollback;

-- 4. Isolement : le non admin ne lit pas les tests perso d'une autre organisation, ni
--    par la vue ni par la table (lecture directe désormais permise par le GRANT).
-- Attendu : 0 | 0 | 0
begin;
select set_config('request.jwt.claims',
  '{"sub":"37ad5867-e4c8-440b-aee3-f895db0a69e0","role":"authenticated"}', true);
set local role authenticated;
select (select count(*) from view_unified_catalog where id in
          (select id from official_tests where organization_id is not null)) via_vue,
       (select count(*) from official_tests where organization_id is not null) table_tests,
       (select count(*) from official_subtests where organization_id is not null) table_subtests;
rollback;

-- 5. Utilisateur authentifié sans profil onboardé (uuid inexistant) ---------------------
-- Attendu : 0 | 0 | 0 | 0 (avant la migration, les vues donnaient déjà 0).
begin;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000000","role":"authenticated"}', true);
set local role authenticated;
select (select count(*) from view_unified_catalog) vue_tests,
       (select count(*) from view_unified_subtests) vue_subtests,
       (select count(*) from official_tests) table_tests,
       (select count(*) from official_subtests) table_subtests;
rollback;

-- 6. anon -------------------------------------------------------------------------------
-- Attendu : ERREUR 42501 permission denied for view view_unified_catalog (comme avant).
begin;
set local role anon;
select count(*) from view_unified_catalog;
rollback;

-- 7. Dans l'application, compte praticien : recharger, ouvrir le choix des tests d'un
--    bilan (ou `npm run capture -- "scenario=initial&etape=2"`, compte de test) : le
--    catalogue doit être plein, et la console sans « Catalog Load Error ».
-- 8. Linter Supabase (get_advisors security) : plus d'alerte security_definer_view.
