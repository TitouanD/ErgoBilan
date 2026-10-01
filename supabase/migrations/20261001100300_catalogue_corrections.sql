-- Corrections du catalogue officiel après la vérification contre les protocoles
-- publiés (issue #50, docs/catalogue/verification-2026-09-30.md).
--
--   1. Sous-tests inventés, retirés :
--      - Test des cloches : omissions hémichamp gauche / droit (protocole adulte de
--        dépistage de la négligence, absent de la cotation enfant ODEDYS 2) ;
--      - NEPSY-2 : discrimination digitale (retirée de la NEPSY-II) et précision
--        motrice (aucune épreuve de ce nom, doublon de Précision visuomotrice) ;
--      - Alouette : indice d'efficience (CTL), doublon de l'indice de vitesse, qui
--        est le CTL.
--      - TIHM : shift et rotation simple (taxonomie d'Exner, pas des tâches du test).
--      Aucune table serveur ne référence official_subtests (pas de FK entrante) :
--      la suppression ne touche que le catalogue. Les scores déjà saisis restent
--      dans les bilans locaux, sous leur id.
--   2. Métadonnées fausses :
--      - EViC : c'est l'« Évaluation de la Vitesse de frappe au Clavier » de
--        Lefévère et Galbiati (2007) ; mesure en mots par minute, pas en erreurs ;
--      - Lespargot : vitesse en lettres par minute, pas en secondes.
--   3. Écarts certains (commentaire du 29/09) :
--      - DTVP-2 : quotient VMI rangé avec les quotients composites (groupe, unité) ;
--        Constance de forme et Relations spatiales remis dans le bon quotient
--        (MRVP et VMI) ; ordre du protocole dans chaque groupe ; libellé
--        « Perception Motrice Réduite » → « Perception Visuelle à Motricité Réduite » ;
--      - MABC-2 : note totale du test en `scaled` (m=10, σ=3), comme les
--        composantes ; display_order renuméroté sans doublon (ordre affiché
--        inchangé) et orderIndex en double de l'âge 2 corrigé ;
--      - échelles : Jamar (kg) et Jebsen-Taylor (secondes) → `none` ; SPM →
--        `t-score` ; BRIEF-2 échelles de validité → `none` ; Vineland-3
--        comportements inadaptés → `none` ;
--      - ordre d'affichage du protocole : Jebsen-Taylor, MMSE, MoCA (total en
--        dernier) ; Figure de Rey : orderIndex en double et groupe Mémoire
--        rangé en 2 (ordre affiché inchangé) ;
--      - catégories : AMPS → AVQ & Fonctionnel ; Purdue, TIHM, Ozeretzki →
--        Motricité Fine.
-- Hors périmètre (à trancher test par test) : BOT-2, sous-tests douteux, « à
-- confirmer », ajouts de sous-tests manquants.
-- Données seulement, aucun changement de schéma. Idempotente. Chaque UPDATE
-- cible test_id + id.

begin;

-- ─── 1. Sous-tests inventés ─────────────────────────────────────────────────

delete from official_subtests
where (test_id, id) in (
  ('test-cloches', 'test-cloches__omissions-gauche'),
  ('test-cloches', 'test-cloches__omissions-droite'),
  ('nepsy-2',      'nepsy-2__discrimination-digitale'),
  ('nepsy-2',      'nepsy-2__precision-motrice'),
  ('alouette',     'alouette__indice-d-efficience-ctl'),
  ('tihm',         'tihm__shift'),
  ('tihm',         'tihm__rotation')
);

-- ─── 2. Métadonnées fausses ─────────────────────────────────────────────────

update official_tests
set name = 'EViC (Évaluation de la Vitesse de frappe au Clavier)',
    author = 'Lefévère & Galbiati, 2007'
where id = 'evic' and organization_id is null;

update official_subtests
set unit = 'MPM',
    input_config = jsonb_set(input_config, '{rawValueLabel}', '"MPM"'::jsonb)
where test_id = 'evic' and id in ('evic__copie', 'evic__dictee', 'evic__repetition');

update official_subtests
set unit = 'lettres/min',
    input_config = jsonb_set(input_config, '{rawValueLabel}', '"LETTRES/MIN"'::jsonb)
where test_id = 'espargot'
  and id in ('espargot_repetition_repetit_58163a62', 'espargot_dictee_dictee_58163a62', 'espargot_copie_copie_58163a62');

-- ─── 3a. DTVP-2 ─────────────────────────────────────────────────────────────
-- VMI (motricité renforcée) : Coordination œil-main, Copie, Relations spatiales,
-- Vitesse visuo-motrice. MRVP : Position dans l'espace, Figure-fond, Fermeture
-- visuelle, Constance de forme. Pas de display_group_order : les groupes se
-- trient par libellé (Intégration… < Perception… < Quotients…).

with dtvp(id, grp, ord) as (
  values
    ('dtvp-2__eye-hand',           'vmi',  1),
    ('dtvp-2__copying',            'vmi',  2),
    ('dtvp-2__spatial-relations',  'vmi',  3),
    ('dtvp-2__visual-motor-speed', 'vmi',  4),
    ('dtvp-2__position-space',     'mrvp', 5),
    ('dtvp-2__figure-ground',      'mrvp', 6),
    ('dtvp-2__visual-closure',     'mrvp', 7),
    ('dtvp-2__form-constancy',     'mrvp', 8),
    ('dtvp-2__quotient-vmi',       'comp', 9),
    ('dtvp-2__quotient-mvpr',      'comp', 10),
    ('dtvp-2__quotient-gvp',       'comp', 11)
)
update official_subtests s
set display_order = dtvp.ord,
    input_config = (s.input_config - 'groupKey' - 'groupHeaderLabel')
      || case dtvp.grp
           when 'vmi'  then '{"groupKey":"dtvp2_01_vim","groupHeaderLabel":"Intégration Visuo-Motrice"}'::jsonb
           when 'mrvp' then '{"groupKey":"dtvp2_02_pvmr","groupHeaderLabel":"Perception Visuelle à Motricité Réduite"}'::jsonb
           else             '{"groupKey":"dtvp2_03_composites","groupHeaderLabel":"Quotients Composites"}'::jsonb
         end
from dtvp
where s.test_id = 'dtvp-2' and s.id = dtvp.id;

update official_subtests
set unit = 'QS'
where test_id = 'dtvp-2' and id = 'dtvp-2__quotient-vmi';

update official_subtests
set name = 'Quotient Perception Visuelle à Motricité Réduite (MRVP)'
where test_id = 'dtvp-2' and id = 'dtvp-2__quotient-mvpr';

-- ─── 3b. MABC-2 ─────────────────────────────────────────────────────────────

update official_subtests
set score_type = 'scaled'
where test_id = 'mabc-2' and id = 'mabc-2__total-score';

-- orderIndex de l'âge 2, Dextérité : chevilles 1 et 2, lacet 3, trajet 4.
update official_subtests
set input_config = jsonb_set(input_config, '{orderIndex}', '3'::jsonb)
where test_id = 'mabc-2' and id = 'mabc-2__lacing';

update official_subtests
set input_config = jsonb_set(input_config, '{orderIndex}', '4'::jsonb)
where test_id = 'mabc-2' and id = 'mabc-2__trail-band2';

-- display_order sans doublon, dans l'ordre déjà affiché par le client
-- (subtestOrdering : display_group_order, libellé du groupe, groupKey, display_order).
with ranked as (
  select id,
         row_number() over (
           order by display_group_order,
                    (input_config ->> 'groupHeaderLabel') collate "und-x-icu",
                    input_config ->> 'groupKey',
                    display_order,
                    id
         ) as rn
  from official_subtests
  where test_id = 'mabc-2'
)
update official_subtests s
set display_order = ranked.rn
from ranked
where s.test_id = 'mabc-2' and s.id = ranked.id;

-- ─── 3c. Échelles ───────────────────────────────────────────────────────────

update official_subtests
set score_type = 'none'
where test_id = 'grip-strength'
  and id in ('grip-strength__dominant', 'grip-strength__non-dominant', 'grip-strength__pinch-lateral',
             'grip-strength__pinch-tip', 'grip-strength__pinch-three');

update official_subtests
set score_type = 'none'
where test_id = 'jebsen-taylor'
  and id in ('jebsen-taylor__feeding', 'jebsen-taylor__writing', 'jebsen-taylor__checkers',
             'jebsen-taylor__large-light', 'jebsen-taylor__large-heavy', 'jebsen-taylor__small-objects',
             'jebsen-taylor__card-turning');

update official_subtests
set score_type = 't-score'
where test_id = 'spm'
  and id in ('spm__social-participation', 'spm__vision', 'spm__hearing', 'spm__touch', 'spm__body-awareness',
             'spm__balance-and-motion', 'spm__planning-and-ideas', 'spm__total-sensory-systems');

update official_subtests
set score_type = 'none'
where test_id = 'brief-2' and id in ('brief-2__negativity', 'brief-2__inconsistency', 'brief-2__infrequency');

update official_subtests
set score_type = 'none'
where test_id = 'vineland-3' and id = 'vineland-3__maladaptive-behavior';

-- ─── 3d. Ordre d'affichage ──────────────────────────────────────────────────

-- Jebsen-Taylor : écriture, cartes, petits objets, alimentation, jetons, objets
-- légers, objets lourds.
with o(id, ord) as (
  values
    ('jebsen-taylor__writing', 1), ('jebsen-taylor__card-turning', 2), ('jebsen-taylor__small-objects', 3),
    ('jebsen-taylor__feeding', 4), ('jebsen-taylor__checkers', 5), ('jebsen-taylor__large-light', 6),
    ('jebsen-taylor__large-heavy', 7)
)
update official_subtests s set display_order = o.ord
from o where s.test_id = 'jebsen-taylor' and s.id = o.id;

-- MMSE : orientation temps, espace, apprentissage, attention et calcul, rappel,
-- langage, construction, total.
with o(id, ord) as (
  values
    ('mmse__orientation-time', 1), ('mmse__orientation-space', 2), ('mmse__memory-registration', 3),
    ('mmse__attention-calc', 4), ('mmse__recall', 5), ('mmse__language', 6), ('mmse__construction', 7),
    ('mmse__total', 8)
)
update official_subtests s set display_order = o.ord
from o where s.test_id = 'mmse' and s.id = o.id;

-- MoCA : ordre de la feuille ; « Mémoire » (douteux, gardé pour l'instant) à la
-- place des essais d'apprentissage, après la dénomination ; total en dernier.
with o(id, ord) as (
  values
    ('moca__visuospatial-exec', 1), ('moca__naming', 2), ('moca__memory-score', 3), ('moca__attention', 4),
    ('moca__language', 5), ('moca__abstraction', 6), ('moca__delayed-recall', 7), ('moca__orientation', 8),
    ('moca__total', 9)
)
update official_subtests s set display_order = o.ord
from o where s.test_id = 'moca' and s.id = o.id;

-- Figure de Rey : orderIndex cohérent avec display_order (doublon 1/1 en copie)
-- et groupe Mémoire en display_group_order 2, comme son groupOrder.
with o(id, idx) as (
  values
    ('figure-rey__copie-modele', 1), ('figure-rey__type-copie', 2), ('figure-rey__richesse-copie', 3),
    ('figure-rey__temps-copie', 4)
)
update official_subtests s
set input_config = jsonb_set(s.input_config, '{orderIndex}', to_jsonb(o.idx))
from o where s.test_id = 'figure-rey' and s.id = o.id;

update official_subtests
set display_group_order = 2
where test_id = 'figure-rey'
  and id in ('figure-rey__reproduction-memoire', 'figure-rey__type-reproduction', 'figure-rey__richesse-reproduction');

-- ─── 3e. Catégories ─────────────────────────────────────────────────────────

update official_tests set category_id = 'avq-fonctionnel'
where id = 'amps' and organization_id is null;

update official_tests set category_id = 'motricite-fine'
where id in ('purdue-pegboard', 'tihm', 'ozeretzki') and organization_id is null;

commit;

-- ─── Vérification après application (lecture seule) ─────────────────────────
-- select t.id as test_id, t.name as test, t.category_id, t.author, s.id, s.name,
--        s.unit, s.score_type, s.display_group_order as g, s.display_order as o,
--        s.input_config ->> 'groupHeaderLabel' as groupe,
--        s.input_config ->> 'orderIndex' as order_index,
--        s.input_config ->> 'rawValueLabel' as raw_label
-- from official_tests t
-- left join official_subtests s on s.test_id = t.id
-- where t.organization_id is null
--   and t.id in ('test-cloches', 'nepsy-2', 'alouette', 'tihm', 'evic', 'espargot', 'dtvp-2', 'mabc-2',
--                'grip-strength', 'jebsen-taylor', 'spm', 'brief-2', 'vineland-3', 'mmse', 'moca',
--                'figure-rey', 'amps', 'purdue-pegboard', 'ozeretzki')
--   and (t.id <> 'nepsy-2' or s.id like 'nepsy-2__precision%' or s.id = 'nepsy-2__discrimination-digitale')
-- order by t.id, g nulls first, groupe, o, s.id;
-- Attendu : aucun des 7 sous-tests retirés ; mabc-2 display_order 1 à 35 sans
-- doublon ; les valeurs ci-dessus. Contrôle des doublons d'ordre :
-- select test_id, display_group_order, input_config ->> 'groupKey', display_order, count(*)
-- from official_subtests
-- where test_id in ('mabc-2', 'dtvp-2', 'jebsen-taylor', 'mmse', 'moca', 'figure-rey')
-- group by 1, 2, 3, 4 having count(*) > 1;  -- attendu : aucune ligne
