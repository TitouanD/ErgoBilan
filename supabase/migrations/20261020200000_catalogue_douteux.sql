-- Catalogue officiel : sous-tests douteux, BOT-2, points « à confirmer » et
-- Jebsen-Taylor par main (#90, suite de #50).
-- Sources et décision ligne par ligne : docs/catalogue/verification-2026-10-20.md.
-- Règle de Titouan : sans source suffisante, la ligne est retirée (« un test
-- faux est bien pire qu'un test absent »).
--
--   1. Retraits (aucune FK serveur vers official_subtests ; les scores déjà
--      saisis restent dans les bilans locaux, affichés sous leur ancien nom
--      grâce à data/retiredCatalog.ts, échelle `none`) :
--      - Découpage d'Ozeretzki (test entier) : aucune fiche de cotation publiée ;
--      - Reversal : « nombre d'inversions » (le protocole cote des erreurs par type) ;
--      - NEPSY-2 : « Inhibition » générique (les notes sont par condition) et
--        « Tapotement des doigts » (plus de note totale dans la NEPSY-II) ;
--      - MoCA : « Mémoire » (l'apprentissage des mots ne rapporte aucun point) ;
--      - Vineland-3 : « Maladaptive Behavior » (pas de note de domaine) ;
--      - BRIEF-2 : Task-Completion (forme auto-évaluation seulement) ;
--      - MVPT-4 : les 5 domaines (construits, pas des scores ; un seul score total) ;
--      - Figure de Rey : « Copie du modèle » (doublon, NS m=10 sans source) et
--        « Reproduction de mémoire » (en-tête en doublon) ;
--      - EGP : équilibre statique/dynamique et communication verbale/non verbale
--        (le protocole a Coordination statique I et II, dynamique I et II et un
--        seul item Communication) ;
--      - BOT-2 : les 19 items (pas de note normée par item, plusieurs fusionnés
--        ou mal rangés) ;
--      - Jebsen-Taylor : les 7 lignes sans main (chaque épreuve se passe main non
--        dominante puis main dominante).
--   2. Ajouts :
--      - BOT-2 : 8 sous-tests (notes d'échelle m=15, σ=5 : pas d'échelle dans
--        l'app, `none`, saisie en ET ou en %) et 5 composites (m=50, σ=10, `t-score`) ;
--      - Jebsen-Taylor : 7 épreuves × 2 mains et total par main (secondes, `none`) ;
--      - EGP : Coordination statique I et II, dynamique I et II, Communication ;
--      - NEPSY-2 : Tapping, notes combinées Répétitions et Séquences (`scaled`) ;
--      - WISC-V : ICV, IVS, IRF, IMT, IVT, QIT (m=100, `standard`).
--   3. Échelles :
--      - NEPSY-2 : Catégorisation, Mémoire narrative, Répétition de pseudo-mots,
--        Séquences motrices manuelles, Séquences oro-motrices → `scaled` ;
--      - BHK, BHK Ado, Barrage des H (cibles, temps) → `none` (résultats en
--        écarts-types ou simple approche normative, pas de note m=100) ;
--      - BRIEF-2 et SPM → `none` : une note T haute y signale une difficulté,
--        l'app la lirait « dans la moyenne » ou au-dessus.
--   4. Libellés en français (anglais entre parenthèses) : TEA-Ch, BRIEF-2, SPM,
--      PDMS-2, domaines Vineland-3.
--
-- Données seulement, aucun changement de schéma. Aucun identifiant de ligne
-- conservée n'est modifié. Idempotente (DELETE ciblés, ON CONFLICT DO NOTHING,
-- UPDATE à valeurs fixes). Compatible avec le client en production : il lit les
-- lignes nouvelles comme les autres et affiche un sous-test retiré par repli.

begin;

-- ─── 1. Retraits ────────────────────────────────────────────────────────────

delete from official_subtests
where organization_id is null
  and (test_id, id) in (
    ('ozeretzki',     'ozeretzki__decoupage-cercle'),
    ('ozeretzki',     'ozeretzki__temps-main-non-dominante'),
    ('ozeretzki',     'ozeretzki__decoupage-qualite'),
    ('reversal',      'reversal__nombre-d-inversions'),
    ('nepsy-2',       'nepsy-2__inhibition'),
    ('nepsy-2',       'nepsy-2__tapotement-des-doigts'),
    ('moca',          'moca__memory-score'),
    ('vineland-3',    'vineland-3__maladaptive-behavior'),
    ('brief-2',       'brief-2__task-completion'),
    ('mvpt-4',        'mvpt-4__discrimination-visuelle'),
    ('mvpt-4',        'mvpt-4__figure-fond'),
    ('mvpt-4',        'mvpt-4__m-moire-visuelle'),
    ('mvpt-4',        'mvpt-4__closure-visuelle'),
    ('mvpt-4',        'mvpt-4__relations-spatiales'),
    ('figure-rey',    'figure-rey__copie-modele'),
    ('figure-rey',    'figure-rey__reproduction-memoire'),
    ('egp',           'egp__equilibre-statique'),
    ('egp',           'egp__equilibre-dynamique'),
    ('egp',           'egp__communication-verbale'),
    ('egp',           'egp__communication-non-verbale'),
    ('bot-2',         'bot-2__coloring'),
    ('bot-2',         'bot-2__copy-complex'),
    ('bot-2',         'bot-2__copy-shapes'),
    ('bot-2',         'bot-2__shuttle-run'),
    ('bot-2',         'bot-2__cutting'),
    ('bot-2',         'bot-2__dribbling'),
    ('bot-2',         'bot-2__beads'),
    ('bot-2',         'bot-2__throw-catch'),
    ('bot-2',         'bot-2__folding'),
    ('bot-2',         'bot-2__pushups'),
    ('bot-2',         'bot-2__balance-beam'),
    ('bot-2',         'bot-2__situps'),
    ('bot-2',         'bot-2__broad-jump'),
    ('bot-2',         'bot-2__jumping-jacks'),
    ('bot-2',         'bot-2__side-hops'),
    ('bot-2',         'bot-2__line-stand'),
    ('bot-2',         'bot-2__finger-tapping'),
    ('bot-2',         'bot-2__transfer'),
    ('bot-2',         'bot-2__cards'),
    ('jebsen-taylor', 'jebsen-taylor__writing'),
    ('jebsen-taylor', 'jebsen-taylor__card-turning'),
    ('jebsen-taylor', 'jebsen-taylor__small-objects'),
    ('jebsen-taylor', 'jebsen-taylor__feeding'),
    ('jebsen-taylor', 'jebsen-taylor__checkers'),
    ('jebsen-taylor', 'jebsen-taylor__large-light'),
    ('jebsen-taylor', 'jebsen-taylor__large-heavy')
  );

delete from official_tests where id = 'ozeretzki' and organization_id is null;

-- ─── 2. Ajouts ──────────────────────────────────────────────────────────────

insert into official_subtests (id, test_id, name, unit, score_type, input_model, input_config, display_group_order, display_order)
values
  -- BOT-2 : sous-tests, dans l'ordre du protocole (1 à 8)
  ('bot-2__fine-motor-precision', 'bot-2', 'Précision motrice fine (Fine Motor Precision)', null, 'none', 'numeric_4mode',
   '{"groupKey":"bot2_01_subtests","groupOrder":1,"orderIndex":1,"groupHeaderLabel":"Sous-tests (note d''échelle m=15, σ=5)"}', 1, 1),
  ('bot-2__fine-motor-integration', 'bot-2', 'Intégration motrice fine (Fine Motor Integration)', null, 'none', 'numeric_4mode',
   '{"groupKey":"bot2_01_subtests","groupOrder":1,"orderIndex":2,"groupHeaderLabel":"Sous-tests (note d''échelle m=15, σ=5)"}', 1, 2),
  ('bot-2__manual-dexterity', 'bot-2', 'Dextérité manuelle (Manual Dexterity)', null, 'none', 'numeric_4mode',
   '{"groupKey":"bot2_01_subtests","groupOrder":1,"orderIndex":3,"groupHeaderLabel":"Sous-tests (note d''échelle m=15, σ=5)"}', 1, 3),
  ('bot-2__bilateral-coordination', 'bot-2', 'Coordination bilatérale (Bilateral Coordination)', null, 'none', 'numeric_4mode',
   '{"groupKey":"bot2_01_subtests","groupOrder":1,"orderIndex":4,"groupHeaderLabel":"Sous-tests (note d''échelle m=15, σ=5)"}', 1, 4),
  ('bot-2__balance', 'bot-2', 'Équilibre (Balance)', null, 'none', 'numeric_4mode',
   '{"groupKey":"bot2_01_subtests","groupOrder":1,"orderIndex":5,"groupHeaderLabel":"Sous-tests (note d''échelle m=15, σ=5)"}', 1, 5),
  ('bot-2__running-speed-agility', 'bot-2', 'Vitesse de course et agilité (Running Speed and Agility)', null, 'none', 'numeric_4mode',
   '{"groupKey":"bot2_01_subtests","groupOrder":1,"orderIndex":6,"groupHeaderLabel":"Sous-tests (note d''échelle m=15, σ=5)"}', 1, 6),
  ('bot-2__upper-limb-coordination', 'bot-2', 'Coordination des membres supérieurs (Upper-Limb Coordination)', null, 'none', 'numeric_4mode',
   '{"groupKey":"bot2_01_subtests","groupOrder":1,"orderIndex":7,"groupHeaderLabel":"Sous-tests (note d''échelle m=15, σ=5)"}', 1, 7),
  ('bot-2__strength', 'bot-2', 'Force (Strength)', null, 'none', 'numeric_4mode',
   '{"groupKey":"bot2_01_subtests","groupOrder":1,"orderIndex":8,"groupHeaderLabel":"Sous-tests (note d''échelle m=15, σ=5)"}', 1, 8),
  -- BOT-2 : composites
  ('bot-2__fine-manual-control', 'bot-2', 'Contrôle manuel fin (Fine Manual Control)', null, 't-score', 'numeric_4mode',
   '{"groupKey":"bot2_02_composites","groupOrder":2,"orderIndex":1,"groupHeaderLabel":"Composites"}', 2, 9),
  ('bot-2__manual-coordination', 'bot-2', 'Coordination manuelle (Manual Coordination)', null, 't-score', 'numeric_4mode',
   '{"groupKey":"bot2_02_composites","groupOrder":2,"orderIndex":2,"groupHeaderLabel":"Composites"}', 2, 10),
  ('bot-2__body-coordination', 'bot-2', 'Coordination corporelle (Body Coordination)', null, 't-score', 'numeric_4mode',
   '{"groupKey":"bot2_02_composites","groupOrder":2,"orderIndex":3,"groupHeaderLabel":"Composites"}', 2, 11),
  ('bot-2__strength-agility', 'bot-2', 'Force et agilité (Strength and Agility)', null, 't-score', 'numeric_4mode',
   '{"groupKey":"bot2_02_composites","groupOrder":2,"orderIndex":4,"groupHeaderLabel":"Composites"}', 2, 12),
  ('bot-2__total-motor-composite', 'bot-2', 'Composite moteur total (Total Motor Composite)', null, 't-score', 'numeric_4mode',
   '{"groupKey":"bot2_02_composites","groupOrder":2,"orderIndex":5,"groupHeaderLabel":"Composites"}', 2, 13),

  -- Jebsen-Taylor : main non dominante d'abord, comme la passation
  ('jebsen-taylor__writing-non-dominant', 'jebsen-taylor', 'Écriture', 'sec', 'none', 'numeric_4mode',
   '{"groupKey":"jebsen_01_non_dominante","groupOrder":1,"orderIndex":1,"groupHeaderLabel":"Main non dominante"}', 1, 1),
  ('jebsen-taylor__card-turning-non-dominant', 'jebsen-taylor', 'Retournement de cartes', 'sec', 'none', 'numeric_4mode',
   '{"groupKey":"jebsen_01_non_dominante","groupOrder":1,"orderIndex":2,"groupHeaderLabel":"Main non dominante"}', 1, 2),
  ('jebsen-taylor__small-objects-non-dominant', 'jebsen-taylor', 'Petits objets communs', 'sec', 'none', 'numeric_4mode',
   '{"groupKey":"jebsen_01_non_dominante","groupOrder":1,"orderIndex":3,"groupHeaderLabel":"Main non dominante"}', 1, 3),
  ('jebsen-taylor__feeding-non-dominant', 'jebsen-taylor', 'Alimentation simulée', 'sec', 'none', 'numeric_4mode',
   '{"groupKey":"jebsen_01_non_dominante","groupOrder":1,"orderIndex":4,"groupHeaderLabel":"Main non dominante"}', 1, 4),
  ('jebsen-taylor__checkers-non-dominant', 'jebsen-taylor', 'Empilement de jetons', 'sec', 'none', 'numeric_4mode',
   '{"groupKey":"jebsen_01_non_dominante","groupOrder":1,"orderIndex":5,"groupHeaderLabel":"Main non dominante"}', 1, 5),
  ('jebsen-taylor__large-light-non-dominant', 'jebsen-taylor', 'Grands objets légers', 'sec', 'none', 'numeric_4mode',
   '{"groupKey":"jebsen_01_non_dominante","groupOrder":1,"orderIndex":6,"groupHeaderLabel":"Main non dominante"}', 1, 6),
  ('jebsen-taylor__large-heavy-non-dominant', 'jebsen-taylor', 'Grands objets lourds', 'sec', 'none', 'numeric_4mode',
   '{"groupKey":"jebsen_01_non_dominante","groupOrder":1,"orderIndex":7,"groupHeaderLabel":"Main non dominante"}', 1, 7),
  ('jebsen-taylor__total-non-dominant', 'jebsen-taylor', 'Total main non dominante', 'sec', 'none', 'numeric_4mode',
   '{"groupKey":"jebsen_01_non_dominante","groupOrder":1,"orderIndex":8,"groupHeaderLabel":"Main non dominante"}', 1, 8),
  ('jebsen-taylor__writing-dominant', 'jebsen-taylor', 'Écriture', 'sec', 'none', 'numeric_4mode',
   '{"groupKey":"jebsen_02_dominante","groupOrder":2,"orderIndex":1,"groupHeaderLabel":"Main dominante"}', 2, 9),
  ('jebsen-taylor__card-turning-dominant', 'jebsen-taylor', 'Retournement de cartes', 'sec', 'none', 'numeric_4mode',
   '{"groupKey":"jebsen_02_dominante","groupOrder":2,"orderIndex":2,"groupHeaderLabel":"Main dominante"}', 2, 10),
  ('jebsen-taylor__small-objects-dominant', 'jebsen-taylor', 'Petits objets communs', 'sec', 'none', 'numeric_4mode',
   '{"groupKey":"jebsen_02_dominante","groupOrder":2,"orderIndex":3,"groupHeaderLabel":"Main dominante"}', 2, 11),
  ('jebsen-taylor__feeding-dominant', 'jebsen-taylor', 'Alimentation simulée', 'sec', 'none', 'numeric_4mode',
   '{"groupKey":"jebsen_02_dominante","groupOrder":2,"orderIndex":4,"groupHeaderLabel":"Main dominante"}', 2, 12),
  ('jebsen-taylor__checkers-dominant', 'jebsen-taylor', 'Empilement de jetons', 'sec', 'none', 'numeric_4mode',
   '{"groupKey":"jebsen_02_dominante","groupOrder":2,"orderIndex":5,"groupHeaderLabel":"Main dominante"}', 2, 13),
  ('jebsen-taylor__large-light-dominant', 'jebsen-taylor', 'Grands objets légers', 'sec', 'none', 'numeric_4mode',
   '{"groupKey":"jebsen_02_dominante","groupOrder":2,"orderIndex":6,"groupHeaderLabel":"Main dominante"}', 2, 14),
  ('jebsen-taylor__large-heavy-dominant', 'jebsen-taylor', 'Grands objets lourds', 'sec', 'none', 'numeric_4mode',
   '{"groupKey":"jebsen_02_dominante","groupOrder":2,"orderIndex":7,"groupHeaderLabel":"Main dominante"}', 2, 15),
  ('jebsen-taylor__total-dominant', 'jebsen-taylor', 'Total main dominante', 'sec', 'none', 'numeric_4mode',
   '{"groupKey":"jebsen_02_dominante","groupOrder":2,"orderIndex":8,"groupHeaderLabel":"Main dominante"}', 2, 16),

  -- EGP : items 1 à 4 et 17 du protocole (ordre fixé plus bas)
  ('egp__coordination-statique-1', 'egp', 'Coordination statique I', null, 'none', 'numeric_4mode',
   '{"groupKey":"egp_01_items","groupOrder":1,"orderIndex":1,"groupHeaderLabel":"Items EGP"}', 1, 1),
  ('egp__coordination-statique-2', 'egp', 'Coordination statique II', null, 'none', 'numeric_4mode',
   '{"groupKey":"egp_01_items","groupOrder":1,"orderIndex":2,"groupHeaderLabel":"Items EGP"}', 1, 2),
  ('egp__coordination-dynamique-1', 'egp', 'Coordination dynamique I', null, 'none', 'numeric_4mode',
   '{"groupKey":"egp_01_items","groupOrder":1,"orderIndex":3,"groupHeaderLabel":"Items EGP"}', 1, 3),
  ('egp__coordination-dynamique-2', 'egp', 'Coordination dynamique II', null, 'none', 'numeric_4mode',
   '{"groupKey":"egp_01_items","groupOrder":1,"orderIndex":4,"groupHeaderLabel":"Items EGP"}', 1, 4),
  ('egp__communication', 'egp', 'Communication', null, 'none', 'numeric_4mode',
   '{"groupKey":"egp_01_items","groupOrder":1,"orderIndex":17,"groupHeaderLabel":"Items EGP"}', 1, 17),

  -- NEPSY-2 : notes combinées du Tapping (display_order renuméroté plus bas)
  ('nepsy-2__tapping-repetitions', 'nepsy-2', 'Tapping — Répétitions (note combinée)', null, 'scaled', 'numeric_4mode',
   '{"groupKey":"nepsy2_all","groupHeaderLabel":"Sous-tests"}', 1, 100),
  ('nepsy-2__tapping-sequences', 'nepsy-2', 'Tapping — Séquences (note combinée)', null, 'scaled', 'numeric_4mode',
   '{"groupKey":"nepsy2_all","groupHeaderLabel":"Sous-tests"}', 1, 101),

  -- WISC-V : indices principaux et QI total
  ('wisc-v__icv', 'wisc-v', 'Indice de compréhension verbale (ICV)', null, 'standard', 'numeric_4mode',
   '{"groupKey":"wiscv_02_indices","groupOrder":2,"orderIndex":1,"groupHeaderLabel":"Indices principaux"}', 2, 11),
  ('wisc-v__ivs', 'wisc-v', 'Indice visuospatial (IVS)', null, 'standard', 'numeric_4mode',
   '{"groupKey":"wiscv_02_indices","groupOrder":2,"orderIndex":2,"groupHeaderLabel":"Indices principaux"}', 2, 12),
  ('wisc-v__irf', 'wisc-v', 'Indice de raisonnement fluide (IRF)', null, 'standard', 'numeric_4mode',
   '{"groupKey":"wiscv_02_indices","groupOrder":2,"orderIndex":3,"groupHeaderLabel":"Indices principaux"}', 2, 13),
  ('wisc-v__imt', 'wisc-v', 'Indice de mémoire de travail (IMT)', null, 'standard', 'numeric_4mode',
   '{"groupKey":"wiscv_02_indices","groupOrder":2,"orderIndex":4,"groupHeaderLabel":"Indices principaux"}', 2, 14),
  ('wisc-v__ivt', 'wisc-v', 'Indice de vitesse de traitement (IVT)', null, 'standard', 'numeric_4mode',
   '{"groupKey":"wiscv_02_indices","groupOrder":2,"orderIndex":5,"groupHeaderLabel":"Indices principaux"}', 2, 15),
  ('wisc-v__qit', 'wisc-v', 'QI total (QIT)', null, 'standard', 'numeric_4mode',
   '{"groupKey":"wiscv_02_indices","groupOrder":2,"orderIndex":6,"groupHeaderLabel":"Indices principaux"}', 2, 16)
on conflict (id) do nothing;

-- ─── 3. Échelles ────────────────────────────────────────────────────────────

update official_subtests set score_type = 'scaled'
where organization_id is null and test_id = 'nepsy-2'
  and id in ('nepsy-2__categorisation', 'nepsy-2__memoire-narrative', 'nepsy-2__repetition-de-pseudo-mots',
             'nepsy-2__sequences-motrices-manuelles', 'nepsy-2__sequences-oro-motrices');

update official_subtests set score_type = 'none'
where organization_id is null
  and (test_id, id) in (
    ('bhk', 'bhk__quality'), ('bhk', 'bhk__speed'),
    ('bhk-ado', 'bhk-ado__quality'), ('bhk-ado', 'bhk-ado__speed'),
    ('barrage-h', 'barrage-h__cibles'), ('barrage-h', 'barrage-h__temps')
  );

update official_subtests set score_type = 'none'
where organization_id is null and test_id in ('brief-2', 'spm');

-- ─── 4. Libellés ────────────────────────────────────────────────────────────

with n(id, name) as (
  values
    -- TEA-Ch : noms de l'édition française (ECPA)
    ('tea-ch__sky-search', 'Recherche dans le ciel (Sky Search)'),
    ('tea-ch__score', 'Coups de fusil (Score!)'),
    ('tea-ch__score-dual-task', 'Écouter deux choses à la fois (Score! Dual Task)'),
    ('tea-ch__sky-search-dual-task', 'Faire deux choses à la fois (Sky Search Dual Task)'),
    ('tea-ch__walk-don-t-walk', 'Marche-Arrête (Walk Don''t Walk)'),
    ('tea-ch__code-transmission', 'Transmission de codes (Code Transmission)'),
    ('tea-ch__creature-counting', 'Les petits hommes verts (Creature Counting)'),
    ('tea-ch__map-mission', 'Carte géographique (Map Mission)'),
    ('tea-ch__opposite-worlds', 'Mondes contraires (Opposite Worlds)'),
    -- BRIEF-2 : noms de l'adaptation française (Hogrefe)
    ('brief-2__inhibit', 'Inhibition (Inhibit)'),
    ('brief-2__self-monitor', 'Contrôle de soi (Self-Monitor)'),
    ('brief-2__shift', 'Flexibilité (Shift)'),
    ('brief-2__emotional-control', 'Contrôle émotionnel (Emotional Control)'),
    ('brief-2__initiation', 'Initiation (Initiate)'),
    ('brief-2__working-memory', 'Mémoire de travail (Working Memory)'),
    ('brief-2__plan-organize', 'Planification/Organisation (Plan/Organize)'),
    ('brief-2__task-monitor', 'Contrôle de la tâche (Task-Monitor)'),
    ('brief-2__organization-materials', 'Organisation du matériel (Organization of Materials)'),
    ('brief-2__bri', 'Indice de régulation comportementale (BRI)'),
    ('brief-2__eri', 'Indice de régulation émotionnelle (ERI)'),
    ('brief-2__cri', 'Indice de régulation cognitive (CRI)'),
    ('brief-2__gec', 'Score composite exécutif global (GEC)'),
    ('brief-2__negativity', 'Négativité (Negativity)'),
    ('brief-2__inconsistency', 'Incohérence (Inconsistency)'),
    ('brief-2__infrequency', 'Rareté (Infrequency)'),
    -- SPM (pas d'édition française : traduction, nom anglais entre parenthèses)
    ('spm__social-participation', 'Participation sociale (Social Participation)'),
    ('spm__vision', 'Vision'),
    ('spm__hearing', 'Audition (Hearing)'),
    ('spm__touch', 'Toucher (Touch)'),
    ('spm__taste-and-smell', 'Goût et odorat (Taste and Smell)'),
    ('spm__body-awareness', 'Conscience du corps (Body Awareness)'),
    ('spm__balance-and-motion', 'Équilibre et mouvement (Balance and Motion)'),
    ('spm__planning-and-ideas', 'Planification et idéation (Planning and Ideas)'),
    ('spm__total-sensory-systems', 'Total des systèmes sensoriels (Total Sensory Systems)'),
    -- PDMS-2 (pas d'édition française)
    ('pdms-2__reflexes', 'Réflexes (Reflexes)'),
    ('pdms-2__stationary', 'Stationnaire (Stationary)'),
    ('pdms-2__locomotion', 'Locomotion'),
    ('pdms-2__object-manipulation', 'Manipulation d''objets (Object Manipulation)'),
    ('pdms-2__grasping', 'Préhension (Grasping)'),
    ('pdms-2__visual-motor-integration', 'Intégration visuomotrice (Visual-Motor Integration)'),
    ('pdms-2__gmq', 'Quotient moteur global (GMQ)'),
    ('pdms-2__fmq', 'Quotient moteur fin (FMQ)'),
    ('pdms-2__tmq', 'Quotient moteur total (TMQ)'),
    -- Vineland-3 : domaines (les sous-domaines sont déjà en français)
    ('vineland-3__adaptive-behavior-composite', 'Note composite du comportement adaptatif (Adaptive Behavior Composite)'),
    ('vineland-3__daily-living-skills', 'Vie quotidienne (Daily Living Skills)'),
    ('vineland-3__socialization', 'Socialisation (Socialization)'),
    ('vineland-3__motor-skills', 'Motricité (Motor Skills)')
)
update official_subtests s set name = n.name
from n where s.id = n.id and s.organization_id is null;

-- BRIEF-2 : en-têtes de groupe en français
update official_subtests
set input_config = jsonb_set(input_config, '{groupHeaderLabel}',
      to_jsonb(case input_config ->> 'groupKey'
                 when 'brief2_01_clinical' then 'Échelles cliniques'
                 when 'brief2_02_indexes' then 'Indices'
                 when 'brief2_03_validity' then 'Échelles de validité'
               end))
where organization_id is null and test_id = 'brief-2'
  and input_config ->> 'groupKey' in ('brief2_01_clinical', 'brief2_02_indexes', 'brief2_03_validity');

-- ─── 5. Ordres ──────────────────────────────────────────────────────────────

-- EGP : ordre des 17 items du protocole, score global en dernier.
with o(id, ord) as (
  values
    ('egp__coordination-statique-1', 1), ('egp__coordination-statique-2', 2),
    ('egp__coordination-dynamique-1', 3), ('egp__coordination-dynamique-2', 4),
    ('egp__mobilisations-articulaires-ms', 5), ('egp__mobilisations-articulaires-mi', 6),
    ('egp__motricite-fine-ms', 7), ('egp__motricite-fine-mi', 8), ('egp__praxies', 9),
    ('egp__connaissance-parties-corps', 10), ('egp__vigilance', 11), ('egp__memoire-perceptive', 12),
    ('egp__sphere-spatiale', 13), ('egp__memoire-verbale', 14), ('egp__perceptions', 15),
    ('egp__sphere-temporelle', 16), ('egp__communication', 17), ('egp__score-global', 18)
)
update official_subtests s
set display_order = o.ord,
    input_config = jsonb_set(s.input_config, '{orderIndex}', to_jsonb(o.ord))
from o where s.test_id = 'egp' and s.id = o.id;

-- NEPSY-2 : ordre alphabétique (#44), sans trou.
with ranked as (
  select id, row_number() over (order by name collate "und-x-icu", id) as rn
  from official_subtests
  where test_id = 'nepsy-2' and organization_id is null
)
update official_subtests s set display_order = ranked.rn
from ranked where s.test_id = 'nepsy-2' and s.id = ranked.id;

commit;

-- ─── Vérification après application (lecture seule) ─────────────────────────
-- select test_id, count(*) from official_subtests
-- where organization_id is null
--   and test_id in ('bot-2','jebsen-taylor','egp','nepsy-2','wisc-v','mvpt-4','figure-rey','moca',
--                   'reversal','vineland-3','brief-2','ozeretzki')
-- group by 1 order by 1;
-- Attendu : bot-2 13, brief-2 15, egp 18, figure-rey 5, jebsen-taylor 16, moca 8, mvpt-4 1,
-- nepsy-2 50, reversal 1, vineland-3 18, wisc-v 16 ; ozeretzki absent (et absent d'official_tests).
-- select test_id, display_group_order, input_config ->> 'groupKey', display_order, count(*)
-- from official_subtests where test_id in ('bot-2','jebsen-taylor','egp','nepsy-2','wisc-v')
-- group by 1, 2, 3, 4 having count(*) > 1;  -- attendu : aucune ligne
