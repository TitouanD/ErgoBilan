-- Suppression de la saisie brute (issue #49).
--   1. Test de Latéralité de Harris : seul test à utiliser input_model = 'raw_only'
--      (5 sous-tests), jamais utilisé par les testeuses. Supprimé ; ses sous-tests
--      partent avec lui (official_subtests_test_id_fkey : ON DELETE CASCADE).
--   2. La catégorie 'lateralite', dont c'était le seul test, est supprimée si aucun
--      test ne s'y rattache plus.
--   3. La contrainte input_model n'accepte plus 'raw_only' ni 'computed_items'
--      (jamais utilisé), pour correspondre au code (SubtestInputModel).
-- Idempotente.

begin;

delete from official_tests where id = 'harris-lateralite';

delete from official_categories c
where c.id = 'lateralite'
  and not exists (select 1 from official_tests t where t.category_id = c.id);

alter table official_subtests drop constraint if exists official_subtests_input_model_check;
alter table official_subtests
  add constraint official_subtests_input_model_check
  check (input_model = any (array['numeric_4mode'::text, 'qualitative_category'::text, 'custom_text'::text]));

commit;
