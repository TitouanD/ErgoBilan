-- BOT-2 : échelle des sous-tests, note d'échelle m=15, σ=5 (#123, suite de #90).
-- Source : Pearson, BOT-2 Complete Form Sample Report (notes d'échelle des
-- 8 sous-tests, moyenne 15, écart-type 5 ; composites en m=50, σ=10).
--
--   1. `scaled-15` est ajoutée à la contrainte de score_type (ajout seulement,
--      comme `v-scale` en #90).
--   2. Les 8 sous-tests du BOT-2 passent de `none` à `scaled-15`. L'en-tête de
--      groupe ne répète plus l'échelle, affichée par le tableau des scores.
--
-- Compatible avec le client en production (main) : il ne connaît pas
-- `scaled-15`, `resolveScaleType` la lit comme `none`, soit le comportement
-- actuel. Idempotente (UPDATE à valeurs fixes).

begin;

alter table official_subtests drop constraint if exists official_subtests_score_type_domain_chk;
alter table official_subtests add constraint official_subtests_score_type_domain_chk
  check (score_type = any (array['standard', 'scaled', 't-score', 'v-scale', 'scaled-15', 'percentile', 'sten', 'stanine', 'none']));

update official_subtests
set score_type = 'scaled-15',
    input_config = jsonb_set(input_config, '{groupHeaderLabel}', '"Sous-tests (notes d''échelle)"')
where organization_id is null
  and test_id = 'bot-2'
  and id in (
    'bot-2__fine-motor-precision',
    'bot-2__fine-motor-integration',
    'bot-2__manual-dexterity',
    'bot-2__bilateral-coordination',
    'bot-2__balance',
    'bot-2__running-speed-agility',
    'bot-2__upper-limb-coordination',
    'bot-2__strength'
  );

commit;

-- Vérification (lecture) : 8 lignes en scaled-15, 5 composites en t-score.
-- select score_type, count(*) from official_subtests
-- where organization_id is null and test_id = 'bot-2' group by score_type;
