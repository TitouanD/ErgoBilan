-- ============================================================
-- NEPSY-2: align subtests with French manual (Table A.1)
--   - Fix all abbreviations to match official French edition
--   - Delete incorrect Inhibition sub-scores (temps/erreurs model)
--   - Add correct Inhibition condition scores (IND, INI, INE)
--   - Add missing Memory sub-scores (MFC, MFS, MFDC, MFDS, MP&MPD)
--   - Fix display groups and ordering to match manual layout
-- ============================================================

BEGIN;

-- ────────────────────────────────────────────────────────────
-- 1. DELETE incorrect Inhibition sub-scores
--    The manual scores 3 conditions (IND, INI, INE) as combined
--    scaled scores, NOT separate time/error breakdowns.
--    All these have 0 norms, safe to remove.
-- ────────────────────────────────────────────────────────────

DELETE FROM official_subtests WHERE id IN (
  'nepsy-2__inhibition-temps',
  'nepsy-2__inhibition-ca',
  'nepsy-2__inhibition-erreurs',
  'nepsy-2__inhibition-score',
  'nepsy-2__denomination-temps',
  'nepsy-2__denomination-erreurs',
  'nepsy-2__commutation-temps',
  'nepsy-2__commutation-erreurs'
);

-- ────────────────────────────────────────────────────────────
-- 2. ADD correct Inhibition condition scaled scores (Table A.1)
-- ────────────────────────────────────────────────────────────

INSERT INTO official_subtests (id, test_id, name, abbreviation, score_type, computation_mode, display_group_order, display_order, input_model)
VALUES
  ('nepsy-2__inhibition-denomination', 'nepsy-2', 'Inhibition — Dénomination', 'IND', 'scaled', 'LOOKUP', 1, 7, 'numeric_4mode'),
  ('nepsy-2__inhibition-inhibition',   'nepsy-2', 'Inhibition — Inhibition',   'INI', 'scaled', 'LOOKUP', 1, 8, 'numeric_4mode'),
  ('nepsy-2__inhibition-commutation',  'nepsy-2', 'Inhibition — Commutation',  'INE', 'scaled', 'LOOKUP', 1, 9, 'numeric_4mode')
ON CONFLICT (id) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- 3. ADD missing Memory sub-scores (Table A.1)
-- ────────────────────────────────────────────────────────────

INSERT INTO official_subtests (id, test_id, name, abbreviation, score_type, computation_mode, display_group_order, display_order, input_model)
VALUES
  ('nepsy-2__memory-for-designs-content',         'nepsy-2', 'Mémoire de figures — Contenu',          'MFC',   'scaled', 'LOOKUP', 3, 1,  'numeric_4mode'),
  ('nepsy-2__memory-for-designs-spatial',          'nepsy-2', 'Mémoire de figures — Spatial',          'MFS',   'scaled', 'LOOKUP', 3, 2,  'numeric_4mode'),
  ('nepsy-2__memory-for-designs-delayed-content',  'nepsy-2', 'Mémoire de figures différée — Contenu', 'MFDC',  'scaled', 'LOOKUP', 3, 5,  'numeric_4mode'),
  ('nepsy-2__memory-for-designs-delayed-spatial',  'nepsy-2', 'Mémoire de figures différée — Spatial', 'MFDS',  'scaled', 'LOOKUP', 3, 6,  'numeric_4mode'),
  ('nepsy-2__memory-for-names-combined',           'nepsy-2', 'Mémoire des prénoms — Total combiné',  'MPMPD', 'scaled', 'LOOKUP', 3, 13, 'numeric_4mode')
ON CONFLICT (id) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- 4. RENAME existing Memory totals to clarify they are totals
-- ────────────────────────────────────────────────────────────

UPDATE official_subtests
  SET name = 'Mémoire de figures — Score total', display_order = 3
  WHERE id = 'nepsy-2__memory-for-designs';

UPDATE official_subtests
  SET name = 'Mémoire de figures différée — Score total', display_order = 7
  WHERE id = 'nepsy-2__memory-for-designs-delayed';

-- ────────────────────────────────────────────────────────────
-- 5. REORDER Memory group (3) to match manual table layout
--    MFC(1) MFS(2) MFT(3) — MFDC(5) MFDS(6) MFDT(7) —
--    MV(8) MVD(9) — MP(10) MPD(11) — MPMPD(13) —
--    L(14) LI(15) — MN(16) — SR(17) LMD(18)
-- ────────────────────────────────────────────────────────────

UPDATE official_subtests SET display_order = 8  WHERE id = 'nepsy-2__memory-for-faces';
UPDATE official_subtests SET display_order = 9  WHERE id = 'nepsy-2__memory-for-faces-delayed';
UPDATE official_subtests SET display_order = 10 WHERE id = 'nepsy-2__memory-for-names';
UPDATE official_subtests SET display_order = 11 WHERE id = 'nepsy-2__memory-for-names-delayed';
-- memory-for-names-combined inserted at 13 above
UPDATE official_subtests SET display_order = 14 WHERE id = 'nepsy-2__list-memory';
UPDATE official_subtests SET display_order = 15 WHERE id = 'nepsy-2__word-list-interference';
UPDATE official_subtests SET display_order = 16 WHERE id = 'nepsy-2__narrative-memory';
UPDATE official_subtests SET display_order = 17 WHERE id = 'nepsy-2__sentence-repetition';
UPDATE official_subtests SET display_order = 18 WHERE id = 'nepsy-2__list-memory-delayed';

-- ────────────────────────────────────────────────────────────
-- 6. MOVE Horloges from group 1 (AFE) to group 6 (Visuospatial)
--    In the manual, Horloges (CFPT) is under Traitements visuospatiaux
-- ────────────────────────────────────────────────────────────

UPDATE official_subtests
  SET display_group_order = 6, display_order = 7
  WHERE id = 'nepsy-2__clocks';

-- ────────────────────────────────────────────────────────────
-- 7. FIX Discrimination digitale: place in Sensorimoteur (group 4)
-- ────────────────────────────────────────────────────────────

UPDATE official_subtests
  SET display_group_order = 4, display_order = 5
  WHERE id = 'nepsy-2__discrimination-digitale';

-- ────────────────────────────────────────────────────────────
-- 8. UPDATE ALL ABBREVIATIONS to match French NEPSY-2 manual
-- ────────────────────────────────────────────────────────────

-- Attention et fonctions exécutives (group 1)
UPDATE official_subtests SET abbreviation = 'AA'   WHERE id = 'nepsy-2__auditory-attention-response-set';
UPDATE official_subtests SET abbreviation = 'FD'   WHERE id = 'nepsy-2__design-fluency';

-- Langage (group 2)
UPDATE official_subtests SET abbreviation = 'CC'   WHERE id = 'nepsy-2__comprehension-of-instructions';
UPDATE official_subtests SET abbreviation = 'PP'   WHERE id = 'nepsy-2__phonological-processing';
UPDATE official_subtests SET abbreviation = 'PS'   WHERE id = 'nepsy-2__word-generation';
UPDATE official_subtests SET abbreviation = 'DR'   WHERE id = 'nepsy-2__speeded-naming';
UPDATE official_subtests SET abbreviation = 'PMS'  WHERE id = 'nepsy-2__body-part-naming-identification';

-- Mémoire et apprentissage (group 3)
UPDATE official_subtests SET abbreviation = 'MFT'  WHERE id = 'nepsy-2__memory-for-designs';
UPDATE official_subtests SET abbreviation = 'MFDT' WHERE id = 'nepsy-2__memory-for-designs-delayed';
UPDATE official_subtests SET abbreviation = 'MV'   WHERE id = 'nepsy-2__memory-for-faces';
UPDATE official_subtests SET abbreviation = 'MVD'  WHERE id = 'nepsy-2__memory-for-faces-delayed';
UPDATE official_subtests SET abbreviation = 'MP'   WHERE id = 'nepsy-2__memory-for-names';
UPDATE official_subtests SET abbreviation = 'MPD'  WHERE id = 'nepsy-2__memory-for-names-delayed';
UPDATE official_subtests SET abbreviation = 'L'    WHERE id = 'nepsy-2__list-memory';
UPDATE official_subtests SET abbreviation = 'LI'   WHERE id = 'nepsy-2__word-list-interference';
UPDATE official_subtests SET abbreviation = 'MN'   WHERE id = 'nepsy-2__narrative-memory';

-- Fonctions sensorimotrices (group 4)
UPDATE official_subtests SET abbreviation = 'IP'   WHERE id = 'nepsy-2__imitating-hand-positions';
UPDATE official_subtests SET abbreviation = 'PV'   WHERE id = 'nepsy-2__visuomotor-precision';

-- Perception sociale (group 5)
UPDATE official_subtests SET abbreviation = 'AF'   WHERE id = 'nepsy-2__affect-recognition';
UPDATE official_subtests SET abbreviation = 'ES'   WHERE id = 'nepsy-2__theory-of-mind';

-- Traitements visuospatiaux (group 6)
UPDATE official_subtests SET abbreviation = 'RP'   WHERE id = 'nepsy-2__picture-puzzles';
UPDATE official_subtests SET abbreviation = 'FL'   WHERE id = 'nepsy-2__design-copying';
UPDATE official_subtests SET abbreviation = 'CB'   WHERE id = 'nepsy-2__block-construction';
UPDATE official_subtests SET abbreviation = 'CFPM' WHERE id = 'nepsy-2__geometric-puzzles';
UPDATE official_subtests SET abbreviation = 'CFPG' WHERE id = 'nepsy-2__arrows';
UPDATE official_subtests SET abbreviation = 'CFPL' WHERE id = 'nepsy-2__route-finding';
UPDATE official_subtests SET abbreviation = 'CFPT' WHERE id = 'nepsy-2__clocks';

COMMIT;
