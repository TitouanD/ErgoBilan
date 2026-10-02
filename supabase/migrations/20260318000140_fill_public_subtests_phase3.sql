-- Phase 3: Compléter les tests encore vides avec des sous-tests publics à forte certitude.
-- Principe: insertion prudente, sans normes propriétaires (score_type=none, computation_mode=NONE).

with candidates(test_id, name, score_type, computation_mode, input_model, raw_direction, input_config) as (
  values
    -- AMPS
    ('amps', 'ADL Motor', 'none', 'NONE', 'numeric_4mode', 'higher_better', '{"groupKey":"amps_scores","groupOrder":1,"orderIndex":1,"groupHeaderLabel":"Scores AMPS"}'::jsonb),
    ('amps', 'ADL Process', 'none', 'NONE', 'numeric_4mode', 'higher_better', '{"groupKey":"amps_scores","groupOrder":1,"orderIndex":2,"groupHeaderLabel":"Scores AMPS"}'::jsonb),

    -- DTVP-3
    ('dtvp-3', 'Eye-Hand Coordination', 'none', 'NONE', 'numeric_4mode', 'higher_better', '{"groupKey":"dtvp3","groupOrder":1,"orderIndex":1,"groupHeaderLabel":"Sous-tests"}'::jsonb),
    ('dtvp-3', 'Copying', 'none', 'NONE', 'numeric_4mode', 'higher_better', '{"groupKey":"dtvp3","groupOrder":1,"orderIndex":2,"groupHeaderLabel":"Sous-tests"}'::jsonb),
    ('dtvp-3', 'Figure-Ground', 'none', 'NONE', 'numeric_4mode', 'higher_better', '{"groupKey":"dtvp3","groupOrder":1,"orderIndex":3,"groupHeaderLabel":"Sous-tests"}'::jsonb),
    ('dtvp-3', 'Visual Closure', 'none', 'NONE', 'numeric_4mode', 'higher_better', '{"groupKey":"dtvp3","groupOrder":1,"orderIndex":4,"groupHeaderLabel":"Sous-tests"}'::jsonb),
    ('dtvp-3', 'Form Constancy', 'none', 'NONE', 'numeric_4mode', 'higher_better', '{"groupKey":"dtvp3","groupOrder":1,"orderIndex":5,"groupHeaderLabel":"Sous-tests"}'::jsonb),

    -- Charlop-Atwell (structure publique rapportée: score objectif + subjectif)
    ('charlop-atwell', 'Score objectif', 'none', 'NONE', 'numeric_4mode', 'higher_better', '{"groupKey":"charlop","groupOrder":1,"orderIndex":1,"groupHeaderLabel":"Scores"}'::jsonb),
    ('charlop-atwell', 'Score subjectif', 'none', 'NONE', 'numeric_4mode', 'higher_better', '{"groupKey":"charlop","groupOrder":1,"orderIndex":2,"groupHeaderLabel":"Scores"}'::jsonb),

    -- Frostig / DTVP historique
    ('frostig', 'Coordination oculo-motrice', 'none', 'NONE', 'numeric_4mode', 'higher_better', '{"groupKey":"frostig","groupOrder":1,"orderIndex":1,"groupHeaderLabel":"Sous-tests"}'::jsonb),
    ('frostig', 'Figure-fond', 'none', 'NONE', 'numeric_4mode', 'higher_better', '{"groupKey":"frostig","groupOrder":1,"orderIndex":2,"groupHeaderLabel":"Sous-tests"}'::jsonb),
    ('frostig', 'Constance de forme', 'none', 'NONE', 'numeric_4mode', 'higher_better', '{"groupKey":"frostig","groupOrder":1,"orderIndex":3,"groupHeaderLabel":"Sous-tests"}'::jsonb),
    ('frostig', 'Position dans l’espace', 'none', 'NONE', 'numeric_4mode', 'higher_better', '{"groupKey":"frostig","groupOrder":1,"orderIndex":4,"groupHeaderLabel":"Sous-tests"}'::jsonb),
    ('frostig', 'Relations spatiales', 'none', 'NONE', 'numeric_4mode', 'higher_better', '{"groupKey":"frostig","groupOrder":1,"orderIndex":5,"groupHeaderLabel":"Sous-tests"}'::jsonb),

    -- LOTCA
    ('lotca', 'Orientation', 'none', 'NONE', 'numeric_4mode', 'higher_better', '{"groupKey":"lotca_domains","groupOrder":1,"orderIndex":1,"groupHeaderLabel":"Domaines"}'::jsonb),
    ('lotca', 'Perception visuelle', 'none', 'NONE', 'numeric_4mode', 'higher_better', '{"groupKey":"lotca_domains","groupOrder":1,"orderIndex":2,"groupHeaderLabel":"Domaines"}'::jsonb),
    ('lotca', 'Perception spatiale', 'none', 'NONE', 'numeric_4mode', 'higher_better', '{"groupKey":"lotca_domains","groupOrder":1,"orderIndex":3,"groupHeaderLabel":"Domaines"}'::jsonb),
    ('lotca', 'Praxies motrices', 'none', 'NONE', 'numeric_4mode', 'higher_better', '{"groupKey":"lotca_domains","groupOrder":1,"orderIndex":4,"groupHeaderLabel":"Domaines"}'::jsonb),
    ('lotca', 'Organisation visuo-motrice', 'none', 'NONE', 'numeric_4mode', 'higher_better', '{"groupKey":"lotca_domains","groupOrder":1,"orderIndex":5,"groupHeaderLabel":"Domaines"}'::jsonb),
    ('lotca', 'Opérations cognitives', 'none', 'NONE', 'numeric_4mode', 'higher_better', '{"groupKey":"lotca_domains","groupOrder":1,"orderIndex":6,"groupHeaderLabel":"Domaines"}'::jsonb),

    -- MVPT-4
    ('mvpt-4', 'Score total', 'none', 'NONE', 'numeric_4mode', 'higher_better', '{"groupKey":"mvpt4","groupOrder":1,"orderIndex":1,"groupHeaderLabel":"Scores"}'::jsonb),
    ('mvpt-4', 'Discrimination visuelle', 'none', 'NONE', 'numeric_4mode', 'higher_better', '{"groupKey":"mvpt4","groupOrder":1,"orderIndex":2,"groupHeaderLabel":"Scores"}'::jsonb),
    ('mvpt-4', 'Figure-fond', 'none', 'NONE', 'numeric_4mode', 'higher_better', '{"groupKey":"mvpt4","groupOrder":1,"orderIndex":3,"groupHeaderLabel":"Scores"}'::jsonb),
    ('mvpt-4', 'Mémoire visuelle', 'none', 'NONE', 'numeric_4mode', 'higher_better', '{"groupKey":"mvpt4","groupOrder":1,"orderIndex":4,"groupHeaderLabel":"Scores"}'::jsonb),
    ('mvpt-4', 'Closure visuelle', 'none', 'NONE', 'numeric_4mode', 'higher_better', '{"groupKey":"mvpt4","groupOrder":1,"orderIndex":5,"groupHeaderLabel":"Scores"}'::jsonb),
    ('mvpt-4', 'Relations spatiales', 'none', 'NONE', 'numeric_4mode', 'higher_better', '{"groupKey":"mvpt4","groupOrder":1,"orderIndex":6,"groupHeaderLabel":"Scores"}'::jsonb),

    -- NEPSY (édition antérieure, domaines)
    ('nepsy', 'Attention / Fonctions exécutives', 'none', 'NONE', 'numeric_4mode', 'higher_better', '{"groupKey":"nepsy_domains","groupOrder":1,"orderIndex":1,"groupHeaderLabel":"Domaines"}'::jsonb),
    ('nepsy', 'Langage', 'none', 'NONE', 'numeric_4mode', 'higher_better', '{"groupKey":"nepsy_domains","groupOrder":1,"orderIndex":2,"groupHeaderLabel":"Domaines"}'::jsonb),
    ('nepsy', 'Mémoire et apprentissage', 'none', 'NONE', 'numeric_4mode', 'higher_better', '{"groupKey":"nepsy_domains","groupOrder":1,"orderIndex":3,"groupHeaderLabel":"Domaines"}'::jsonb),
    ('nepsy', 'Sensorimoteur', 'none', 'NONE', 'numeric_4mode', 'higher_better', '{"groupKey":"nepsy_domains","groupOrder":1,"orderIndex":4,"groupHeaderLabel":"Domaines"}'::jsonb),
    ('nepsy', 'Traitement visuo-spatial', 'none', 'NONE', 'numeric_4mode', 'higher_better', '{"groupKey":"nepsy_domains","groupOrder":1,"orderIndex":5,"groupHeaderLabel":"Domaines"}'::jsonb),

    -- NP-MOT
    ('np-mot', 'Tonus', 'none', 'NONE', 'numeric_4mode', 'higher_better', '{"groupKey":"npmot_functions","groupOrder":1,"orderIndex":1,"groupHeaderLabel":"Fonctions"}'::jsonb),
    ('np-mot', 'Motricité globale', 'none', 'NONE', 'numeric_4mode', 'higher_better', '{"groupKey":"npmot_functions","groupOrder":1,"orderIndex":2,"groupHeaderLabel":"Fonctions"}'::jsonb),
    ('np-mot', 'Latéralité', 'none', 'NONE', 'numeric_4mode', 'higher_better', '{"groupKey":"npmot_functions","groupOrder":1,"orderIndex":3,"groupHeaderLabel":"Fonctions"}'::jsonb),
    ('np-mot', 'Praxies', 'none', 'NONE', 'numeric_4mode', 'higher_better', '{"groupKey":"npmot_functions","groupOrder":1,"orderIndex":4,"groupHeaderLabel":"Fonctions"}'::jsonb),
    ('np-mot', 'Gnosies tactiles', 'none', 'NONE', 'numeric_4mode', 'higher_better', '{"groupKey":"npmot_functions","groupOrder":1,"orderIndex":5,"groupHeaderLabel":"Fonctions"}'::jsonb),
    ('np-mot', 'Habileté oculo-manuelle', 'none', 'NONE', 'numeric_4mode', 'higher_better', '{"groupKey":"npmot_functions","groupOrder":1,"orderIndex":6,"groupHeaderLabel":"Fonctions"}'::jsonb),
    ('np-mot', 'Orientation spatiale', 'none', 'NONE', 'numeric_4mode', 'higher_better', '{"groupKey":"npmot_functions","groupOrder":1,"orderIndex":7,"groupHeaderLabel":"Fonctions"}'::jsonb),
    ('np-mot', 'Rythme', 'none', 'NONE', 'numeric_4mode', 'higher_better', '{"groupKey":"npmot_functions","groupOrder":1,"orderIndex":8,"groupHeaderLabel":"Fonctions"}'::jsonb),
    ('np-mot', 'Attention auditive', 'none', 'NONE', 'numeric_4mode', 'higher_better', '{"groupKey":"npmot_functions","groupOrder":1,"orderIndex":9,"groupHeaderLabel":"Fonctions"}'::jsonb),

    -- PDMS-2
    ('pdms-2', 'Reflexes', 'none', 'NONE', 'numeric_4mode', 'higher_better', '{"groupKey":"pdms2","groupOrder":1,"orderIndex":1,"groupHeaderLabel":"Sous-tests"}'::jsonb),
    ('pdms-2', 'Stationary', 'none', 'NONE', 'numeric_4mode', 'higher_better', '{"groupKey":"pdms2","groupOrder":1,"orderIndex":2,"groupHeaderLabel":"Sous-tests"}'::jsonb),
    ('pdms-2', 'Locomotion', 'none', 'NONE', 'numeric_4mode', 'higher_better', '{"groupKey":"pdms2","groupOrder":1,"orderIndex":3,"groupHeaderLabel":"Sous-tests"}'::jsonb),
    ('pdms-2', 'Object Manipulation', 'none', 'NONE', 'numeric_4mode', 'higher_better', '{"groupKey":"pdms2","groupOrder":1,"orderIndex":4,"groupHeaderLabel":"Sous-tests"}'::jsonb),
    ('pdms-2', 'Grasping', 'none', 'NONE', 'numeric_4mode', 'higher_better', '{"groupKey":"pdms2","groupOrder":1,"orderIndex":5,"groupHeaderLabel":"Sous-tests"}'::jsonb),
    ('pdms-2', 'Visual-Motor Integration', 'none', 'NONE', 'numeric_4mode', 'higher_better', '{"groupKey":"pdms2","groupOrder":1,"orderIndex":6,"groupHeaderLabel":"Sous-tests"}'::jsonb),

    -- PEDI-CAT
    ('pedi-cat', 'Daily Activities', 'none', 'NONE', 'numeric_4mode', 'higher_better', '{"groupKey":"pedicat_domains","groupOrder":1,"orderIndex":1,"groupHeaderLabel":"Domaines"}'::jsonb),
    ('pedi-cat', 'Mobility', 'none', 'NONE', 'numeric_4mode', 'higher_better', '{"groupKey":"pedicat_domains","groupOrder":1,"orderIndex":2,"groupHeaderLabel":"Domaines"}'::jsonb),
    ('pedi-cat', 'Social/Cognitive', 'none', 'NONE', 'numeric_4mode', 'higher_better', '{"groupKey":"pedicat_domains","groupOrder":1,"orderIndex":3,"groupHeaderLabel":"Domaines"}'::jsonb),
    ('pedi-cat', 'Responsibility', 'none', 'NONE', 'numeric_4mode', 'higher_better', '{"groupKey":"pedicat_domains","groupOrder":1,"orderIndex":4,"groupHeaderLabel":"Domaines"}'::jsonb),

    -- Profil Sensoriel 2 (Dunn)
    ('profil-sensoriel-2', 'Seeking', 'none', 'NONE', 'numeric_4mode', 'higher_better', '{"groupKey":"sp2_quadrants","groupOrder":1,"orderIndex":1,"groupHeaderLabel":"Quadrants"}'::jsonb),
    ('profil-sensoriel-2', 'Avoiding', 'none', 'NONE', 'numeric_4mode', 'higher_better', '{"groupKey":"sp2_quadrants","groupOrder":1,"orderIndex":2,"groupHeaderLabel":"Quadrants"}'::jsonb),
    ('profil-sensoriel-2', 'Sensitivity', 'none', 'NONE', 'numeric_4mode', 'higher_better', '{"groupKey":"sp2_quadrants","groupOrder":1,"orderIndex":3,"groupHeaderLabel":"Quadrants"}'::jsonb),
    ('profil-sensoriel-2', 'Registration', 'none', 'NONE', 'numeric_4mode', 'higher_better', '{"groupKey":"sp2_quadrants","groupOrder":1,"orderIndex":4,"groupHeaderLabel":"Quadrants"}'::jsonb),
    ('profil-sensoriel-2', 'Auditory', 'none', 'NONE', 'numeric_4mode', 'higher_better', '{"groupKey":"sp2_sections","groupOrder":2,"orderIndex":1,"groupHeaderLabel":"Sections sensorielles"}'::jsonb),
    ('profil-sensoriel-2', 'Visual', 'none', 'NONE', 'numeric_4mode', 'higher_better', '{"groupKey":"sp2_sections","groupOrder":2,"orderIndex":2,"groupHeaderLabel":"Sections sensorielles"}'::jsonb),
    ('profil-sensoriel-2', 'Touch', 'none', 'NONE', 'numeric_4mode', 'higher_better', '{"groupKey":"sp2_sections","groupOrder":2,"orderIndex":3,"groupHeaderLabel":"Sections sensorielles"}'::jsonb),
    ('profil-sensoriel-2', 'Movement', 'none', 'NONE', 'numeric_4mode', 'higher_better', '{"groupKey":"sp2_sections","groupOrder":2,"orderIndex":4,"groupHeaderLabel":"Sections sensorielles"}'::jsonb),
    ('profil-sensoriel-2', 'Body Position', 'none', 'NONE', 'numeric_4mode', 'higher_better', '{"groupKey":"sp2_sections","groupOrder":2,"orderIndex":5,"groupHeaderLabel":"Sections sensorielles"}'::jsonb),
    ('profil-sensoriel-2', 'Oral', 'none', 'NONE', 'numeric_4mode', 'higher_better', '{"groupKey":"sp2_sections","groupOrder":2,"orderIndex":6,"groupHeaderLabel":"Sections sensorielles"}'::jsonb),

    -- Reversal Test
    ('reversal', 'Nombre d’inversions', 'none', 'NONE', 'numeric_4mode', 'lower_better', '{"groupKey":"reversal_scores","groupOrder":1,"orderIndex":1,"groupHeaderLabel":"Scores"}'::jsonb),
    ('reversal', 'Nombre de réponses correctes', 'none', 'NONE', 'numeric_4mode', 'higher_better', '{"groupKey":"reversal_scores","groupOrder":1,"orderIndex":2,"groupHeaderLabel":"Scores"}'::jsonb),

    -- SPM
    ('spm', 'Social Participation', 'none', 'NONE', 'numeric_4mode', 'auto', '{"groupKey":"spm_scales","groupOrder":1,"orderIndex":1,"groupHeaderLabel":"Échelles"}'::jsonb),
    ('spm', 'Vision', 'none', 'NONE', 'numeric_4mode', 'auto', '{"groupKey":"spm_scales","groupOrder":1,"orderIndex":2,"groupHeaderLabel":"Échelles"}'::jsonb),
    ('spm', 'Hearing', 'none', 'NONE', 'numeric_4mode', 'auto', '{"groupKey":"spm_scales","groupOrder":1,"orderIndex":3,"groupHeaderLabel":"Échelles"}'::jsonb),
    ('spm', 'Touch', 'none', 'NONE', 'numeric_4mode', 'auto', '{"groupKey":"spm_scales","groupOrder":1,"orderIndex":4,"groupHeaderLabel":"Échelles"}'::jsonb),
    ('spm', 'Body Awareness', 'none', 'NONE', 'numeric_4mode', 'auto', '{"groupKey":"spm_scales","groupOrder":1,"orderIndex":5,"groupHeaderLabel":"Échelles"}'::jsonb),
    ('spm', 'Balance and Motion', 'none', 'NONE', 'numeric_4mode', 'auto', '{"groupKey":"spm_scales","groupOrder":1,"orderIndex":6,"groupHeaderLabel":"Échelles"}'::jsonb),
    ('spm', 'Planning and Ideas', 'none', 'NONE', 'numeric_4mode', 'auto', '{"groupKey":"spm_scales","groupOrder":1,"orderIndex":7,"groupHeaderLabel":"Échelles"}'::jsonb),
    ('spm', 'Total Sensory Systems', 'none', 'NONE', 'numeric_4mode', 'auto', '{"groupKey":"spm_scales","groupOrder":1,"orderIndex":8,"groupHeaderLabel":"Échelles"}'::jsonb),

    -- TEA-Ch
    ('tea-ch', 'Sky Search', 'none', 'NONE', 'numeric_4mode', 'higher_better', '{"groupKey":"teach_subtests","groupOrder":1,"orderIndex":1,"groupHeaderLabel":"Sous-tests"}'::jsonb),
    ('tea-ch', 'Score!', 'none', 'NONE', 'numeric_4mode', 'higher_better', '{"groupKey":"teach_subtests","groupOrder":1,"orderIndex":2,"groupHeaderLabel":"Sous-tests"}'::jsonb),
    ('tea-ch', 'Score! Dual Task', 'none', 'NONE', 'numeric_4mode', 'higher_better', '{"groupKey":"teach_subtests","groupOrder":1,"orderIndex":3,"groupHeaderLabel":"Sous-tests"}'::jsonb),
    ('tea-ch', 'Walk Don’t Walk', 'none', 'NONE', 'numeric_4mode', 'higher_better', '{"groupKey":"teach_subtests","groupOrder":1,"orderIndex":4,"groupHeaderLabel":"Sous-tests"}'::jsonb),
    ('tea-ch', 'Code Transmission', 'none', 'NONE', 'numeric_4mode', 'higher_better', '{"groupKey":"teach_subtests","groupOrder":1,"orderIndex":5,"groupHeaderLabel":"Sous-tests"}'::jsonb),
    ('tea-ch', 'Creature Counting', 'none', 'NONE', 'numeric_4mode', 'higher_better', '{"groupKey":"teach_subtests","groupOrder":1,"orderIndex":6,"groupHeaderLabel":"Sous-tests"}'::jsonb),
    ('tea-ch', 'Map Mission', 'none', 'NONE', 'numeric_4mode', 'higher_better', '{"groupKey":"teach_subtests","groupOrder":1,"orderIndex":7,"groupHeaderLabel":"Sous-tests"}'::jsonb),
    ('tea-ch', 'Opposite Worlds', 'none', 'NONE', 'numeric_4mode', 'higher_better', '{"groupKey":"teach_subtests","groupOrder":1,"orderIndex":8,"groupHeaderLabel":"Sous-tests"}'::jsonb),

    -- Alouette
    ('alouette', 'Temps de lecture', 'none', 'NONE', 'numeric_4mode', 'lower_better', '{"groupKey":"alouette_scores","groupOrder":1,"orderIndex":1,"groupHeaderLabel":"Scores"}'::jsonb),
    ('alouette', 'Nombre d’erreurs', 'none', 'NONE', 'numeric_4mode', 'lower_better', '{"groupKey":"alouette_scores","groupOrder":1,"orderIndex":2,"groupHeaderLabel":"Scores"}'::jsonb),
    ('alouette', 'Indice de précision', 'none', 'NONE', 'numeric_4mode', 'higher_better', '{"groupKey":"alouette_scores","groupOrder":1,"orderIndex":3,"groupHeaderLabel":"Scores"}'::jsonb),
    ('alouette', 'Indice de vitesse', 'none', 'NONE', 'numeric_4mode', 'higher_better', '{"groupKey":"alouette_scores","groupOrder":1,"orderIndex":4,"groupHeaderLabel":"Scores"}'::jsonb),
    ('alouette', 'Indice d’efficience (CTL)', 'none', 'NONE', 'numeric_4mode', 'higher_better', '{"groupKey":"alouette_scores","groupOrder":1,"orderIndex":5,"groupHeaderLabel":"Scores"}'::jsonb),

    -- TIHM
    ('tihm', 'Translation', 'none', 'NONE', 'numeric_4mode', 'higher_better', '{"groupKey":"tihm_domains","groupOrder":1,"orderIndex":1,"groupHeaderLabel":"Domaines"}'::jsonb),
    ('tihm', 'Shift', 'none', 'NONE', 'numeric_4mode', 'higher_better', '{"groupKey":"tihm_domains","groupOrder":1,"orderIndex":2,"groupHeaderLabel":"Domaines"}'::jsonb),
    ('tihm', 'Rotation', 'none', 'NONE', 'numeric_4mode', 'higher_better', '{"groupKey":"tihm_domains","groupOrder":1,"orderIndex":3,"groupHeaderLabel":"Domaines"}'::jsonb),

    -- Vineland-3
    ('vineland-3', 'Adaptive Behavior Composite', 'none', 'NONE', 'numeric_4mode', 'higher_better', '{"groupKey":"vineland3_core","groupOrder":1,"orderIndex":1,"groupHeaderLabel":"Scores globaux"}'::jsonb),
    ('vineland-3', 'Communication', 'none', 'NONE', 'numeric_4mode', 'higher_better', '{"groupKey":"vineland3_domains","groupOrder":2,"orderIndex":1,"groupHeaderLabel":"Domaines"}'::jsonb),
    ('vineland-3', 'Daily Living Skills', 'none', 'NONE', 'numeric_4mode', 'higher_better', '{"groupKey":"vineland3_domains","groupOrder":2,"orderIndex":2,"groupHeaderLabel":"Domaines"}'::jsonb),
    ('vineland-3', 'Socialization', 'none', 'NONE', 'numeric_4mode', 'higher_better', '{"groupKey":"vineland3_domains","groupOrder":2,"orderIndex":3,"groupHeaderLabel":"Domaines"}'::jsonb),
    ('vineland-3', 'Motor Skills', 'none', 'NONE', 'numeric_4mode', 'higher_better', '{"groupKey":"vineland3_domains","groupOrder":2,"orderIndex":4,"groupHeaderLabel":"Domaines"}'::jsonb),
    ('vineland-3', 'Maladaptive Behavior', 'none', 'NONE', 'numeric_4mode', 'lower_better', '{"groupKey":"vineland3_domains","groupOrder":2,"orderIndex":5,"groupHeaderLabel":"Domaines"}'::jsonb),

    -- WISC-V (10 sous-tests primaires)
    ('wisc-v', 'Similitudes', 'none', 'NONE', 'numeric_4mode', 'higher_better', '{"groupKey":"wiscv_primary","groupOrder":1,"orderIndex":1,"groupHeaderLabel":"Sous-tests primaires"}'::jsonb),
    ('wisc-v', 'Vocabulaire', 'none', 'NONE', 'numeric_4mode', 'higher_better', '{"groupKey":"wiscv_primary","groupOrder":1,"orderIndex":2,"groupHeaderLabel":"Sous-tests primaires"}'::jsonb),
    ('wisc-v', 'Cubes', 'none', 'NONE', 'numeric_4mode', 'higher_better', '{"groupKey":"wiscv_primary","groupOrder":1,"orderIndex":3,"groupHeaderLabel":"Sous-tests primaires"}'::jsonb),
    ('wisc-v', 'Puzzles visuels', 'none', 'NONE', 'numeric_4mode', 'higher_better', '{"groupKey":"wiscv_primary","groupOrder":1,"orderIndex":4,"groupHeaderLabel":"Sous-tests primaires"}'::jsonb),
    ('wisc-v', 'Matrices', 'none', 'NONE', 'numeric_4mode', 'higher_better', '{"groupKey":"wiscv_primary","groupOrder":1,"orderIndex":5,"groupHeaderLabel":"Sous-tests primaires"}'::jsonb),
    ('wisc-v', 'Balances', 'none', 'NONE', 'numeric_4mode', 'higher_better', '{"groupKey":"wiscv_primary","groupOrder":1,"orderIndex":6,"groupHeaderLabel":"Sous-tests primaires"}'::jsonb),
    ('wisc-v', 'Mémoire des chiffres', 'none', 'NONE', 'numeric_4mode', 'higher_better', '{"groupKey":"wiscv_primary","groupOrder":1,"orderIndex":7,"groupHeaderLabel":"Sous-tests primaires"}'::jsonb),
    ('wisc-v', 'Mémoire des images', 'none', 'NONE', 'numeric_4mode', 'higher_better', '{"groupKey":"wiscv_primary","groupOrder":1,"orderIndex":8,"groupHeaderLabel":"Sous-tests primaires"}'::jsonb),
    ('wisc-v', 'Code', 'none', 'NONE', 'numeric_4mode', 'higher_better', '{"groupKey":"wiscv_primary","groupOrder":1,"orderIndex":9,"groupHeaderLabel":"Sous-tests primaires"}'::jsonb),
    ('wisc-v', 'Symboles', 'none', 'NONE', 'numeric_4mode', 'higher_better', '{"groupKey":"wiscv_primary","groupOrder":1,"orderIndex":10,"groupHeaderLabel":"Sous-tests primaires"}'::jsonb)
)
insert into public.official_subtests (
  id,
  test_id,
  name,
  score_type,
  computation_mode,
  input_model,
  raw_direction,
  input_config
)
select
  c.test_id || '__' || trim(both '-' from regexp_replace(lower(c.name), '[^a-z0-9]+', '-', 'g')) as id,
  c.test_id,
  c.name,
  c.score_type,
  c.computation_mode,
  c.input_model,
  c.raw_direction,
  c.input_config
from candidates c
join public.official_tests t on t.id = c.test_id
where not exists (
  select 1
  from public.official_subtests s
  where s.test_id = c.test_id
    and lower(trim(s.name)) = lower(trim(c.name))
);
