
-- DTVP-A cleanup: merge private import subtests into public scaffolds, fix names & score_type

-- 1. Fix scaffold score_type from 'scaled' to 'standard' (DTVP-A uses Note Standard)
UPDATE official_subtests SET score_type = 'standard'
WHERE test_id = 'dtvp-a' AND organization_id IS NULL;

-- 2. Rename scaffold subtests to match the actual manual's French names
-- "Copie de formes" → "Copie" (the manual just says "Copie")
UPDATE official_subtests SET name = 'Copie'
WHERE id = 'dtvp-a__copying';

-- "Clôture visuelle" → "Fermeture Visuelle" (the manual uses "Fermeture Visuelle")
UPDATE official_subtests SET name = 'Fermeture Visuelle'
WHERE id = 'dtvp-a__visual-closure';

-- 3. Move all norms from private duplicates to their scaffold counterparts
-- Constance de la forme
UPDATE official_norms SET subtest_id = 'dtvp-a__form-constancy'
WHERE subtest_id = 'dtvp-a_constance_de_la_forme_4359d797';

-- Copie (was "Copie de formes", now renamed to "Copie")
UPDATE official_norms SET subtest_id = 'dtvp-a__copying'
WHERE subtest_id = 'dtvp-a_copie_4359d797';

-- Fermeture Visuelle (was "Clôture visuelle", now renamed)
UPDATE official_norms SET subtest_id = 'dtvp-a__visual-closure'
WHERE subtest_id = 'dtvp-a_fermeture_visuelle_4359d797';

-- Figure-Fond
UPDATE official_norms SET subtest_id = 'dtvp-a__figure-ground'
WHERE subtest_id = 'dtvp-a_figure_fond_4359d797';

-- Recherche visuo-motrice
UPDATE official_norms SET subtest_id = 'dtvp-a__visual-motor-search'
WHERE subtest_id = 'dtvp-a_recherche_visuo_motrice_4359d797';

-- Vitesse visuo-motrice
UPDATE official_norms SET subtest_id = 'dtvp-a__visual-motor-speed'
WHERE subtest_id = 'dtvp-a_vitesse_visuo_motrice_4359d797';

-- 4. Delete the now-empty private duplicates
DELETE FROM official_subtests WHERE id IN (
    'dtvp-a_constance_de_la_forme_4359d797',
    'dtvp-a_copie_4359d797',
    'dtvp-a_fermeture_visuelle_4359d797',
    'dtvp-a_figure_fond_4359d797',
    'dtvp-a_recherche_visuo_motrice_4359d797',
    'dtvp-a_vitesse_visuo_motrice_4359d797'
);

-- 5. Add the composite score subtests as proper public scaffolds
INSERT INTO official_subtests (id, test_id, name, unit, score_type, computation_mode)
VALUES
    ('dtvp-a__sum-3', 'dtvp-a', 'Somme de 3 sous-tests', 'pts', 'standard', 'LOOKUP'),
    ('dtvp-a__sum-6', 'dtvp-a', 'Somme de 6 sous-tests', 'pts', 'standard', 'LOOKUP')
ON CONFLICT (id) DO NOTHING;

-- Move norms from private composites to public scaffolds
UPDATE official_norms SET subtest_id = 'dtvp-a__sum-3'
WHERE subtest_id = 'dtvp-a_somme_de_3_sous_tests_4359d797';

UPDATE official_norms SET subtest_id = 'dtvp-a__sum-6'
WHERE subtest_id = 'dtvp-a_somme_de_6_sous_tests_4359d797';

-- Delete private composite subtests
DELETE FROM official_subtests WHERE id IN (
    'dtvp-a_somme_de_3_sous_tests_4359d797',
    'dtvp-a_somme_de_6_sous_tests_4359d797'
);
;
