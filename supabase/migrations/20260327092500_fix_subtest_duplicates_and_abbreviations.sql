-- ============================================================
-- Fix subtest duplicates and abbreviation collisions
-- ============================================================

BEGIN;

-- ────────────────────────────────────────────────────────────
-- 1. DELETE true duplicates (orphaned entries with no norms,
--    no display order, no config — proper equivalent exists)
-- ────────────────────────────────────────────────────────────

-- NEPSY-2 duplicates (keep the properly configured entry)
DELETE FROM official_subtests WHERE id = 'nepsy-2__cubes';              -- dupe of nepsy-2__block-construction (Cubes / BC)
DELETE FROM official_subtests WHERE id = 'nepsy-2__denom-parties-corps'; -- dupe of nepsy-2__body-part-naming-identification
DELETE FROM official_subtests WHERE id = 'nepsy-2__fleches';            -- dupe of nepsy-2__arrows (Flèches / AW)
DELETE FROM official_subtests WHERE id = 'nepsy-2__repetition-pseudo-mots'; -- dupe of nepsy-2__repetition-of-nonsense-words
DELETE FROM official_subtests WHERE id = 'nepsy-2__sequences-oro-motrices'; -- dupe of nepsy-2__oromotor-sequences
DELETE FROM official_subtests WHERE id = 'nepsy-2__frappe-bout-doigts';    -- dupe of nepsy-2__fingertip-tapping

-- PEDI-CAT duplicates (old naming convention pedicat-* → keep pedi-cat__*)
DELETE FROM official_subtests WHERE id = 'pedicat-daily-activities';   -- dupe of pedi-cat__daily-activities
DELETE FROM official_subtests WHERE id = 'pedicat-mobility';           -- dupe of pedi-cat__mobility
DELETE FROM official_subtests WHERE id = 'pedicat-responsibility';     -- dupe of pedi-cat__responsibility
DELETE FROM official_subtests WHERE id = 'pedicat-social-cognitive';   -- dupe of pedi-cat__social-cognitive


-- ────────────────────────────────────────────────────────────
-- 2. FIX abbreviation collisions
--    (multiple subtests in same test sharing same abbreviation)
-- ────────────────────────────────────────────────────────────

-- Alouette: 3 subtests all had "INDICEDE"
UPDATE official_subtests SET abbreviation = 'IP'  WHERE id = 'alouette__indice-de-pr-cision';
UPDATE official_subtests SET abbreviation = 'IV'  WHERE id = 'alouette__indice-de-vitesse';
UPDATE official_subtests SET abbreviation = 'IE'  WHERE id = 'alouette__indice-d-efficience-ctl';

-- DTVP-A: 2 subtests both "VISUALMO"
UPDATE official_subtests SET abbreviation = 'VMS'  WHERE id = 'dtvp-a__visual-motor-search';
UPDATE official_subtests SET abbreviation = 'VMSPD' WHERE id = 'dtvp-a__visual-motor-speed';

-- LOTCA: 2 subtests both "PERCEPTI"
UPDATE official_subtests SET abbreviation = 'PV' WHERE id = 'lotca__perception-visuelle';
UPDATE official_subtests SET abbreviation = 'PS' WHERE id = 'lotca__perception-spatiale';

-- MABC-2: several abbreviation collisions
UPDATE official_subtests SET abbreviation = 'BBB'  WHERE id = 'mabc-2__balance-board-best';
UPDATE official_subtests SET abbreviation = 'BBO'  WHERE id = 'mabc-2__balance-board-other';
UPDATE official_subtests SET abbreviation = 'BOB'  WHERE id = 'mabc-2__balance-one-leg-best';
UPDATE official_subtests SET abbreviation = 'BOO'  WHERE id = 'mabc-2__balance-one-leg-other';
UPDATE official_subtests SET abbreviation = 'COP'  WHERE id = 'mabc-2__catch-one-hand';
UPDATE official_subtests SET abbreviation = 'CONP' WHERE id = 'mabc-2__catch-one-hand-non-pref';
UPDATE official_subtests SET abbreviation = 'HTTF' WHERE id = 'mabc-2__heel-to-toe-forward';
UPDATE official_subtests SET abbreviation = 'HTTB' WHERE id = 'mabc-2__heel-to-toe-backward';
UPDATE official_subtests SET abbreviation = 'PFP'  WHERE id = 'mabc-2__pegs-flip';
UPDATE official_subtests SET abbreviation = 'PFNP' WHERE id = 'mabc-2__pegs-flip-non-pref';
UPDATE official_subtests SET abbreviation = 'TB1'  WHERE id = 'mabc-2__trail-band1';
UPDATE official_subtests SET abbreviation = 'TB2'  WHERE id = 'mabc-2__trail-band2';
UPDATE official_subtests SET abbreviation = 'TB3'  WHERE id = 'mabc-2__trail-band3';

-- MMSE: 2 orientations both "ORIENTAT"
UPDATE official_subtests SET abbreviation = 'ORS' WHERE id = 'mmse__orientation-space';
UPDATE official_subtests SET abbreviation = 'ORT' WHERE id = 'mmse__orientation-time';

-- WISC-V: 2 mémoires both "MMOIREDE"
UPDATE official_subtests SET abbreviation = 'MCH' WHERE id = 'wisc-v__m-moire-des-chiffres';
UPDATE official_subtests SET abbreviation = 'MIM' WHERE id = 'wisc-v__m-moire-des-images';


-- ────────────────────────────────────────────────────────────
-- 3. FIX string "NULL" abbreviation (not actual SQL NULL)
-- ────────────────────────────────────────────────────────────

UPDATE official_subtests SET abbreviation = 'CDM' WHERE id = 'figure-rey__copie-modele';


-- ────────────────────────────────────────────────────────────
-- 4. FIX remaining NULL abbreviations on legitimate NEPSY-2
--    sub-scores (Inhibition component scores, etc.)
-- ────────────────────────────────────────────────────────────

UPDATE official_subtests SET abbreviation = 'DD'   WHERE id = 'nepsy-2__discrimination-digitale';
UPDATE official_subtests SET abbreviation = 'INT'  WHERE id = 'nepsy-2__inhibition-temps';
UPDATE official_subtests SET abbreviation = 'INCA' WHERE id = 'nepsy-2__inhibition-ca';
UPDATE official_subtests SET abbreviation = 'INE'  WHERE id = 'nepsy-2__inhibition-erreurs';
UPDATE official_subtests SET abbreviation = 'INST' WHERE id = 'nepsy-2__inhibition-score';

COMMIT;
