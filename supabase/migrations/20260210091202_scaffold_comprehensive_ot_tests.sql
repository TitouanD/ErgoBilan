
-- ============================================================
-- NEW TESTS
-- ============================================================

-- NP-MOT (Vaivre-Douret) — neurodevelopmental motor battery
INSERT INTO official_tests (id, name, author, version, category_id)
VALUES ('np-mot', 'NP-MOT', 'seed', '1.0', 'motricite-globale')
ON CONFLICT (id) DO NOTHING;

-- Figure complexe de Rey
INSERT INTO official_tests (id, name, author, version, category_id)
VALUES ('figure-rey', 'Figure Complexe de Rey', 'seed', '1.0', 'visuo-perceptif')
ON CONFLICT (id) DO NOTHING;

-- Charlop-Atwell
INSERT INTO official_tests (id, name, author, version, category_id)
VALUES ('charlop-atwell', 'Échelle de Charlop-Atwell', 'seed', '1.0', 'motricite-globale')
ON CONFLICT (id) DO NOTHING;

-- MVPT-4 (Motor-Free Visual Perception Test)
INSERT INTO official_tests (id, name, author, version, category_id)
VALUES ('mvpt-4', 'MVPT-4', 'seed', '1.0', 'visuo-perceptif')
ON CONFLICT (id) DO NOTHING;

-- DTVP-A (Adolescent/Adult)
INSERT INTO official_tests (id, name, author, version, category_id)
VALUES ('dtvp-a', 'DTVP-A', 'seed', '1.0', 'visuo-perceptif')
ON CONFLICT (id) DO NOTHING;

-- Frostig (original)
INSERT INTO official_tests (id, name, author, version, category_id)
VALUES ('frostig', 'FROSTIG (DTVP)', 'seed', '1.0', 'visuo-perceptif')
ON CONFLICT (id) DO NOTHING;

-- TEA-Ch (Test d'Évaluation de l'Attention chez l'enfant)
INSERT INTO official_tests (id, name, author, version, category_id)
VALUES ('tea-ch', 'TEA-Ch', 'seed', '1.0', 'attention-executif')
ON CONFLICT (id) DO NOTHING;

-- BHK Ado
INSERT INTO official_tests (id, name, author, version, category_id)
VALUES ('bhk-ado', 'BHK Adolescent', 'seed', '1.0', 'ecriture')
ON CONFLICT (id) DO NOTHING;

-- EGP (Examen Gériatrique des Praxies)
INSERT INTO official_tests (id, name, author, version, category_id)
VALUES ('egp', 'EGP', 'seed', '1.0', 'motricite-globale')
ON CONFLICT (id) DO NOTHING;

-- AMPS (Assessment of Motor and Process Skills)
INSERT INTO official_tests (id, name, author, version, category_id)
VALUES ('amps', 'AMPS', 'seed', '1.0', 'motricite-globale')
ON CONFLICT (id) DO NOTHING;

-- Purdue Pegboard
INSERT INTO official_tests (id, name, author, version, category_id)
VALUES ('purdue-pegboard', 'Purdue Pegboard', 'seed', '1.0', 'motricite-globale')
ON CONFLICT (id) DO NOTHING;

-- Test des Cloches (official public version since a contributed one exists)
-- Already exists as contributed test, skip

-- Reversal Test
INSERT INTO official_tests (id, name, author, version, category_id)
VALUES ('reversal', 'Reversal Test', 'seed', '1.0', 'visuo-perceptif')
ON CONFLICT (id) DO NOTHING;

-- L'Alouette (lecture)
INSERT INTO official_tests (id, name, author, version, category_id)
VALUES ('alouette', 'Test de l''Alouette', 'seed', '1.0', 'attention-executif')
ON CONFLICT (id) DO NOTHING;

-- WISC-V (only visuospatial/processing speed subtests relevant to OT)
INSERT INTO official_tests (id, name, author, version, category_id)
VALUES ('wisc-v', 'WISC-V (sous-tests visuo-spatiaux)', 'seed', '1.0', 'visuo-perceptif')
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- SUBTESTS FOR NEW TESTS
-- ============================================================

-- NP-MOT subtests (9 functions evaluated)
INSERT INTO official_subtests (id, test_id, name, unit, score_type, computation_mode) VALUES
('np-mot__tonus-passif',         'np-mot', 'Tonus passif',                  'pts', 'standard', 'LOOKUP'),
('np-mot__tonus-actif',          'np-mot', 'Tonus actif',                   'pts', 'standard', 'LOOKUP'),
('np-mot__lateralite',           'np-mot', 'Latéralité',                    'pts', 'standard', 'LOOKUP'),
('np-mot__gnosies-digitales',    'np-mot', 'Gnosies digitales',             'pts', 'standard', 'LOOKUP'),
('np-mot__praxies-manuelles',    'np-mot', 'Praxies manuelles',             'pts', 'standard', 'LOOKUP'),
('np-mot__habilete-oculomanuelle','np-mot', 'Habileté oculomanuelle',       'pts', 'standard', 'LOOKUP'),
('np-mot__adaptation-posturale', 'np-mot', 'Adaptation posturale',          'pts', 'standard', 'LOOKUP'),
('np-mot__locomotion',           'np-mot', 'Locomotion',                    'pts', 'standard', 'LOOKUP'),
('np-mot__equilibre-statique',   'np-mot', 'Équilibre statique',            'pts', 'standard', 'LOOKUP'),
('np-mot__equilibre-dynamique',  'np-mot', 'Équilibre dynamique',           'pts', 'standard', 'LOOKUP'),
('np-mot__rythme',               'np-mot', 'Rythme',                        'pts', 'standard', 'LOOKUP'),
('np-mot__attention-auditive',   'np-mot', 'Attention auditive',            'pts', 'standard', 'LOOKUP'),
('np-mot__orientation-spatiale', 'np-mot', 'Orientation spatiale',          'pts', 'standard', 'LOOKUP')
ON CONFLICT (id) DO NOTHING;

-- Figure de Rey subtests
INSERT INTO official_subtests (id, test_id, name, unit, score_type, computation_mode) VALUES
('figure-rey__copie-richesse',   'figure-rey', 'Copie - Richesse',          'pts', 'standard', 'LOOKUP'),
('figure-rey__copie-temps',      'figure-rey', 'Copie - Temps',             'sec', 'standard', 'LOOKUP'),
('figure-rey__copie-type',       'figure-rey', 'Copie - Type de reproduction','pts','standard', 'LOOKUP'),
('figure-rey__memoire-richesse', 'figure-rey', 'Mémoire - Richesse',        'pts', 'standard', 'LOOKUP'),
('figure-rey__memoire-temps',    'figure-rey', 'Mémoire - Temps',           'sec', 'standard', 'LOOKUP'),
('figure-rey__memoire-type',     'figure-rey', 'Mémoire - Type',            'pts', 'standard', 'LOOKUP')
ON CONFLICT (id) DO NOTHING;

-- Charlop-Atwell subtests
INSERT INTO official_subtests (id, test_id, name, unit, score_type, computation_mode) VALUES
('charlop__identification',      'charlop-atwell', 'Identification d''objets',   'pts', 'standard', 'LOOKUP'),
('charlop__creation',            'charlop-atwell', 'Création d''objets',         'pts', 'standard', 'LOOKUP'),
('charlop__reproduction-modeles','charlop-atwell', 'Reproduction de modèles',    'pts', 'standard', 'LOOKUP'),
('charlop__grapho-perceptif',    'charlop-atwell', 'Grapho-perceptif',           'pts', 'standard', 'LOOKUP'),
('charlop__total',               'charlop-atwell', 'Score Total',                'pts', 'standard', 'LOOKUP')
ON CONFLICT (id) DO NOTHING;

-- MVPT-4 subtests
INSERT INTO official_subtests (id, test_id, name, unit, score_type, computation_mode) VALUES
('mvpt-4__visual-discrimination',   'mvpt-4', 'Discrimination visuelle',      'pts', 'standard', 'LOOKUP'),
('mvpt-4__spatial-relationships',   'mvpt-4', 'Relations spatiales',           'pts', 'standard', 'LOOKUP'),
('mvpt-4__visual-memory',           'mvpt-4', 'Mémoire visuelle',             'pts', 'standard', 'LOOKUP'),
('mvpt-4__figure-ground',           'mvpt-4', 'Figure-Fond',                  'pts', 'standard', 'LOOKUP'),
('mvpt-4__visual-closure',          'mvpt-4', 'Clôture visuelle',             'pts', 'standard', 'LOOKUP'),
('mvpt-4__total',                   'mvpt-4', 'Score Total',                   'pts', 'standard', 'LOOKUP')
ON CONFLICT (id) DO NOTHING;

-- DTVP-A subtests
INSERT INTO official_subtests (id, test_id, name, unit, score_type, computation_mode) VALUES
('dtvp-a__copying',              'dtvp-a', 'Copie de formes',               'pts', 'scaled', 'LOOKUP'),
('dtvp-a__figure-ground',        'dtvp-a', 'Figure-Fond',                   'pts', 'scaled', 'LOOKUP'),
('dtvp-a__visual-motor-search',  'dtvp-a', 'Recherche visuo-motrice',       'pts', 'scaled', 'LOOKUP'),
('dtvp-a__visual-closure',       'dtvp-a', 'Clôture visuelle',              'pts', 'scaled', 'LOOKUP'),
('dtvp-a__form-constancy',       'dtvp-a', 'Constance de la forme',         'pts', 'scaled', 'LOOKUP'),
('dtvp-a__visual-motor-speed',   'dtvp-a', 'Vitesse visuo-motrice',         'pts', 'scaled', 'LOOKUP')
ON CONFLICT (id) DO NOTHING;

-- Frostig subtests
INSERT INTO official_subtests (id, test_id, name, unit, score_type, computation_mode) VALUES
('frostig__eye-hand',            'frostig', 'Coordination Oeil-Main',       'pts', 'standard', 'LOOKUP'),
('frostig__figure-ground',       'frostig', 'Figure-Fond',                  'pts', 'standard', 'LOOKUP'),
('frostig__form-constancy',      'frostig', 'Constance de la Forme',        'pts', 'standard', 'LOOKUP'),
('frostig__position-space',      'frostig', 'Position dans l''Espace',      'pts', 'standard', 'LOOKUP'),
('frostig__spatial-relations',   'frostig', 'Relations Spatiales',           'pts', 'standard', 'LOOKUP')
ON CONFLICT (id) DO NOTHING;

-- TEA-Ch subtests
INSERT INTO official_subtests (id, test_id, name, unit, score_type, computation_mode) VALUES
('tea-ch__recherche-carte',      'tea-ch', 'Recherche dans le ciel',        'pts', 'scaled', 'LOOKUP'),
('tea-ch__coups-fusil',          'tea-ch', 'Les coups de fusil',            'pts', 'scaled', 'LOOKUP'),
('tea-ch__petits-hommes-verts',  'tea-ch', 'Les petits hommes verts',       'pts', 'scaled', 'LOOKUP'),
('tea-ch__monde-contraire',      'tea-ch', 'Monde à l''envers',             'pts', 'scaled', 'LOOKUP'),
('tea-ch__marche-arret',         'tea-ch', 'Marche/Arrêt',                  'pts', 'scaled', 'LOOKUP'),
('tea-ch__faire-deux-choses',    'tea-ch', 'Faire deux choses à la fois',   'pts', 'scaled', 'LOOKUP'),
('tea-ch__carte-geographique',   'tea-ch', 'Carte géographique',            'pts', 'scaled', 'LOOKUP'),
('tea-ch__ecouter-deux-choses',  'tea-ch', 'Écouter deux choses à la fois', 'pts', 'scaled', 'LOOKUP'),
('tea-ch__mondes',               'tea-ch', 'Les mondes',                    'pts', 'scaled', 'LOOKUP')
ON CONFLICT (id) DO NOTHING;

-- BHK Ado subtests
INSERT INTO official_subtests (id, test_id, name, unit, score_type, computation_mode) VALUES
('bhk-ado__quality',             'bhk-ado', 'Qualité',                      'pts', 'standard', 'PARAMETRIC'),
('bhk-ado__speed',               'bhk-ado', 'Vitesse',                      'car/5min', 'standard', 'PARAMETRIC')
ON CONFLICT (id) DO NOTHING;

-- EGP subtests
INSERT INTO official_subtests (id, test_id, name, unit, score_type, computation_mode) VALUES
('egp__mobilisation-articulaire','egp', 'Mobilisation articulaire',          'pts', 'standard', 'LOOKUP'),
('egp__praxies-gestuelles',      'egp', 'Praxies gestuelles',               'pts', 'standard', 'LOOKUP'),
('egp__prehension',              'egp', 'Préhension',                       'pts', 'standard', 'LOOKUP'),
('egp__coordination-bimanuelle', 'egp', 'Coordination bimanuelle',           'pts', 'standard', 'LOOKUP'),
('egp__equilibre-statique',      'egp', 'Équilibre statique',               'pts', 'standard', 'LOOKUP'),
('egp__equilibre-dynamique',     'egp', 'Équilibre dynamique',              'pts', 'standard', 'LOOKUP'),
('egp__locomotion',              'egp', 'Locomotion',                        'pts', 'standard', 'LOOKUP'),
('egp__memoire-verbale',         'egp', 'Mémoire verbale',                  'pts', 'standard', 'LOOKUP'),
('egp__orientation-spatiale',    'egp', 'Orientation spatiale et temporelle','pts', 'standard', 'LOOKUP'),
('egp__vigilance',               'egp', 'Vigilance',                         'pts', 'standard', 'LOOKUP'),
('egp__perception',              'egp', 'Perception',                        'pts', 'standard', 'LOOKUP'),
('egp__schema-corporel',         'egp', 'Schéma corporel',                  'pts', 'standard', 'LOOKUP'),
('egp__communication',           'egp', 'Communication',                     'pts', 'standard', 'LOOKUP'),
('egp__ecriture-dessin',         'egp', 'Écriture et dessin',               'pts', 'standard', 'LOOKUP')
ON CONFLICT (id) DO NOTHING;

-- AMPS subtests
INSERT INTO official_subtests (id, test_id, name, unit, score_type, computation_mode) VALUES
('amps__motor',                  'amps', 'Habiletés motrices',              'logits', 'standard', 'LOOKUP'),
('amps__process',                'amps', 'Habiletés de processus',          'logits', 'standard', 'LOOKUP')
ON CONFLICT (id) DO NOTHING;

-- Purdue Pegboard subtests
INSERT INTO official_subtests (id, test_id, name, unit, score_type, computation_mode) VALUES
('purdue__dominant',             'purdue-pegboard', 'Main dominante',        'pts', 'standard', 'PARAMETRIC'),
('purdue__non-dominant',         'purdue-pegboard', 'Main non dominante',    'pts', 'standard', 'PARAMETRIC'),
('purdue__bilateral',            'purdue-pegboard', 'Bilatéral',             'pts', 'standard', 'PARAMETRIC'),
('purdue__assembly',             'purdue-pegboard', 'Assemblage',            'pts', 'standard', 'PARAMETRIC')
ON CONFLICT (id) DO NOTHING;

-- Reversal Test subtests
INSERT INTO official_subtests (id, test_id, name, unit, score_type, computation_mode) VALUES
('reversal__recognition',        'reversal', 'Reconnaissance',              'pts', 'standard', 'LOOKUP'),
('reversal__matching',           'reversal', 'Appariement',                 'pts', 'standard', 'LOOKUP'),
('reversal__total',              'reversal', 'Score Total',                  'pts', 'standard', 'LOOKUP')
ON CONFLICT (id) DO NOTHING;

-- L'Alouette subtests
INSERT INTO official_subtests (id, test_id, name, unit, score_type, computation_mode) VALUES
('alouette__precision',          'alouette', 'Précision',                   'pts', 'standard', 'LOOKUP'),
('alouette__vitesse',            'alouette', 'Vitesse',                     'pts', 'standard', 'LOOKUP'),
('alouette__indice-lecture',     'alouette', 'Indice de lecture',            'pts', 'standard', 'LOOKUP')
ON CONFLICT (id) DO NOTHING;

-- WISC-V (OT-relevant subtests only)
INSERT INTO official_subtests (id, test_id, name, unit, score_type, computation_mode) VALUES
('wisc-v__cubes',                'wisc-v', 'Cubes',                         'pts', 'scaled', 'LOOKUP'),
('wisc-v__puzzles-visuels',      'wisc-v', 'Puzzles visuels',               'pts', 'scaled', 'LOOKUP'),
('wisc-v__code',                 'wisc-v', 'Code',                          'pts', 'scaled', 'LOOKUP'),
('wisc-v__symboles',             'wisc-v', 'Symboles',                      'pts', 'scaled', 'LOOKUP'),
('wisc-v__barrage',              'wisc-v', 'Barrage',                       'pts', 'scaled', 'LOOKUP')
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- ENRICH EXISTING SEED TESTS WITH MISSING SUBTESTS
-- ============================================================

-- NEPSY-2: add missing subtests from the 32-subtest battery (OT-relevant)
INSERT INTO official_subtests (id, test_id, name, unit, score_type, computation_mode) VALUES
('nepsy-2__design-copying',       'nepsy-2', 'Copie de figures',             'pts', 'scaled', 'LOOKUP'),
('nepsy-2__block-construction',   'nepsy-2', 'Construction de blocs',        'pts', 'scaled', 'LOOKUP'),
('nepsy-2__geometric-puzzles',    'nepsy-2', 'Puzzles géométriques',         'pts', 'scaled', 'LOOKUP'),
('nepsy-2__picture-puzzles',      'nepsy-2', 'Puzzles d''images',            'pts', 'scaled', 'LOOKUP'),
('nepsy-2__route-finding',        'nepsy-2', 'Recherche d''itinéraire',      'pts', 'scaled', 'LOOKUP'),
('nepsy-2__finger-tapping',       'nepsy-2', 'Tapotement des doigts',        'pts', 'scaled', 'LOOKUP'),
('nepsy-2__imitating-hand',       'nepsy-2', 'Imitation de positions de main','pts', 'scaled', 'LOOKUP'),
('nepsy-2__manual-motor-seq',     'nepsy-2', 'Séquences motrices manuelles', 'pts', 'scaled', 'LOOKUP'),
('nepsy-2__inhibition',           'nepsy-2', 'Inhibition',                   'pts', 'scaled', 'LOOKUP'),
('nepsy-2__auditory-attention',   'nepsy-2', 'Attention auditive et réponses associées','pts','scaled','LOOKUP'),
('nepsy-2__statue',               'nepsy-2', 'Statue',                       'pts', 'scaled', 'LOOKUP'),
('nepsy-2__memory-designs',       'nepsy-2', 'Mémoire de figures',           'pts', 'scaled', 'LOOKUP'),
('nepsy-2__memory-faces',         'nepsy-2', 'Mémoire des visages',          'pts', 'scaled', 'LOOKUP'),
('nepsy-2__affect-recognition',   'nepsy-2', 'Reconnaissance des affects',   'pts', 'scaled', 'LOOKUP'),
('nepsy-2__theory-of-mind',       'nepsy-2', 'Théorie de l''esprit',         'pts', 'scaled', 'LOOKUP')
ON CONFLICT (id) DO NOTHING;

-- BRIEF-2: add missing composite scores
INSERT INTO official_subtests (id, test_id, name, unit, score_type, computation_mode) VALUES
('brief-2__task-completion',    'brief-2', 'Contrôle de la tâche',           'pts', 't_score', 'LOOKUP'),
('brief-2__gec',                'brief-2', 'Composé Exécutif Global (GEC)', 'pts', 't_score', 'LOOKUP')
ON CONFLICT (id) DO NOTHING;

-- Profil Sensoriel 2: add missing composite/behavioral sections
INSERT INTO official_subtests (id, test_id, name, unit, score_type, computation_mode) VALUES
('dunn-sp2__movement',           'profil-sensoriel-2', 'Mouvement',         'pts', 'standard', 'LOOKUP'),
('dunn-sp2__body-position',      'profil-sensoriel-2', 'Position du corps', 'pts', 'standard', 'LOOKUP'),
('dunn-sp2__conduct',            'profil-sensoriel-2', 'Conduite',          'pts', 'standard', 'LOOKUP'),
('dunn-sp2__social-emotional',   'profil-sensoriel-2', 'Socio-émotionnel',  'pts', 'standard', 'LOOKUP'),
('dunn-sp2__attentional',        'profil-sensoriel-2', 'Attentionnel',      'pts', 'standard', 'LOOKUP')
ON CONFLICT (id) DO NOTHING;

-- BOT-2: add composite score subtests
INSERT INTO official_subtests (id, test_id, name, unit, score_type, computation_mode) VALUES
('bot-2__fine-manual-control',   'bot-2', 'Contrôle Manuel Fin (composite)',  'pts', 'standard', 'LOOKUP'),
('bot-2__manual-coordination',   'bot-2', 'Coordination Manuelle (composite)','pts', 'standard', 'LOOKUP'),
('bot-2__body-coordination',     'bot-2', 'Coordination Corporelle (composite)','pts','standard','LOOKUP'),
('bot-2__strength-agility',      'bot-2', 'Force et Agilité (composite)',     'pts', 'standard', 'LOOKUP'),
('bot-2__total-motor',           'bot-2', 'Score Moteur Total',               'pts', 'standard', 'LOOKUP'),
('bot-2__gross-motor',           'bot-2', 'Motricité Globale (composite)',    'pts', 'standard', 'LOOKUP'),
('bot-2__fine-motor',            'bot-2', 'Motricité Fine (composite)',       'pts', 'standard', 'LOOKUP')
ON CONFLICT (id) DO NOTHING;

-- DTVP-3: missing composite scores
INSERT INTO official_subtests (id, test_id, name, unit, score_type, computation_mode) VALUES
('dtvp-3__vmi-composite',       'dtvp-3', 'Intégration Visuo-Motrice (IVM)','pts', 'standard', 'LOOKUP'),
('dtvp-3__mrp-composite',       'dtvp-3', 'Perception Visuelle à Réponse Motrice Réduite (PVMR)','pts','standard','LOOKUP'),
('dtvp-3__gvp-composite',       'dtvp-3', 'Perception Visuelle Générale (PVG)','pts','standard','LOOKUP')
ON CONFLICT (id) DO NOTHING;

-- DTVP-2: missing composite scores
INSERT INTO official_subtests (id, test_id, name, unit, score_type, computation_mode) VALUES
('dtvp-2__vmi-composite',       'dtvp-2', 'Intégration Visuo-Motrice (QMI)','pts', 'standard', 'LOOKUP'),
('dtvp-2__mnrp-composite',      'dtvp-2', 'Perception à Réponse Motrice Réduite (QPMR)','pts','standard','LOOKUP'),
('dtvp-2__gvp-composite',       'dtvp-2', 'Perception Visuelle Générale (QPV)','pts','standard','LOOKUP')
ON CONFLICT (id) DO NOTHING;

-- BHK: add the 13 quality criteria breakdown
INSERT INTO official_subtests (id, test_id, name, unit, score_type, computation_mode) VALUES
('bhk__total',                   'bhk', 'Score Total Dysgraphie',            'pts', 'standard', 'PARAMETRIC')
ON CONFLICT (id) DO NOTHING;

-- Beery VMI: ensure supplemental subtests are complete
INSERT INTO official_subtests (id, test_id, name, unit, score_type, computation_mode) VALUES
('beery-vmi__total',             'beery-vmi', 'Score Total VMI',             'pts', 'standard', 'LOOKUP')
ON CONFLICT (id) DO NOTHING;
;
