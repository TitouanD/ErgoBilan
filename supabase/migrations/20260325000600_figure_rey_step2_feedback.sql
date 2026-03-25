-- Apply Step 2 tester feedback for Figure de Rey:
-- 1) Remove "Copie du modèle" subtest
-- 2) Rename group header "Mémoire" -> "Reproduction de mémoire"
-- 3) Reindex remaining "Copie" subtests order

begin;

delete from public.official_subtests
where id = 'figure-rey__copie-modele'
  and test_id = 'figure-rey';

update public.official_subtests
set input_config = jsonb_set(coalesce(input_config, '{}'::jsonb), '{orderIndex}', to_jsonb(1), true)
where id = 'figure-rey__type-copie'
  and test_id = 'figure-rey';

update public.official_subtests
set input_config = jsonb_set(coalesce(input_config, '{}'::jsonb), '{orderIndex}', to_jsonb(2), true)
where id = 'figure-rey__richesse-copie'
  and test_id = 'figure-rey';

update public.official_subtests
set input_config = jsonb_set(coalesce(input_config, '{}'::jsonb), '{orderIndex}', to_jsonb(3), true)
where id = 'figure-rey__temps-copie'
  and test_id = 'figure-rey';

update public.official_subtests
set input_config = jsonb_set(
  jsonb_set(coalesce(input_config, '{}'::jsonb), '{groupHeaderLabel}', to_jsonb('Reproduction de mémoire'::text), true),
  '{orderIndex}',
  to_jsonb(1),
  true
)
where id = 'figure-rey__reproduction-memoire'
  and test_id = 'figure-rey';

update public.official_subtests
set input_config = jsonb_set(
  jsonb_set(coalesce(input_config, '{}'::jsonb), '{groupHeaderLabel}', to_jsonb('Reproduction de mémoire'::text), true),
  '{orderIndex}',
  to_jsonb(2),
  true
)
where id = 'figure-rey__type-reproduction'
  and test_id = 'figure-rey';

update public.official_subtests
set input_config = jsonb_set(
  jsonb_set(coalesce(input_config, '{}'::jsonb), '{groupHeaderLabel}', to_jsonb('Reproduction de mémoire'::text), true),
  '{orderIndex}',
  to_jsonb(3),
  true
)
where id = 'figure-rey__richesse-reproduction'
  and test_id = 'figure-rey';

commit;
