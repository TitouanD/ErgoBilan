-- Fix Figure de Rey grouping after Step 2 feedback migration:
-- ensure two explicit groups remain:
--   1) Copie
--   2) Reproduction de mémoire

begin;

update public.official_subtests
set input_config = jsonb_set(
  jsonb_set(
    jsonb_set(
      jsonb_set(coalesce(input_config, '{}'::jsonb), '{groupKey}', to_jsonb('rey_01_copie'::text), true),
      '{groupHeaderLabel}',
      to_jsonb('Copie'::text),
      true
    ),
    '{groupOrder}',
    to_jsonb(1),
    true
  ),
  '{orderIndex}',
  to_jsonb(v.order_index),
  true
)
from (
  values
    ('figure-rey__type-copie', 1),
    ('figure-rey__richesse-copie', 2),
    ('figure-rey__temps-copie', 3)
) as v(id, order_index)
where official_subtests.id = v.id
  and official_subtests.test_id = 'figure-rey';

update public.official_subtests
set input_config = jsonb_set(
  jsonb_set(
    jsonb_set(
      jsonb_set(coalesce(input_config, '{}'::jsonb), '{groupKey}', to_jsonb('rey_02_memoire'::text), true),
      '{groupHeaderLabel}',
      to_jsonb('Reproduction de mémoire'::text),
      true
    ),
    '{groupOrder}',
    to_jsonb(2),
    true
  ),
  '{orderIndex}',
  to_jsonb(v.order_index),
  true
)
from (
  values
    ('figure-rey__reproduction-memoire', 1),
    ('figure-rey__type-reproduction', 2),
    ('figure-rey__richesse-reproduction', 3)
) as v(id, order_index)
where official_subtests.id = v.id
  and official_subtests.test_id = 'figure-rey';

commit;
