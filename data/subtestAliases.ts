import { normalizeTestName, normalizeSubtestName } from '../utils';

export type SubtestAliasMap = Record<string, Record<string, string>>;

/**
 * Map of normalizedTestName → { normalizedSubtestAlias → canonical display name }.
 * Used to resolve AI-extracted subtest names to the canonical name in the catalog.
 * Each key is normalizeTestName(testName), each alias key is normalizeSubtestName(alias).
 */
export const SUBTEST_ALIASES: SubtestAliasMap = {
  // ──────────── MABC-2 ────────────
  'mabc2': {
    // Band 1 (3-6 ans)
    'tireliremainpreferee':          'Tirelire main préférée',
    'tireliremainnonpreferee':       'Tirelire main non préférée',
    'tirelire':                      'Tirelire main préférée',
    'enfilercube':                   'Enfiler cubes',
    'enfilercubemain1meilleur':      'Enfiler cubes',
    'tracedunchemin':                'Tracé d\'un chemin',
    'trace':                         'Tracé d\'un chemin',
    'trajet1':                       'Trajet 1',
    'trajet3':                       'Trajet 3',
    'path2error':                    'Trajet 1',
    'attrapersac':                   'Attraper sac',
    'lancersac':                     'Lancer sac',
    'equilibrestatique':             'Équilibre statique (une jambe)',
    'equilibrestatiqueunejambe':     'Équilibre statique (une jambe)',
    'equilibre1jambemeilleurejambe': 'Équilibre sur 1 jambe meilleure jambe',
    'equilibre1jambeautrejambe':     'Équilibre sur 1 jambe autre jambe',
    'marchetalonpointe':             'Marche talon-pointe',
    'marcherpointepied':             'Marcher sur pointe des pieds',
    'sautertapi':                    'Sauter sur tapis',
    'sauttapicase':                  'Sauts sur tapis / cases',

    // Band 2 (7-10 ans)
    'placercheville':                'Placer des chevilles',
    'chevillemainpreferee':          'Placer des chevilles',
    'pegpreferredhand':              'Placer des chevilles',
    'chevillemainprefereepegboardpreferredhand': 'Placer des chevilles',
    'enfilerunecordelettejeton':     'Enfiler une cordelette / jetons',
    'enfilercordelette':             'Enfiler une cordelette / jetons',
    'attraperuneballe':              'Attraper une balle',
    'catching2hand':                 'Attraper avec 2 mains',
    'attraper2maincatching2hand':    'Attraper avec 2 mains',
    'lancercible':                   'Lancer sur cible',
    'lancerunsacgraincible':         'Lancer un sac de grains sur cible',

    // Band 3 (11-16 ans)
    'retournerchevillemainpreferee': 'M-ABC 2: Retourner chevilles - main préférée',
    'ecrouboulon':                   'M-ABC 2: Ecrous et boulons',
    'attraper1mainmeilleuremain':    'M-ABC 2: Attraper avec 1 main - meilleure main',
    'equilibre2planche':             'Équilibre sur 2 planches',

    // Composites
    'dexteritemanuelle':             'Dextérité Manuelle',
    'dextmanuelle':                  'Dextérité Manuelle',
    'dextman':                       'Dextérité Manuelle',
    'equilibre':                     'Équilibre',
    'viserattraper':                 'Viser et attraper',
    'viseereception':                'Visée et Réception',
    'lacetlacing':                   'Lacet (Lacing)',
  },

  // ──────────── NEPSY 2 ────────────
  'nepsy2': {
    'copiefigure':          'Copie de figure',
    'copie':                'Copie de figure',
    'cube':                 'Cubes',
    'fleche':               'Flèches',
    'fluiditedessin':       'Fluidité de dessin',
    'horloge':              'Horloge',
    'orientation':          'Orientation',
    'precisionvisuomotrice': 'Précision visuo-motrice',
    'precisionvisuo':       'Précision visuo-motrice',
  },

  // ──────────── Beery VMI ────────────
  'beeryvmi': {
    'integrationvisuomotrice': 'Intégration Visuo-Motrice',
    'vmi':                     'Intégration Visuo-Motrice',
    'ivm':                     'Intégration Visuo-Motrice',
    'perceptionvisuelle':      'Perception Visuelle',
    'coordinationmotrice':     'Coordination Motrice',
    'copie30formegeometrique': 'Copie de 30 formes géométriques',
    'appariementformeidentique': 'Appariement de formes identiques',
    'traceentredeuxlignechemin': 'Tracé entre deux lignes (chemins)',
  },

  // ──────────── BOT-2 ────────────
  'bot2': {
    'precisionmotricefine':   'Précision Motrice Fine',
    'integrationmotricefine': 'Intégration Motrice Fine',
    'dexteritemanuelle':      'Dextérité Manuelle',
    'dextmanuelle':           'Dextérité Manuelle',
    'coordinationbilaterale': 'Coordination Bilatérale',
    'equilibre':              'Équilibre',
    'vitesseagilite':         'Vitesse et Agilité',
    'coordinationmembresuperieur': 'Coordination Membres Supérieurs',
    'force':                  'Force',
  },

  // ──────────── BRIEF-2 ────────────
  'brief2': {
    'inhibition':              'Inhibition',
    'flexibilite':             'Flexibilité',
    'controleemotionnel':      'Contrôle Émotionnel',
    'autosurveillance':        'Auto-surveillance',
    'memoiretravail':          'Mémoire de travail',
    'planificationorganisation': 'Planification/Organisation',
    'regulationcognitive':     'Régulation Cognitive',
    'regulationcomportementale': 'Régulation Comportementale',
    'regulationemotionnelle':  'Régulation Émotionnelle',
  },

  // ──────────── DTVP-2 ────────────
  'dtvp2': {
    'coordinationoeilmain':   'Coordination Oeil Main',
    'copiefigure':            'Copie De Figures',
    'figurefond':             'Figure fond',
    'constanceforme':         'Constance De Forme',
    'closurevisuelle':        'Closures Visuelles',
    'positiondanlespace':     'Position Dans l\'Espace',
    'precisionvisuomotrice':  'Précision Visuo-Motrice',
    'relationspatiale':       'Relations Spatiales',
  },

  // ──────────── DTVP-3 ────────────
  'dtvp3': {
    'coordinationoeilmain':   'Coordination Oeil-Main',
    'copieforme':             'Copie de formes',
    'figurefond':             'Figure-Fond',
    'constanceforme':         'Constance de la Forme',
    'cloturevisuelle':        'Clôture Visuelle',
  },

  // ──────────── BHK ────────────
  'bhk': {
    'qualite':         'Qualité',
    'vitesse':         'Vitesse',
    'scoretotal':      'Score Total Dysgraphie',
    'dysgraphie':      'Score Total Dysgraphie',
    'total':           'Score Total Dysgraphie',
    'quality':         'Qualité',
    'speed':           'Vitesse',
    'writingspeed':    'Vitesse',
    'writingquality':  'Qualité',
  },

  // ──────────── BHK Ado ────────────
  'bhkadolescent': {
    'qualite':         'Qualité',
    'vitesse':         'Vitesse',
    'quality':         'Qualité',
    'speed':           'Vitesse',
  },

  // ──────────── Profil Sensoriel 2 (Dunn) ────────────
  'profilsensoriel2dunn': {
    'auditif':              'Auditif',
    'tactile':              'Tactile',
    'visuel':               'Visuel',
    'oral':                 'Oral',
    'vestibulaire':         'Vestibulaire',
    'proprioceptif':        'Proprioceptif',
    'recherche':            'Recherche',
    'evitement':            'Évitement',
    'sensibilite':          'Sensibilité',
    'faibleenregistrement': 'Faible Enregistrement',
    'registration':         'Faible Enregistrement',
    'seeking':              'Recherche',
    'avoiding':             'Évitement',
    'sensitivity':          'Sensibilité',
    'mouvement':            'Mouvement',
    'positioncorp':         'Position du corps',
    'conduite':             'Conduite',
    'socioemotionnel':      'Socio-émotionnel',
    'attentionnel':         'Attentionnel',
    'auditory':             'Auditif',
    'visual':               'Visuel',
  },

  // ──────────── NP-MOT ────────────
  'npmot': {
    'tonupassif':             'Tonus passif',
    'tonuactif':              'Tonus actif',
    'lateralite':             'Latéralité',
    'gnosiedigitale':         'Gnosies digitales',
    'praxiemanuelle':         'Praxies manuelles',
    'habileteoculomanuelle':  'Habileté oculomanuelle',
    'adaptationposturale':    'Adaptation posturale',
    'locomotion':             'Locomotion',
    'equilibrestatique':      'Équilibre statique',
    'equilibredynamique':     'Équilibre dynamique',
    'rythme':                 'Rythme',
    'attentionauditive':      'Attention auditive',
    'orientationspatiale':    'Orientation spatiale',
  },

  // ──────────── Figure de Rey ────────────
  'figurecomplexerey': {
    'copierichesse':          'Copie - Richesse',
    'copietemps':             'Copie - Temps',
    'copietype':              'Copie - Type de reproduction',
    'memoirerichesse':        'Mémoire - Richesse',
    'memoiretemps':           'Mémoire - Temps',
    'memoiretype':            'Mémoire - Type',
    'copie':                  'Copie - Richesse',
    'memoire':                'Mémoire - Richesse',
    'rappel':                 'Mémoire - Richesse',
    'richesse':               'Copie - Richesse',
    'reproduction':           'Mémoire - Richesse',
    'typereproduction':       'Copie - Type de reproduction',
  },

  // ──────────── Charlop-Atwell ────────────
  'echellecharlopatwell': {
    'identificationobjet':    'Identification d\'objets',
    'creationobjet':          'Création d\'objets',
    'reproductionmodele':     'Reproduction de modèles',
    'graphoperceptif':        'Grapho-perceptif',
    'scoretotal':             'Score Total',
    'total':                  'Score Total',
  },

  // ──────────── MVPT-4 ────────────
  'mvpt4': {
    'discriminationvisuelle':  'Discrimination visuelle',
    'visualdiscrimination':    'Discrimination visuelle',
    'relationspatiale':        'Relations spatiales',
    'spatialrelationship':     'Relations spatiales',
    'memoirevisuelle':         'Mémoire visuelle',
    'visualmemory':            'Mémoire visuelle',
    'figurefond':              'Figure-Fond',
    'figureground':            'Figure-Fond',
    'cloturevisuelle':         'Clôture visuelle',
    'visualclosure':           'Clôture visuelle',
    'total':                   'Score Total',
  },

  // ──────────── TEA-Ch ────────────
  'teach': {
    'rechercheciel':              'Recherche dans le ciel',
    'skysearch':                  'Recherche dans le ciel',
    'coupfusil':                  'Les coups de fusil',
    'scorecounting':              'Les coups de fusil',
    'petithommvert':              'Les petits hommes verts',
    'creaturecount':              'Les petits hommes verts',
    'mondecontraire':             'Monde à l\'envers',
    'oppositeworld':              'Monde à l\'envers',
    'marchearret':                'Marche/Arrêt',
    'walkdontwalk':               'Marche/Arrêt',
    'fairedeuxchose':             'Faire deux choses à la fois',
    'doingtwothings':             'Faire deux choses à la fois',
    'cartegeographique':          'Carte géographique',
    'mapmission':                 'Carte géographique',
    'ecouterdeuxchose':           'Écouter deux choses à la fois',
    'monde':                      'Les mondes',
  },

  // ──────────── Purdue Pegboard ────────────
  'purduepegboard': {
    'maindominante':              'Main dominante',
    'mainnondominante':           'Main non dominante',
    'bilateral':                  'Bilatéral',
    'assemblage':                 'Assemblage',
    'dominant':                   'Main dominante',
    'nondominant':                'Main non dominante',
    'bothhand':                   'Bilatéral',
    'assembly':                   'Assemblage',
    'preferredhand':              'Main dominante',
    'nonpreferredhand':           'Main non dominante',
  },

  // ──────────── DTVP-A ────────────
  'dtvpa': {
    'copie':                      'Copie',
    'copieforme':                 'Copie',
    'copying':                    'Copie',
    'figurefond':                 'Figure-Fond',
    'figureground':               'Figure-Fond',
    'recherchevisuomotrice':      'Recherche visuo-motrice',
    'visualmotorsearch':          'Recherche visuo-motrice',
    'fermeturevisuelle':          'Fermeture Visuelle',
    'cloturevisuelle':            'Fermeture Visuelle',
    'visualclosure':              'Fermeture Visuelle',
    'constanceforme':             'Constance de la forme',
    'formconstancy':              'Constance de la forme',
    'vitessevisuomotrice':        'Vitesse visuo-motrice',
    'visualmotorspeed':           'Vitesse visuo-motrice',
    'sommede3soustests':          'Somme de 3 sous-tests',
    'sommede6soustests':          'Somme de 6 sous-tests',
  },

  // ──────────── WISC-V ────────────
  'wiscvsoustestvisuospatiaux': {
    'cube':                       'Cubes',
    'blockdesign':                'Cubes',
    'puzzlevisuel':               'Puzzles visuels',
    'visualpuzzle':               'Puzzles visuels',
    'code':                       'Code',
    'coding':                     'Code',
    'symbole':                    'Symboles',
    'symbolsearch':               'Symboles',
    'barrage':                    'Barrage',
    'cancellation':               'Barrage',
  },

  // ──────────── EGP ────────────
  'egp': {
    'mobilisationarticulaire':    'Mobilisation articulaire',
    'praxiegestuelle':            'Praxies gestuelles',
    'prehension':                 'Préhension',
    'coordinationbimanuelle':     'Coordination bimanuelle',
    'equilibrestatique':          'Équilibre statique',
    'equilibredynamique':         'Équilibre dynamique',
    'locomotion':                 'Locomotion',
    'memoireverbale':             'Mémoire verbale',
    'orientationspatiale':        'Orientation spatiale et temporelle',
    'vigilance':                  'Vigilance',
    'perception':                 'Perception',
    'schemacorporel':             'Schéma corporel',
    'communication':              'Communication',
    'ecrituredessin':             'Écriture et dessin',
  },

  // ──────────── AMPS ────────────
  'amp': {
    'habiletemotrice':            'Habiletés motrices',
    'motorskill':                 'Habiletés motrices',
    'habileteprocessu':           'Habiletés de processus',
    'processskill':               'Habiletés de processus',
  },

  // ──────────── Frostig ────────────
  'frostigdtvp': {
    'coordinationoeilmain':       'Coordination Oeil-Main',
    'figurefond':                 'Figure-Fond',
    'constanceforme':             'Constance de la Forme',
    'positionespace':             'Position dans l\'Espace',
    'relationspatiale':           'Relations Spatiales',
  },
};

export const resolveSubtestAlias = (testName: string, subtestName: string): string => {
  const trimmed = subtestName.trim();
  if (!testName || !trimmed) return trimmed;

  const testKey = normalizeTestName(testName);
  const aliasTable = SUBTEST_ALIASES[testKey];
  if (!aliasTable) return trimmed;

  const aliasKey = normalizeSubtestName(trimmed);
  return aliasTable[aliasKey] || trimmed;
};
