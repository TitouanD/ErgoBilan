-- Retours testeuse du 2026-09-28 (docs/RETOURS.md) : catalogue officiel.
--   1. MABC-2, groupe d'âge 2 (7 à 10 ans) : sous-tests manquants.
--   2. NEPSY-2 : renommage PV composite, liste à plat triée par ordre alphabétique.
--   3. Man.O.S 3.0 : nouveau test (motricité fine).
-- Données seulement, aucun changement de schéma. Idempotente (ON CONFLICT / UPDATE).

begin;

-- ─── 1. MABC-2, groupe d'âge 2 ──────────────────────────────────────────────
-- Le tri se fait par libellé de groupe puis display_order : les valeurs n'ont
-- besoin d'être ordonnées qu'à l'intérieur d'un même groupe.

insert into official_subtests (id, test_id, name, unit, score_type, input_model, input_config, display_group_order, display_order)
values
  ('mabc-2__pegs-non-preferred', 'mabc-2', 'Chevilles main non préférée', 'pts', 'scaled', 'numeric_4mode',
   '{"groupKey":"mabc2_02_age2_dexterite","groupOrder":4,"orderIndex":2,"rawValueLabel":"SEC.","groupHeaderLabel":"Groupe d''âge 2 (7 à 10 ans) — Dextérité manuelle"}',
   4, 13),
  ('mabc-2__throw-bag-mat', 'mabc-2', 'Lancer le sac sur le tapis', 'pts', 'scaled', 'numeric_4mode',
   '{"groupKey":"mabc2_02_age2_viser_attraper","groupOrder":4,"orderIndex":2,"groupHeaderLabel":"Groupe d''âge 2 (7 à 10 ans) — Viser et attraper"}',
   4, 12),
  ('mabc-2__hop-mat-other-leg', 'mabc-2', 'Sauter à cloche pied sur tapis jambe non préférée', 'pts', 'scaled', 'numeric_4mode',
   '{"groupKey":"mabc2_02_age2_equilibre","groupOrder":4,"orderIndex":5,"groupHeaderLabel":"Groupe d''âge 2 (7 à 10 ans) — Équilibre"}',
   4, 19)
on conflict (id) do nothing;

update official_subtests
set name = 'Sauter à cloche pied sur tapis jambe préférée'
where id = 'mabc-2__hop-mat-one-leg';

-- groupOrder 99 incohérent dans la config (la colonne display_group_order = 4 prime).
update official_subtests
set input_config = jsonb_set(input_config, '{groupOrder}', '4'::jsonb)
where test_id = 'mabc-2' and input_config ->> 'groupKey' = 'mabc2_02_age2_equilibre';

update official_subtests
set input_config = jsonb_set(input_config, '{groupOrder}', '5'::jsonb)
where test_id = 'mabc-2' and input_config ->> 'groupKey' in ('mabc2_03_age3_equilibre', 'mabc2_03_age3_viser_attraper');

-- ─── 2. NEPSY-2 ─────────────────────────────────────────────────────────────

update official_subtests
set name = 'Précision visuomotrice, note étalonnée PV Composite'
where id = 'nepsy-2__precision-visuomotrice';

update official_subtests
set name = 'Précision visuomotrice — ' || name
where id in ('nepsy-2__pv-duree-execution', 'nepsy-2__pv-score-erreurs', 'nepsy-2__pv-levers-crayon')
  and name not like 'Précision visuomotrice — %';

-- Un seul groupe (sinon le client regroupe les noms « X — Y » sous « X ») et
-- display_order alphabétique : le sous-test avant ses sous-sous-tests.
with ranked as (
  select id,
         row_number() over (
           order by
             (case when id = 'nepsy-2__precision-visuomotrice' then 'Précision visuomotrice'
                   else split_part(name, ' — ', 1) end) collate "und-x-icu",
             (name like '% — %'),
             name collate "und-x-icu"
         ) as rn
  from official_subtests
  where test_id = 'nepsy-2'
)
update official_subtests s
set display_group_order = 1,
    display_order = ranked.rn,
    input_config = (s.input_config - 'groupKey' - 'groupHeaderLabel' - 'groupOrder' - 'orderIndex')
                   || '{"groupKey":"nepsy2_all","groupHeaderLabel":"Sous-tests"}'::jsonb
from ranked
where s.id = ranked.id;

-- ─── 3. Man.O.S 3.0 ─────────────────────────────────────────────────────────
-- Le tableur donne une déviation standard (DS) par item : elle se saisit dans
-- la colonne ET. La note brute (ex. 3/4) peut aller dans l'observation.
-- Items propres à certains niveaux : la praticienne ne sélectionne que les lignes utiles.

insert into official_tests (id, name, category_id, author, version)
values ('manos-3', 'Man.O.S 3.0', 'motricite-fine', 'official', '3.0')
on conflict (id) do nothing;

with items(slug, label, ord) as (
  values
    ('taille-crayon',     'Taille crayon',              1),
    ('gomme',             'Gomme',                      2),
    ('regle-souligner',   'Règle souligner CE1 / CE2',  3),
    ('regle-construire',  'Règle construire CE1 / CE2', 4),
    ('ciseaux',           'Ciseaux',                    5),
    ('colle',             'Colle',                      6),
    ('compas',            'Compas',                     7),
    ('regle-relier',      'Règle relier CM2 / 6ème',    8),
    ('regle-mesurer',     'Règle mesurer CM2 / 6ème',   9),
    ('equerre',           'Équerre',                    10),
    ('rapporteur',        'Rapporteur 6ème',            11)
),
parts(pslug, plabel, pord) as (
  values ('manipulation', 'manipulation', 1), ('resultat', 'résultat', 2)
),
manos_rows as (
  select 'manos-3__' || i.slug || '-' || p.pslug as id,
         i.label || ' — ' || p.plabel as name,
         1 as grp,
         (i.ord - 1) * 2 + p.pord as ord,
         '{"groupKey":"manos3_01_items","groupHeaderLabel":"Items"}'::jsonb as cfg
  from items i cross join parts p
  union all
  select * from (values
    ('manos-3__total-manipulation', 'Total manipulation', 2, 1, '{"groupKey":"manos3_02_totaux","groupHeaderLabel":"Totaux"}'::jsonb),
    ('manos-3__total-resultat',     'Total résultat',     2, 2, '{"groupKey":"manos3_02_totaux","groupHeaderLabel":"Totaux"}'::jsonb),
    ('manos-3__temps',              'Temps (en secondes)', 2, 3, '{"groupKey":"manos3_02_totaux","groupHeaderLabel":"Totaux"}'::jsonb)
  ) as t(id, name, grp, ord, cfg)
)
insert into official_subtests (id, test_id, name, unit, score_type, input_model, input_config, display_group_order, display_order)
select id, 'manos-3', name, 'pts', 'none', 'numeric_4mode', cfg, grp, ord
from manos_rows
on conflict (id) do nothing;

commit;
