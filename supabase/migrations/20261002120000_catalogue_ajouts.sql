-- Ajout au catalogue officiel des sous-tests réels manquants (#90, suite de #50).
-- Sources : docs/catalogue/verification-2026-09-30.md, section de chaque test.
--
--   - DTVP-3 : indices VMII, MRPI, GVPI (m=100, `standard`) ;
--   - DTVP-A : indices VMII, MRPI, GVPI (m=100, `standard`) ;
--   - PDMS-2 : quotients GMQ, FMQ, TMQ (m=100, `standard`) ;
--   - TEA-Ch : Sky Search DT (Faire deux choses à la fois), `scaled`, rangé après
--     Score! Dual Task ;
--   - Profil Sensoriel 2 : sections comportementales Conduites, Réponses
--     socio-émotionnelles, Réponses attentionnelles (`none`, comme les autres) ;
--   - NEPSY-2 : Horloges, Puzzles géométriques, Puzzles d'images, Orientation,
--     Réponses associées (2e tâche d'Attention auditive, note propre), `scaled` ;
--     ordre alphabétique conservé (#44) ;
--   - Barrage des H : oublis et fausses alarmes (`none`, pas d'étalonnage publié
--     pour eux), stratégie d'exploration par choix dans les 5 stratégies de la
--     feuille de passation (`qualitative_category`) ;
--   - SPM : Taste and Smell (`none` : l'échelle n'entre pas dans le total et les
--     sources ne donnent pas sa note T avec certitude) ;
--   - MABC-2 : Sauter en zig-zag autre jambe (GA3), `scaled` ; l'existant devient
--     « meilleure jambe », comme les tâches à deux jambes du GA1 ;
--   - Vineland-3 : 11 sous-domaines en notes v (m=15, σ=3, nouvelle échelle
--     `v-scale`), Internalisé et Externalisé en `none` (une note v haute y est
--     défavorable : l'app ne sait pas inverser le sens).
--
-- Laissés de côté : stratégie des Cloches (pas de liste publiée : elle va dans la
-- note de « cloches repérées ») ; Jebsen-Taylor par main et total (restructure les
-- lignes existantes, à trancher) ; douteux, BOT-2, « à confirmer ».
--
-- `v-scale` est ajoutée à la contrainte de score_type (ajout seulement). Le client
-- en production (main) ne la connaît pas encore : `resolveScaleType` la lit comme
-- `none` (saisie en ET et en % toujours possible). Aucun sous-test existant n'est
-- retiré. Idempotente (ON CONFLICT DO NOTHING, ordres explicites).

begin;

alter table official_subtests drop constraint if exists official_subtests_score_type_domain_chk;
alter table official_subtests add constraint official_subtests_score_type_domain_chk
  check (score_type = any (array['standard', 'scaled', 't-score', 'v-scale', 'percentile', 'sten', 'stanine', 'none']));

-- ─── Ajouts ─────────────────────────────────────────────────────────────────

insert into official_subtests (id, test_id, name, unit, score_type, input_model, input_config, display_group_order, display_order)
values
  -- DTVP-3
  ('dtvp-3__vmii', 'dtvp-3', 'Visual-Motor Integration Index (VMII)', null, 'standard', 'numeric_4mode',
   '{"groupKey":"dtvp3_02_indices","groupOrder":2,"orderIndex":1,"groupHeaderLabel":"Indices composites"}', 2, 6),
  ('dtvp-3__mrpi', 'dtvp-3', 'Motor-Reduced Visual Perception Index (MRPI)', null, 'standard', 'numeric_4mode',
   '{"groupKey":"dtvp3_02_indices","groupOrder":2,"orderIndex":2,"groupHeaderLabel":"Indices composites"}', 2, 7),
  ('dtvp-3__gvpi', 'dtvp-3', 'General Visual Perception Index (GVPI)', null, 'standard', 'numeric_4mode',
   '{"groupKey":"dtvp3_02_indices","groupOrder":2,"orderIndex":3,"groupHeaderLabel":"Indices composites"}', 2, 8),
  -- DTVP-A
  ('dtvp-a__vmii', 'dtvp-a', 'Visual-Motor Integration Index (Intégration visuo-motrice)', null, 'standard', 'numeric_4mode',
   '{"groupKey":"dtvpa_02_indices","groupOrder":2,"orderIndex":1,"groupHeaderLabel":"Indices DTVP-A"}', 2, 7),
  ('dtvp-a__mrpi', 'dtvp-a', 'Motor-Reduced Visual Perception Index (Perception visuelle à motricité réduite)', null, 'standard', 'numeric_4mode',
   '{"groupKey":"dtvpa_02_indices","groupOrder":2,"orderIndex":2,"groupHeaderLabel":"Indices DTVP-A"}', 2, 8),
  ('dtvp-a__gvpi', 'dtvp-a', 'General Visual Perception Index (Perception visuelle générale)', null, 'standard', 'numeric_4mode',
   '{"groupKey":"dtvpa_02_indices","groupOrder":2,"orderIndex":3,"groupHeaderLabel":"Indices DTVP-A"}', 2, 9),
  -- PDMS-2
  ('pdms-2__gmq', 'pdms-2', 'Gross Motor Quotient (GMQ)', null, 'standard', 'numeric_4mode',
   '{"groupKey":"pdms2_02_quotients","groupOrder":2,"orderIndex":1,"groupHeaderLabel":"Quotients"}', 2, 7),
  ('pdms-2__fmq', 'pdms-2', 'Fine Motor Quotient (FMQ)', null, 'standard', 'numeric_4mode',
   '{"groupKey":"pdms2_02_quotients","groupOrder":2,"orderIndex":2,"groupHeaderLabel":"Quotients"}', 2, 8),
  ('pdms-2__tmq', 'pdms-2', 'Total Motor Quotient (TMQ)', null, 'standard', 'numeric_4mode',
   '{"groupKey":"pdms2_02_quotients","groupOrder":2,"orderIndex":3,"groupHeaderLabel":"Quotients"}', 2, 9),
  -- TEA-Ch (ordre fixé plus bas)
  ('tea-ch__sky-search-dual-task', 'tea-ch', 'Sky Search Dual Task', null, 'scaled', 'numeric_4mode',
   '{"groupKey":"teach_subtests","groupOrder":1,"orderIndex":4,"groupHeaderLabel":"Sous-tests"}', 1, 4),
  -- Profil Sensoriel 2
  ('profil-sensoriel-2__behavioral', 'profil-sensoriel-2', 'Conduites (Behavioral)', null, 'none', 'numeric_4mode',
   '{"groupKey":"ps2_02_comportement","groupOrder":2,"orderIndex":1,"groupHeaderLabel":"Sections comportementales"}', 2, 11),
  ('profil-sensoriel-2__social-emotional', 'profil-sensoriel-2', 'Réponses socio-émotionnelles (Social Emotional)', null, 'none', 'numeric_4mode',
   '{"groupKey":"ps2_02_comportement","groupOrder":2,"orderIndex":2,"groupHeaderLabel":"Sections comportementales"}', 2, 12),
  ('profil-sensoriel-2__attentional', 'profil-sensoriel-2', 'Réponses attentionnelles (Attentional)', null, 'none', 'numeric_4mode',
   '{"groupKey":"ps2_02_comportement","groupOrder":2,"orderIndex":3,"groupHeaderLabel":"Sections comportementales"}', 2, 13),
  -- NEPSY-2 (display_order renuméroté plus bas)
  ('nepsy-2__horloges', 'nepsy-2', 'Horloges', null, 'scaled', 'numeric_4mode',
   '{"groupKey":"nepsy2_all","groupHeaderLabel":"Sous-tests"}', 1, 100),
  ('nepsy-2__puzzles-geometriques', 'nepsy-2', 'Puzzles géométriques', null, 'scaled', 'numeric_4mode',
   '{"groupKey":"nepsy2_all","groupHeaderLabel":"Sous-tests"}', 1, 101),
  ('nepsy-2__puzzles-d-images', 'nepsy-2', 'Puzzles d''images', null, 'scaled', 'numeric_4mode',
   '{"groupKey":"nepsy2_all","groupHeaderLabel":"Sous-tests"}', 1, 102),
  ('nepsy-2__orientation', 'nepsy-2', 'Orientation', null, 'scaled', 'numeric_4mode',
   '{"groupKey":"nepsy2_all","groupHeaderLabel":"Sous-tests"}', 1, 103),
  ('nepsy-2__reponses-associees', 'nepsy-2', 'Attention auditive — Réponses associées', null, 'scaled', 'numeric_4mode',
   '{"groupKey":"nepsy2_all","groupHeaderLabel":"Sous-tests"}', 1, 104),
  -- Barrage des H
  ('barrage-h__oublis', 'barrage-h', 'Oublis (omissions)', 'pts', 'none', 'numeric_4mode',
   '{"groupKey":"barrageh_01_scores","groupOrder":1,"orderIndex":3,"groupHeaderLabel":"Scores Barrage des H"}', 1, 3),
  ('barrage-h__fausses-alarmes', 'barrage-h', 'Fausses alarmes (confusions de lettres)', 'pts', 'none', 'numeric_4mode',
   '{"groupKey":"barrageh_01_scores","groupOrder":1,"orderIndex":4,"groupHeaderLabel":"Scores Barrage des H"}', 1, 4),
  ('barrage-h__strategie', 'barrage-h', 'Stratégie d''exploration', null, 'none', 'qualitative_category',
   '{"groupKey":"barrageh_01_scores","groupOrder":1,"orderIndex":5,"groupHeaderLabel":"Scores Barrage des H","options":[
      {"code":"anarchique","label":"Anarchique","order":1},
      {"code":"lineaire-retour","label":"Linéaire, avec retour à la ligne","order":2},
      {"code":"lineaire-sans-retour","label":"Linéaire, sans retour à la ligne","order":3},
      {"code":"colonne-retour","label":"En colonne, avec retour en haut","order":4},
      {"code":"colonne-sans-retour","label":"En colonne, sans retour en haut","order":5}]}', 1, 5),
  -- SPM
  ('spm__taste-and-smell', 'spm', 'Taste and Smell', null, 'none', 'numeric_4mode',
   '{"groupKey":"spm_scales","groupOrder":1,"orderIndex":9,"groupHeaderLabel":"Échelles"}', 1, 9),
  -- MABC-2 (display_order renuméroté plus bas)
  ('mabc-2__zigzag-hop-other', 'mabc-2', 'Sauter en zig-zag autre jambe', null, 'scaled', 'numeric_4mode',
   '{"groupKey":"mabc2_03_age3_equilibre","groupOrder":5,"orderIndex":5,"groupHeaderLabel":"Groupe d''âge 3 (11 à 16 ans) — Équilibre"}', 5, 28),
  -- Vineland-3 : sous-domaines
  ('vineland-3__receptive', 'vineland-3', 'Réceptif (Receptive)', null, 'v-scale', 'numeric_4mode',
   '{"groupKey":"vineland3_subdomains","groupOrder":3,"orderIndex":1,"groupHeaderLabel":"Sous-domaines (notes v)"}', 3, 7),
  ('vineland-3__expressive', 'vineland-3', 'Expressif (Expressive)', null, 'v-scale', 'numeric_4mode',
   '{"groupKey":"vineland3_subdomains","groupOrder":3,"orderIndex":2,"groupHeaderLabel":"Sous-domaines (notes v)"}', 3, 8),
  ('vineland-3__written', 'vineland-3', 'Écrit (Written)', null, 'v-scale', 'numeric_4mode',
   '{"groupKey":"vineland3_subdomains","groupOrder":3,"orderIndex":3,"groupHeaderLabel":"Sous-domaines (notes v)"}', 3, 9),
  ('vineland-3__personal', 'vineland-3', 'Personnel (Personal)', null, 'v-scale', 'numeric_4mode',
   '{"groupKey":"vineland3_subdomains","groupOrder":3,"orderIndex":4,"groupHeaderLabel":"Sous-domaines (notes v)"}', 3, 10),
  ('vineland-3__domestic', 'vineland-3', 'Domestique (Domestic)', null, 'v-scale', 'numeric_4mode',
   '{"groupKey":"vineland3_subdomains","groupOrder":3,"orderIndex":5,"groupHeaderLabel":"Sous-domaines (notes v)"}', 3, 11),
  ('vineland-3__community', 'vineland-3', 'Communauté (Community)', null, 'v-scale', 'numeric_4mode',
   '{"groupKey":"vineland3_subdomains","groupOrder":3,"orderIndex":6,"groupHeaderLabel":"Sous-domaines (notes v)"}', 3, 12),
  ('vineland-3__interpersonal', 'vineland-3', 'Relations interpersonnelles (Interpersonal Relationships)', null, 'v-scale', 'numeric_4mode',
   '{"groupKey":"vineland3_subdomains","groupOrder":3,"orderIndex":7,"groupHeaderLabel":"Sous-domaines (notes v)"}', 3, 13),
  ('vineland-3__play-leisure', 'vineland-3', 'Jeu et loisirs (Play and Leisure)', null, 'v-scale', 'numeric_4mode',
   '{"groupKey":"vineland3_subdomains","groupOrder":3,"orderIndex":8,"groupHeaderLabel":"Sous-domaines (notes v)"}', 3, 14),
  ('vineland-3__coping', 'vineland-3', 'Adaptation (Coping Skills)', null, 'v-scale', 'numeric_4mode',
   '{"groupKey":"vineland3_subdomains","groupOrder":3,"orderIndex":9,"groupHeaderLabel":"Sous-domaines (notes v)"}', 3, 15),
  ('vineland-3__fine-motor', 'vineland-3', 'Motricité fine (Fine Motor)', null, 'v-scale', 'numeric_4mode',
   '{"groupKey":"vineland3_subdomains","groupOrder":3,"orderIndex":10,"groupHeaderLabel":"Sous-domaines (notes v)"}', 3, 16),
  ('vineland-3__gross-motor', 'vineland-3', 'Motricité globale (Gross Motor)', null, 'v-scale', 'numeric_4mode',
   '{"groupKey":"vineland3_subdomains","groupOrder":3,"orderIndex":11,"groupHeaderLabel":"Sous-domaines (notes v)"}', 3, 17),
  -- Vineland-3 : comportements inadaptés
  ('vineland-3__internalizing', 'vineland-3', 'Internalisé (Internalizing)', null, 'none', 'numeric_4mode',
   '{"groupKey":"vineland3_maladaptive","groupOrder":4,"orderIndex":1,"groupHeaderLabel":"Comportements inadaptés"}', 4, 18),
  ('vineland-3__externalizing', 'vineland-3', 'Externalisé (Externalizing)', null, 'none', 'numeric_4mode',
   '{"groupKey":"vineland3_maladaptive","groupOrder":4,"orderIndex":2,"groupHeaderLabel":"Comportements inadaptés"}', 4, 19)
on conflict (id) do nothing;

-- ─── Libellé ────────────────────────────────────────────────────────────────

update official_subtests set name = 'Sauter en zig-zag meilleure jambe'
where test_id = 'mabc-2' and id = 'mabc-2__zigzag-hop';

-- ─── Ordres ─────────────────────────────────────────────────────────────────

-- TEA-Ch : les deux doubles tâches côte à côte.
with o(id, ord) as (
  values
    ('tea-ch__sky-search', 1), ('tea-ch__score', 2), ('tea-ch__score-dual-task', 3),
    ('tea-ch__sky-search-dual-task', 4), ('tea-ch__walk-don-t-walk', 5), ('tea-ch__code-transmission', 6),
    ('tea-ch__creature-counting', 7), ('tea-ch__map-mission', 8), ('tea-ch__opposite-worlds', 9)
)
update official_subtests s
set display_order = o.ord,
    input_config = jsonb_set(s.input_config, '{orderIndex}', to_jsonb(o.ord))
from o where s.test_id = 'tea-ch' and s.id = o.id;

-- NEPSY-2 : ordre alphabétique (#44), sans trou.
with ranked as (
  select id, row_number() over (order by name collate "und-x-icu", id) as rn
  from official_subtests
  where test_id = 'nepsy-2' and organization_id is null
)
update official_subtests s set display_order = ranked.rn
from ranked where s.test_id = 'nepsy-2' and s.id = ranked.id;

-- MABC-2 : même renumérotation que 20261001100300 (ordre déjà affiché par le client).
with ranked as (
  select id,
         row_number() over (
           order by display_group_order,
                    (input_config ->> 'groupHeaderLabel') collate "und-x-icu",
                    input_config ->> 'groupKey',
                    (input_config ->> 'orderIndex')::int,
                    display_order,
                    id
         ) as rn
  from official_subtests
  where test_id = 'mabc-2'
)
update official_subtests s set display_order = ranked.rn
from ranked where s.test_id = 'mabc-2' and s.id = ranked.id;

commit;

-- ─── Vérification après application (lecture seule) ─────────────────────────
-- select test_id, count(*) from official_subtests
-- where organization_id is null
--   and test_id in ('dtvp-3','dtvp-a','pdms-2','tea-ch','profil-sensoriel-2','nepsy-2','barrage-h','spm','mabc-2','vineland-3')
-- group by 1 order by 1;
-- Attendu : barrage-h 5, dtvp-3 8, dtvp-a 9, mabc-2 36, nepsy-2 51, pdms-2 9,
-- profil-sensoriel-2 13, spm 9, tea-ch 9, vineland-3 19.
-- select test_id, display_group_order, input_config ->> 'groupKey', display_order, count(*)
-- from official_subtests
-- where test_id in ('mabc-2','nepsy-2','tea-ch','dtvp-3','dtvp-a','pdms-2','profil-sensoriel-2','barrage-h','spm','vineland-3')
-- group by 1, 2, 3, 4 having count(*) > 1;  -- attendu : aucune ligne
