-- MABC-2 : ordre des groupes demandé par la testeuse (issue #100).
--
-- Par groupe d'âge (1, 2, 3), dans cet ordre exact : Dextérité manuelle, Viser
-- et attraper, Équilibre ; puis les notes totales.
--   - Âge 1 : déjà dans cet ordre (groupes 1, 2, 3), inchangé.
--   - Âges 2 et 3 : leurs trois groupes partageaient le même ordre (4, puis 5),
--     donc l'app les triait par libellé (Dextérité, Équilibre, Viser). Chaque
--     groupe reçoit son propre ordre : âge 2 = 4, 5, 6 ; âge 3 = 7, 8, 9.
--   - Groupe « Composites » renommé « Notes totales » (ordre 98 inchangé).
--   - display_order renuméroté de 1 à 36 dans l'ordre affiché.
-- Ni id, ni nom de sous-test, ni échelle ne changent : les bilans existants ne
-- sont pas touchés. Données seulement, aucun changement de schéma. Idempotente.

begin;

update official_subtests s
set display_group_order = v.group_order,
    display_order = v.display_order,
    input_config = coalesce(s.input_config, '{}'::jsonb)
      || jsonb_build_object('groupOrder', v.group_order)
      || case when v.group_label is null then '{}'::jsonb else jsonb_build_object('groupHeaderLabel', v.group_label) end
from (
  values
    -- Âge 1 (3 à 6 ans)
    ('mabc-2__coin-pref', 1, 1, null),
    ('mabc-2__coin-non-pref', 1, 2, null),
    ('mabc-2__bead-threading', 1, 3, null),
    ('mabc-2__trail-band1', 1, 4, null),
    ('mabc-2__catch-bag', 2, 5, null),
    ('mabc-2__throw-bag', 2, 6, null),
    ('mabc-2__balance-one-leg-best', 3, 7, null),
    ('mabc-2__balance-one-leg-other', 3, 8, null),
    ('mabc-2__tiptoe-walk', 3, 9, null),
    ('mabc-2__mat-jump', 3, 10, null),
    -- Âge 2 (7 à 10 ans)
    ('mabc-2__pegs-preferred', 4, 11, null),
    ('mabc-2__pegs-non-preferred', 4, 12, null),
    ('mabc-2__lacing', 4, 13, null),
    ('mabc-2__trail-band2', 4, 14, null),
    ('mabc-2__catch-two-hands', 5, 15, null),
    ('mabc-2__throw-bag-mat', 5, 16, null),
    ('mabc-2__balance-board-best', 6, 17, null),
    ('mabc-2__balance-board-other', 6, 18, null),
    ('mabc-2__heel-to-toe-forward', 6, 19, null),
    ('mabc-2__hop-mat-one-leg', 6, 20, null),
    ('mabc-2__hop-mat-other-leg', 6, 21, null),
    -- Âge 3 (11 à 16 ans)
    ('mabc-2__pegs-flip', 7, 22, null),
    ('mabc-2__pegs-flip-non-pref', 7, 23, null),
    ('mabc-2__nuts-bolts', 7, 24, null),
    ('mabc-2__trail-band3', 7, 25, null),
    ('mabc-2__catch-one-hand', 8, 26, null),
    ('mabc-2__catch-one-hand-non-pref', 8, 27, null),
    ('mabc-2__throw-target', 8, 28, null),
    ('mabc-2__balance-two-boards', 9, 29, null),
    ('mabc-2__heel-to-toe-backward', 9, 30, null),
    ('mabc-2__zigzag-hop', 9, 31, null),
    ('mabc-2__zigzag-hop-other', 9, 32, null),
    -- Notes totales
    ('mabc-2__manual-dexterity-total', 98, 33, 'Notes totales'),
    ('mabc-2__aiming-catching-total', 98, 34, 'Notes totales'),
    ('mabc-2__balance-composite', 98, 35, 'Notes totales'),
    ('mabc-2__total-score', 98, 36, 'Notes totales')
) as v(id, group_order, display_order, group_label)
where s.test_id = 'mabc-2' and s.id = v.id;

commit;
