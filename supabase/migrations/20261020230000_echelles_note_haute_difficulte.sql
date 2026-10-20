-- Échelles où une note haute signale une difficulté (#122, suite de #90).
--
--   1. `t-score-inverse` et `v-scale-inverse` sont ajoutées à la contrainte de
--      score_type (ajout seulement). Même moyenne et même écart-type que
--      `t-score` et `v-scale` ; l'app lit la note dans le sens du manuel et
--      inverse la zone (et le graphique) : T 72 = +2,2 ET = zone de difficulté.
--   2. Lignes passées de `none` à l'échelle inversée :
--      - BRIEF-2 : 9 échelles cliniques et 4 indices (notes T : plus la note
--        est élevée, plus les difficultés exécutives sont marquées ; Hogrefe, PAR) ;
--      - SPM : 7 échelles et le total des systèmes sensoriels (notes T ; zones
--        typique, difficultés modérées, sévères) ;
--      - Vineland-3 : Internalisé et Externalisé (notes v ; « Higher Internalizing
--        and Externalizing v-scale scores indicate more problem behavior »,
--        rapport type Pearson).
--   Restent en `none` : les échelles de validité de la BRIEF-2 (Négativité,
--   Incohérence, Rareté : notes brutes comparées à un seuil, pas des notes T) et
--   « Goût et odorat » de la SPM (pas de note T dans la SPM).
--
-- Compatible avec le client en production (main) : il ne connaît pas les
-- échelles inversées, `resolveScaleType` les lit comme `none`, soit le
-- comportement actuel. Idempotente (UPDATE à valeurs fixes).

begin;

alter table official_subtests drop constraint if exists official_subtests_score_type_domain_chk;
alter table official_subtests add constraint official_subtests_score_type_domain_chk
  check (score_type = any (array['standard', 'scaled', 't-score', 't-score-inverse', 'v-scale', 'v-scale-inverse', 'scaled-15', 'percentile', 'sten', 'stanine', 'none']));

update official_subtests
set score_type = 't-score-inverse'
where organization_id is null
  and (test_id, id) in (
    ('brief-2', 'brief-2__inhibit'),
    ('brief-2', 'brief-2__self-monitor'),
    ('brief-2', 'brief-2__shift'),
    ('brief-2', 'brief-2__emotional-control'),
    ('brief-2', 'brief-2__initiation'),
    ('brief-2', 'brief-2__working-memory'),
    ('brief-2', 'brief-2__plan-organize'),
    ('brief-2', 'brief-2__task-monitor'),
    ('brief-2', 'brief-2__organization-materials'),
    ('brief-2', 'brief-2__bri'),
    ('brief-2', 'brief-2__eri'),
    ('brief-2', 'brief-2__cri'),
    ('brief-2', 'brief-2__gec'),
    ('spm', 'spm__social-participation'),
    ('spm', 'spm__vision'),
    ('spm', 'spm__hearing'),
    ('spm', 'spm__touch'),
    ('spm', 'spm__body-awareness'),
    ('spm', 'spm__balance-and-motion'),
    ('spm', 'spm__planning-and-ideas'),
    ('spm', 'spm__total-sensory-systems')
  );

update official_subtests
set score_type = 'v-scale-inverse'
where organization_id is null
  and (test_id, id) in (
    ('vineland-3', 'vineland-3__internalizing'),
    ('vineland-3', 'vineland-3__externalizing')
  );

commit;

-- Vérification (lecture) : brief-2 13 t-score-inverse et 3 none ; spm 8
-- t-score-inverse et 1 none ; vineland-3 2 v-scale-inverse.
-- select test_id, score_type, count(*) from official_subtests
-- where organization_id is null and test_id in ('brief-2', 'spm', 'vineland-3')
-- group by 1, 2 order by 1, 2;
