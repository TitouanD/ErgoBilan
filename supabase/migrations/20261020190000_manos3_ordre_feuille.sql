-- MANOS-3 (Man.O.S 3.0) : sous-tests rangés selon les grilles de cotation (#115).
--
-- Source : grilles de cotation pour l'ergothérapeute du Man.O.S 3.0 (Lefèvre
-- Renard et Hamdi Bourgois), jointes à l'issue #115. Chaque grille est faite
-- d'un cadre par outil (Manipulation, Résultat) ; un même outil sert à plusieurs
-- classes. Une catégorie par outil, donc, dans l'ordre où l'outil apparaît pour
-- la première fois dans les grilles (CE1 : taille crayon, gomme, règle
-- souligner, règle construire, ciseaux, colle ; CE2 : compas ; CM1 : équerre ;
-- CM2 : règle relier, règle mesurer ; 6e : rapporteur), avec entre parenthèses
-- les classes qui l'utilisent. Les totaux (manipulation, résultat, temps) sont
-- à la fin, dans l'ordre des grilles.
--
-- Ni identifiant, ni nom, ni échelle ne changent : les bilans existants ne sont
-- pas touchés. Seuls display_group_order, display_order et les clés de groupe
-- d'input_config (groupKey, groupHeaderLabel, groupOrder, orderIndex) changent.
-- Données seulement, idempotente.

begin;

update official_subtests s
set display_group_order = v.group_order,
    display_order = v.display_order,
    input_config = coalesce(s.input_config, '{}'::jsonb) || jsonb_build_object(
      'groupKey', v.group_key,
      'groupHeaderLabel', v.group_label,
      'groupOrder', v.group_order,
      'orderIndex', v.order_index)
from (
  values
    ('manos-3__taille-crayon-manipulation', 1, 1, 1, 'manos3_01_taille_crayon', 'Taille crayon (CE1, CE2, CM2, 6e)'),
    ('manos-3__taille-crayon-resultat', 1, 2, 2, 'manos3_01_taille_crayon', 'Taille crayon (CE1, CE2, CM2, 6e)'),
    ('manos-3__gomme-manipulation', 2, 3, 1, 'manos3_02_gomme', 'Gomme (CE1 à 6e)'),
    ('manos-3__gomme-resultat', 2, 4, 2, 'manos3_02_gomme', 'Gomme (CE1 à 6e)'),
    ('manos-3__regle-souligner-manipulation', 3, 5, 1, 'manos3_03_regle_souligner', 'Règle souligner (CE1, CE2, CM1)'),
    ('manos-3__regle-souligner-resultat', 3, 6, 2, 'manos3_03_regle_souligner', 'Règle souligner (CE1, CE2, CM1)'),
    ('manos-3__regle-construire-manipulation', 4, 7, 1, 'manos3_04_regle_construire', 'Règle construire (CE1, CE2)'),
    ('manos-3__regle-construire-resultat', 4, 8, 2, 'manos3_04_regle_construire', 'Règle construire (CE1, CE2)'),
    ('manos-3__ciseaux-manipulation', 5, 9, 1, 'manos3_05_ciseaux', 'Ciseaux (CE1 à 6e)'),
    ('manos-3__ciseaux-resultat', 5, 10, 2, 'manos3_05_ciseaux', 'Ciseaux (CE1 à 6e)'),
    ('manos-3__colle-manipulation', 6, 11, 1, 'manos3_06_colle', 'Colle (CE1, CE2, CM2, 6e)'),
    ('manos-3__colle-resultat', 6, 12, 2, 'manos3_06_colle', 'Colle (CE1, CE2, CM2, 6e)'),
    ('manos-3__compas-manipulation', 7, 13, 1, 'manos3_07_compas', 'Compas (CE2 à 6e)'),
    ('manos-3__compas-resultat', 7, 14, 2, 'manos3_07_compas', 'Compas (CE2 à 6e)'),
    ('manos-3__equerre-manipulation', 8, 15, 1, 'manos3_08_equerre', 'Équerre (CM1, CM2, 6e)'),
    ('manos-3__equerre-resultat', 8, 16, 2, 'manos3_08_equerre', 'Équerre (CM1, CM2, 6e)'),
    ('manos-3__regle-relier-manipulation', 9, 17, 1, 'manos3_09_regle_relier', 'Règle relier (CM2, 6e)'),
    ('manos-3__regle-relier-resultat', 9, 18, 2, 'manos3_09_regle_relier', 'Règle relier (CM2, 6e)'),
    ('manos-3__regle-mesurer-manipulation', 10, 19, 1, 'manos3_10_regle_mesurer', 'Règle mesurer (CM2, 6e)'),
    ('manos-3__regle-mesurer-resultat', 10, 20, 2, 'manos3_10_regle_mesurer', 'Règle mesurer (CM2, 6e)'),
    ('manos-3__rapporteur-manipulation', 11, 21, 1, 'manos3_11_rapporteur', 'Rapporteur (6e)'),
    ('manos-3__rapporteur-resultat', 11, 22, 2, 'manos3_11_rapporteur', 'Rapporteur (6e)'),
    ('manos-3__total-manipulation', 98, 23, 1, 'manos3_98_totaux', 'Totaux'),
    ('manos-3__total-resultat', 98, 24, 2, 'manos3_98_totaux', 'Totaux'),
    ('manos-3__temps', 98, 25, 3, 'manos3_98_totaux', 'Totaux')
) as v(id, group_order, display_order, order_index, group_key, group_label)
where s.organization_id is null and s.test_id = 'manos-3' and s.id = v.id;

commit;

-- ─── Vérification après application (lecture seule) ─────────────────────────
-- select display_group_order, input_config ->> 'groupHeaderLabel', count(*), min(display_order), max(display_order)
-- from official_subtests where test_id = 'manos-3' group by 1, 2 order by 1;
-- Attendu : 11 groupes de 2 (ordres 1 à 11), puis Totaux (98) avec 3 lignes ; display_order 1 à 25.
