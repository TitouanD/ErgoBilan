drop index if exists public.idx_official_tests_name_scope;
create unique index idx_official_tests_name_scope on public.official_tests using btree (
  lower(regexp_replace(lower(trim(name)), '[^a-z0-9]', '', 'g')),
  coalesce(organization_id, '00000000-0000-0000-0000-000000000000'::uuid)
);

with seed_tests as (
  select * from (values
    ('mabc-2', 'MABC-2', 'motricite-globale', '1.0', 'seed'),
    ('mabc', 'MABC', 'motricite-globale', '1.0', 'seed'),
    ('bot-2', 'BOT-2', 'motricite-globale', '1.0', 'seed'),
    ('beery-vmi', 'Beery VMI', 'visuo-perceptif', '1.0', 'seed'),
    ('vmi', 'VMI', 'visuo-perceptif', '1.0', 'seed'),
    ('dtvp-2', 'DTVP-2', 'visuo-perceptif', '1.0', 'seed'),
    ('dtvp-3', 'DTVP-3', 'visuo-perceptif', '1.0', 'seed'),
    ('dtvp-a', 'DTVP-A', 'visuo-perceptif', '1.0', 'seed'),
    ('frostig', 'FROSTIG', 'visuo-perceptif', '1.0', 'seed'),
    ('reversal', 'Reversal', 'visuo-perceptif', '1.0', 'seed'),
    ('bhk', 'BHK', 'ecriture', '1.0', 'seed'),
    ('lespargot', 'Lespargot', 'ecriture', '1.0', 'seed'),
    ('ef2e', 'EF2E', 'ecriture', '1.0', 'seed'),
    ('evedp', 'EVEDP', 'ecriture', '1.0', 'seed'),
    ('evic', 'EVIC', 'ecriture', '1.0', 'seed'),
    ('rtd-lacert', 'RTD Lacert', 'ecriture', '1.0', 'seed'),
    ('cloches-test', 'Cloches test (Bell_s test)', 'attention-executif', '1.0', 'seed'),
    ('h-test', 'H test', 'attention-executif', '1.0', 'seed'),
    ('nepsy', 'NEPSY', 'attention-executif', '1.0', 'seed'),
    ('nepsy-2', 'NEPSY 2', 'attention-executif', '1.0', 'seed'),
    ('brief-2', 'BRIEF-2', 'attention-executif', '1.0', 'seed'),
    ('children-kitchen-task', 'Children Kitchen Task Activity', 'attention-executif', '1.0', 'seed'),
    ('profil-sensoriel', 'Profil Sensoriel', 'sensoriel', '1.0', 'seed'),
    ('profil-sensoriel-2', 'Profil Sensoriel 2 (Dunn)', 'sensoriel', '1.0', 'seed'),
    ('bogdashina-senso', 'Bogdashina (senso)', 'sensoriel', '1.0', 'seed'),
    ('sensot-dir', 'SensOT-dir', 'sensoriel', '1.0', 'seed'),
    ('manos', 'Manos', 'motricite-globale', '1.0', 'seed'),
    ('manos-3', 'Manos 3.0', 'motricite-globale', '1.0', 'seed'),
    ('caa', 'CAA', 'autre', '1.0', 'seed')
  ) as t(id, name, category_id, version, author)
),
seed_tests_norm as (
  select
    id,
    name,
    category_id,
    version,
    author,
    lower(regexp_replace(lower(trim(name)), '[^a-z0-9]', '', 'g')) as name_norm
  from seed_tests
),
existing_tests as (
  select
    id,
    lower(regexp_replace(lower(trim(name)), '[^a-z0-9]', '', 'g')) as name_norm
  from public.official_tests
  where organization_id is null
),
inserted_tests as (
  insert into public.official_tests (id, name, category_id, version, author, organization_id)
  select
    s.id,
    s.name,
    s.category_id,
    s.version,
    s.author,
    null
  from seed_tests_norm s
  where not exists (
    select 1 from existing_tests e where e.name_norm = s.name_norm
  )
  returning id, lower(regexp_replace(lower(trim(name)), '[^a-z0-9]', '', 'g')) as name_norm
),
resolved_tests as (
  select
    s.id as seed_id,
    s.name,
    s.name_norm,
    coalesce(e.id, i.id, s.id) as resolved_id
  from seed_tests_norm s
  left join existing_tests e on e.name_norm = s.name_norm
  left join inserted_tests i on i.name_norm = s.name_norm
),
seed_subtests as (
  select * from (values
    ('mabc-2__manual-dexterity', 'mabc-2', 'Dextérité Manuelle', 'pts', 'scaled', 'LOOKUP'),
    ('mabc-2__placing-pegs', 'mabc-2', 'Placer des chevilles', 'pts', 'scaled', 'LOOKUP'),
    ('mabc-2__threading-lace', 'mabc-2', 'Enfiler une cordelette / jetons', 'pts', 'scaled', 'LOOKUP'),
    ('mabc-2__drawing-trail', 'mabc-2', 'Tracé d''un chemin', 'pts', 'scaled', 'LOOKUP'),
    ('mabc-2__aiming-catching', 'mabc-2', 'Visée et Réception', 'pts', 'scaled', 'LOOKUP'),
    ('mabc-2__catching', 'mabc-2', 'Attraper une balle', 'pts', 'scaled', 'LOOKUP'),
    ('mabc-2__throwing', 'mabc-2', 'Lancer un sac de grains sur cible', 'pts', 'scaled', 'LOOKUP'),
    ('mabc-2__balance', 'mabc-2', 'Équilibre', 'pts', 'scaled', 'LOOKUP'),
    ('mabc-2__balance-one-leg', 'mabc-2', 'Équilibre statique (une jambe)', 'pts', 'scaled', 'LOOKUP'),
    ('mabc-2__heel-to-toe', 'mabc-2', 'Marche talon-pointe', 'pts', 'scaled', 'LOOKUP'),
    ('mabc-2__jumping', 'mabc-2', 'Sauts sur tapis / cases', 'pts', 'scaled', 'LOOKUP'),

    ('bot-2__fine-motor-precision', 'bot-2', 'Précision Motrice Fine', 'pts', 'standard', 'LOOKUP'),
    ('bot-2__coloring', 'bot-2', 'Coloriage', 'pts', 'standard', 'LOOKUP'),
    ('bot-2__cutting', 'bot-2', 'Découpage', 'pts', 'standard', 'LOOKUP'),
    ('bot-2__folding', 'bot-2', 'Pliage', 'pts', 'standard', 'LOOKUP'),
    ('bot-2__fine-motor-integration', 'bot-2', 'Intégration Motrice Fine', 'pts', 'standard', 'LOOKUP'),
    ('bot-2__copy-shapes', 'bot-2', 'Copie de formes (cercles, carrés, losanges)', 'pts', 'standard', 'LOOKUP'),
    ('bot-2__copy-complex', 'bot-2', 'Copie d''étoiles/figures complexes', 'pts', 'standard', 'LOOKUP'),
    ('bot-2__manual-dexterity', 'bot-2', 'Dextérité Manuelle', 'pts', 'standard', 'LOOKUP'),
    ('bot-2__transfer', 'bot-2', 'Transvaser des jetons', 'pts', 'standard', 'LOOKUP'),
    ('bot-2__cards', 'bot-2', 'Trier des cartes', 'pts', 'standard', 'LOOKUP'),
    ('bot-2__beads', 'bot-2', 'Enfiler des perles', 'pts', 'standard', 'LOOKUP'),
    ('bot-2__bilateral', 'bot-2', 'Coordination Bilatérale', 'pts', 'standard', 'LOOKUP'),
    ('bot-2__jumping-jacks', 'bot-2', 'Sauts en étoile', 'pts', 'standard', 'LOOKUP'),
    ('bot-2__finger-tapping', 'bot-2', 'Tapoter doigts/pieds simultanément', 'pts', 'standard', 'LOOKUP'),
    ('bot-2__balance', 'bot-2', 'Équilibre', 'pts', 'standard', 'LOOKUP'),
    ('bot-2__balance-beam', 'bot-2', 'Poutre yeux ouverts/fermés', 'pts', 'standard', 'LOOKUP'),
    ('bot-2__line-stand', 'bot-2', 'Station debout ligne droite', 'pts', 'standard', 'LOOKUP'),
    ('bot-2__speed-agility', 'bot-2', 'Vitesse et Agilité', 'pts', 'standard', 'LOOKUP'),
    ('bot-2__shuttle-run', 'bot-2', 'Course navette', 'pts', 'standard', 'LOOKUP'),
    ('bot-2__side-hops', 'bot-2', 'Sauts latéraux', 'pts', 'standard', 'LOOKUP'),
    ('bot-2__upper-limb', 'bot-2', 'Coordination Membres Supérieurs', 'pts', 'standard', 'LOOKUP'),
    ('bot-2__throw-catch', 'bot-2', 'Lancer/Attraper', 'pts', 'standard', 'LOOKUP'),
    ('bot-2__dribbling', 'bot-2', 'Dribbler une balle', 'pts', 'standard', 'LOOKUP'),
    ('bot-2__strength', 'bot-2', 'Force', 'pts', 'standard', 'LOOKUP'),
    ('bot-2__pushups', 'bot-2', 'Pompes', 'pts', 'standard', 'LOOKUP'),
    ('bot-2__situps', 'bot-2', 'Redressements assis', 'pts', 'standard', 'LOOKUP'),
    ('bot-2__broad-jump', 'bot-2', 'Saut en longueur', 'pts', 'standard', 'LOOKUP'),

    ('beery-vmi__vmi', 'beery-vmi', 'Intégration Visuo-Motrice', 'pts', 'standard', 'LOOKUP'),
    ('beery-vmi__copy-forms', 'beery-vmi', 'Copie de 30 formes géométriques', 'pts', 'standard', 'LOOKUP'),
    ('beery-vmi__visual-perception', 'beery-vmi', 'Perception Visuelle', 'pts', 'standard', 'LOOKUP'),
    ('beery-vmi__matching', 'beery-vmi', 'Appariement de formes identiques', 'pts', 'standard', 'LOOKUP'),
    ('beery-vmi__motor-coordination', 'beery-vmi', 'Coordination Motrice', 'pts', 'standard', 'LOOKUP'),
    ('beery-vmi__tracing', 'beery-vmi', 'Tracé entre deux lignes (chemins)', 'pts', 'standard', 'LOOKUP'),

    ('dtvp-2__eye-hand', 'dtvp-2', 'Coordination Oeil Main', 'pts', 'scaled', 'LOOKUP'),
    ('dtvp-2__position-in-space', 'dtvp-2', 'Position Dans l_Espace', 'pts', 'scaled', 'LOOKUP'),
    ('dtvp-2__copying', 'dtvp-2', 'Copie De Figures', 'pts', 'scaled', 'LOOKUP'),
    ('dtvp-2__figure-ground', 'dtvp-2', 'Figure fond', 'pts', 'scaled', 'LOOKUP'),
    ('dtvp-2__spatial-relations', 'dtvp-2', 'Relations Spatiales', 'pts', 'scaled', 'LOOKUP'),
    ('dtvp-2__visual-closure', 'dtvp-2', 'Closures Visuelles', 'pts', 'scaled', 'LOOKUP'),
    ('dtvp-2__visual-motor-speed', 'dtvp-2', 'Précision Visuo-Motrice', 'pts', 'scaled', 'LOOKUP'),
    ('dtvp-2__form-constancy', 'dtvp-2', 'Constance De Forme', 'pts', 'scaled', 'LOOKUP'),

    ('dtvp-3__eye-hand', 'dtvp-3', 'Coordination Oeil-Main', 'pts', 'scaled', 'LOOKUP'),
    ('dtvp-3__copying', 'dtvp-3', 'Copie de formes', 'pts', 'scaled', 'LOOKUP'),
    ('dtvp-3__figure-ground', 'dtvp-3', 'Figure-Fond', 'pts', 'scaled', 'LOOKUP'),
    ('dtvp-3__form-constancy', 'dtvp-3', 'Constance de la Forme', 'pts', 'scaled', 'LOOKUP'),
    ('dtvp-3__visual-closure', 'dtvp-3', 'Clôture Visuelle', 'pts', 'scaled', 'LOOKUP'),

    ('bhk__speed', 'bhk', 'Vitesse', 'car/5min', 'standard', 'LOOKUP'),
    ('bhk__quality', 'bhk', 'Qualité', 'pts', 'standard', 'LOOKUP'),

    ('dunn-sp2__auditory', 'profil-sensoriel-2', 'Auditif', 'pts', 'standard', 'LOOKUP'),
    ('dunn-sp2__visual', 'profil-sensoriel-2', 'Visuel', 'pts', 'standard', 'LOOKUP'),
    ('dunn-sp2__tactile', 'profil-sensoriel-2', 'Tactile', 'pts', 'standard', 'LOOKUP'),
    ('dunn-sp2__vestibular', 'profil-sensoriel-2', 'Vestibulaire', 'pts', 'standard', 'LOOKUP'),
    ('dunn-sp2__proprioceptive', 'profil-sensoriel-2', 'Proprioceptif', 'pts', 'standard', 'LOOKUP'),
    ('dunn-sp2__oral', 'profil-sensoriel-2', 'Oral', 'pts', 'standard', 'LOOKUP'),
    ('dunn-sp2__seeking', 'profil-sensoriel-2', 'Recherche', 'pts', 'standard', 'LOOKUP'),
    ('dunn-sp2__avoiding', 'profil-sensoriel-2', 'Évitement', 'pts', 'standard', 'LOOKUP'),
    ('dunn-sp2__sensitivity', 'profil-sensoriel-2', 'Sensibilité', 'pts', 'standard', 'LOOKUP'),
    ('dunn-sp2__registration', 'profil-sensoriel-2', 'Faible Enregistrement', 'pts', 'standard', 'LOOKUP'),

    ('brief-2__behavioral-regulation', 'brief-2', 'Régulation Comportementale', 'pts', 't-score', 'LOOKUP'),
    ('brief-2__inhibition', 'brief-2', 'Inhibition', 'pts', 't-score', 'LOOKUP'),
    ('brief-2__flexibility', 'brief-2', 'Flexibilité', 'pts', 't-score', 'LOOKUP'),
    ('brief-2__emotional-regulation', 'brief-2', 'Régulation Émotionnelle', 'pts', 't-score', 'LOOKUP'),
    ('brief-2__emotional-control', 'brief-2', 'Contrôle Émotionnel', 'pts', 't-score', 'LOOKUP'),
    ('brief-2__cognitive-regulation', 'brief-2', 'Régulation Cognitive', 'pts', 't-score', 'LOOKUP'),
    ('brief-2__working-memory', 'brief-2', 'Mémoire de travail', 'pts', 't-score', 'LOOKUP'),
    ('brief-2__planning', 'brief-2', 'Planification/Organisation', 'pts', 't-score', 'LOOKUP'),
    ('brief-2__self-monitor', 'brief-2', 'Auto-surveillance', 'pts', 't-score', 'LOOKUP'),

    ('nepsy__auditory-attention', 'nepsy', 'Attention auditive', 'pts', 'scaled', 'LOOKUP'),
    ('nepsy__cubes', 'nepsy', 'Cubes', 'pts', 'scaled', 'LOOKUP'),
    ('nepsy__arrows', 'nepsy', 'Flèches', 'pts', 'scaled', 'LOOKUP'),
    ('nepsy__visuomotor-precision', 'nepsy', 'Précision visuo-motrice', 'pts', 'scaled', 'LOOKUP'),

    ('nepsy-2__figure-copy', 'nepsy-2', 'Copie de figure', 'pts', 'scaled', 'LOOKUP'),
    ('nepsy-2__cubes', 'nepsy-2', 'Cubes', 'pts', 'scaled', 'LOOKUP'),
    ('nepsy-2__drawing-fluency', 'nepsy-2', 'Fluidité de dessin', 'pts', 'scaled', 'LOOKUP'),
    ('nepsy-2__arrows', 'nepsy-2', 'Flèches', 'pts', 'scaled', 'LOOKUP'),
    ('nepsy-2__clock', 'nepsy-2', 'Horloge', 'pts', 'scaled', 'LOOKUP'),
    ('nepsy-2__orientation', 'nepsy-2', 'Orientation', 'pts', 'scaled', 'LOOKUP'),
    ('nepsy-2__visuomotor-precision', 'nepsy-2', 'Précision visuo-motrice', 'pts', 'scaled', 'LOOKUP')
  ) as t(id, test_id, name, unit, score_type, computation_mode)
),
resolved_subtests as (
  select
    s.id,
    r.resolved_id as test_id,
    s.name,
    s.unit,
    s.score_type,
    s.computation_mode
  from seed_subtests s
  join resolved_tests r on r.seed_id = s.test_id
)
insert into public.official_subtests (id, test_id, name, unit, score_type, computation_mode)
select
  id,
  test_id,
  name,
  unit,
  score_type,
  computation_mode
from resolved_subtests
on conflict (id) do update
set test_id = excluded.test_id,
    name = excluded.name,
    unit = excluded.unit,
    score_type = excluded.score_type,
    computation_mode = excluded.computation_mode;;
