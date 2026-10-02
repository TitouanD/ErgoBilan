-- ============================================================
-- Fix subtest naming inconsistencies & add missing subtests
-- ============================================================

BEGIN;
-- ────────────────────────────────────────────────────────────
-- 1. NEPSY-2 Inhibition sub-scores: remove redundant
--    "Inhibition" prefix and standardize formatting
-- ────────────────────────────────────────────────────────────

UPDATE official_subtests
  SET name = 'Inhibition — Temps'
  WHERE id = 'nepsy-2__inhibition-temps';
UPDATE official_subtests
  SET name = 'Inhibition — Cibles'
  WHERE id = 'nepsy-2__inhibition-ca';
UPDATE official_subtests
  SET name = 'Inhibition — Erreurs'
  WHERE id = 'nepsy-2__inhibition-erreurs';
UPDATE official_subtests
  SET name = 'Inhibition — Score total'
  WHERE id = 'nepsy-2__inhibition-score';
-- ────────────────────────────────────────────────────────────
-- 2. NEPSY-2 "Discrimination Digitale" → lowercase "digitale"
--    (consistent with rest of catalog: "Attention auditive",
--     "Mémoire de figures", etc.)
-- ────────────────────────────────────────────────────────────

UPDATE official_subtests
  SET name = 'Discrimination digitale'
  WHERE id = 'nepsy-2__discrimination-digitale';
-- ────────────────────────────────────────────────────────────
-- 3. Test des Cloches: fix missing accent "reperees" → "repérées"
-- ────────────────────────────────────────────────────────────

UPDATE official_subtests
  SET name = 'Nombre de cloches repérées (/35)'
  WHERE id = 'test-cloches__cibles';
-- ────────────────────────────────────────────────────────────
-- 4. EVIC: abbreviations contain spaces and test prefix
--    "EVIC COPIE" → "COP", etc.
-- ────────────────────────────────────────────────────────────

UPDATE official_subtests SET abbreviation = 'COP'  WHERE id = 'evic__copie';
UPDATE official_subtests SET abbreviation = 'DICT' WHERE id = 'evic__dictee';
UPDATE official_subtests SET abbreviation = 'REP'  WHERE id = 'evic__repetition';
-- ────────────────────────────────────────────────────────────
-- 5. figure-rey__copie-modele: missing display order
--    (all other Figure de Rey subtests are in group 1)
-- ────────────────────────────────────────────────────────────

UPDATE official_subtests
  SET display_group_order = 1, display_order = 1
  WHERE id = 'figure-rey__copie-modele';
-- Shift existing figure-rey entries down to make room
UPDATE official_subtests
  SET display_order = display_order + 1
  WHERE test_id = 'figure-rey'
    AND id != 'figure-rey__copie-modele'
    AND organization_id IS NULL;
-- ────────────────────────────────────────────────────────────
-- 6. NEPSY-2 Inhibition: add missing conditions
--    (Dénomination and Commutation are standard NEPSY-2
--     Inhibition conditions alongside Inhibition itself)
-- ────────────────────────────────────────────────────────────

-- Place all Inhibition sub-scores in display_group 1 after
-- the main "Inhibition" entry (which is at group=1, order=5)
-- Use a dedicated sub-group (7) so they display together
-- after the main domain groups

-- First, set proper display order for existing sub-scores
UPDATE official_subtests
  SET display_group_order = 7, display_order = 3
  WHERE id = 'nepsy-2__inhibition-temps';
UPDATE official_subtests
  SET display_group_order = 7, display_order = 4
  WHERE id = 'nepsy-2__inhibition-ca';
UPDATE official_subtests
  SET display_group_order = 7, display_order = 5
  WHERE id = 'nepsy-2__inhibition-erreurs';
UPDATE official_subtests
  SET display_group_order = 7, display_order = 6
  WHERE id = 'nepsy-2__inhibition-score';
UPDATE official_subtests
  SET display_group_order = 7, display_order = 7
  WHERE id = 'nepsy-2__discrimination-digitale';
-- Add Dénomination condition sub-scores
INSERT INTO official_subtests (id, test_id, name, abbreviation, score_type, computation_mode, display_group_order, display_order, input_model)
VALUES
  ('nepsy-2__denomination-temps', 'nepsy-2', 'Dénomination — Temps', 'DNT', 'scaled', 'LOOKUP', 7, 1, 'numeric_4mode'),
  ('nepsy-2__denomination-erreurs', 'nepsy-2', 'Dénomination — Erreurs', 'DNE', 'percentile', 'LOOKUP', 7, 2, 'numeric_4mode'),
  ('nepsy-2__commutation-temps', 'nepsy-2', 'Commutation — Temps', 'CMT', 'scaled', 'LOOKUP', 7, 8, 'numeric_4mode'),
  ('nepsy-2__commutation-erreurs', 'nepsy-2', 'Commutation — Erreurs', 'CME', 'percentile', 'LOOKUP', 7, 9, 'numeric_4mode')
ON CONFLICT (id) DO NOTHING;
COMMIT;
