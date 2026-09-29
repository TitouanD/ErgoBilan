-- Suppression de la saisie brute (issue #49).
--   1. Test de Latéralité de Harris : seul test à utiliser input_model = 'raw_only'
--      (5 sous-tests), jamais utilisé par les testeuses. Supprimé ; ses sous-tests
--      partent avec lui (official_subtests_test_id_fkey : ON DELETE CASCADE).
--      La catégorie 'lateralite' reste, vide : le catalogue ignore les catégories sans test.
--   2. La contrainte input_model n'accepte plus 'raw_only' ni 'computed_items'
--      (jamais utilisé), pour correspondre au code (SubtestInputModel).
-- Idempotente.

begin;

delete from official_tests where id = 'harris-lateralite';

alter table official_subtests drop constraint if exists official_subtests_input_model_check;
alter table official_subtests
  add constraint official_subtests_input_model_check
  check (input_model = any (array['numeric_4mode'::text, 'qualitative_category'::text, 'custom_text'::text]));

commit;
