-- =============================================================================
-- Migration : MABC-2 remaining requested subtests (tester feedback)
-- Date : 2026-03-18
-- =============================================================================

INSERT INTO public.official_subtests (id, test_id, name, score_type, computation_mode, input_model, raw_direction, input_config, organization_id)
VALUES
  ('mabc-2__catch-one-hand-non-pref', 'mabc-2', 'Attraper à une main main non préférée', 'scaled', 'LOOKUP', 'numeric_4mode', 'higher_better',
   jsonb_build_object('groupKey', 'mabc2_03_age3_viser_attraper', 'groupHeaderLabel', 'Groupe d''âge 3 (11 à 16 ans) — Viser et attraper', 'groupOrder', 5, 'orderIndex', 2), NULL),
  ('mabc-2__balance-board-best', 'mabc-2', 'Équilibre sur une planche jambe meilleure jambe', 'scaled', 'LOOKUP', 'numeric_4mode', 'higher_better',
   jsonb_build_object('groupKey', 'mabc2_02_age2_equilibre', 'groupHeaderLabel', 'Groupe d''âge 2 (7 à 10 ans) — Équilibre', 'groupOrder', 4, 'orderIndex', 1), NULL),
  ('mabc-2__balance-board-other', 'mabc-2', 'Équilibre sur une planche jambe autre jambe', 'scaled', 'LOOKUP', 'numeric_4mode', 'higher_better',
   jsonb_build_object('groupKey', 'mabc2_02_age2_equilibre', 'groupHeaderLabel', 'Groupe d''âge 2 (7 à 10 ans) — Équilibre', 'groupOrder', 4, 'orderIndex', 2), NULL),
  ('mabc-2__heel-to-toe-forward', 'mabc-2', 'Marcher talon pointe en avant', 'scaled', 'LOOKUP', 'numeric_4mode', 'higher_better',
   jsonb_build_object('groupKey', 'mabc2_02_age2_equilibre', 'groupHeaderLabel', 'Groupe d''âge 2 (7 à 10 ans) — Équilibre', 'groupOrder', 4, 'orderIndex', 3), NULL),
  ('mabc-2__hop-mat-one-leg', 'mabc-2', 'Sauter à cloche pied sur tapis', 'scaled', 'LOOKUP', 'numeric_4mode', 'higher_better',
   jsonb_build_object('groupKey', 'mabc2_02_age2_equilibre', 'groupHeaderLabel', 'Groupe d''âge 2 (7 à 10 ans) — Équilibre', 'groupOrder', 4, 'orderIndex', 4), NULL),
  ('mabc-2__heel-to-toe-backward', 'mabc-2', 'Marcher talon pointe à reculons', 'scaled', 'LOOKUP', 'numeric_4mode', 'higher_better',
   jsonb_build_object('groupKey', 'mabc2_03_age3_equilibre', 'groupHeaderLabel', 'Groupe d''âge 3 (11 à 16 ans) — Équilibre', 'groupOrder', 5, 'orderIndex', 3), NULL),
  ('mabc-2__zigzag-hop', 'mabc-2', 'Sauter en zig-zag', 'scaled', 'LOOKUP', 'numeric_4mode', 'higher_better',
   jsonb_build_object('groupKey', 'mabc2_03_age3_equilibre', 'groupHeaderLabel', 'Groupe d''âge 3 (11 à 16 ans) — Équilibre', 'groupOrder', 5, 'orderIndex', 4), NULL)
ON CONFLICT (id) DO NOTHING;
