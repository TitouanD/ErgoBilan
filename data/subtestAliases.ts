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
    'enfilercube':                   'Enfiler les cubes',
    'enfilercubemain1meilleur':      'Enfiler les cubes',
    'tracedunchemin':                'Suivre le trajet 1',
    'trace':                         'Suivre le trajet 1',
    'trajet1':                       'Trajet 1',
    'trajet3':                       'Trajet 3',
    'path2error':                    'Trajet 1',
    'attrapersac':                   'Attraper le sac',
    'lancersac':                     'Lancer le sac',
    'equilibrestatique':             'Équilibre statique (une jambe)',
    'equilibrestatiqueunejambe':     'Équilibre statique (une jambe)',
    'equilibre1jambemeilleurejambe': 'Équilibre sur 1 jambe meilleure jambe',
    'equilibre1jambeautrejambe':     'Équilibre sur 1 jambe autre jambe',
    'marchetalonpointe':             'Marche talon-pointe',
    'marcherpointepied':             'Marcher sur pointe',
    'sautertapi':                    'Sauter sur tapis',
    'sauttapicase':                  'Sauts sur tapis / cases',

    // Band 2 (7-10 ans)
    'placercheville':                'Chevilles main préférée',
    'chevillemainpreferee':          'Chevilles main préférée',
    'pegpreferredhand':              'Chevilles main préférée',
    'chevillemainprefereepegboardpreferredhand': 'Chevilles main préférée',
    'enfilerunecordelettejeton':     'Enfiler le lacet',
    'enfilercordelette':             'Enfiler le lacet',
    'attraperuneballe':              'Attraper une balle',
    'catching2hand':                 'Attraper avec 2 mains',
    'attraper2maincatching2hand':    'Attraper avec 2 mains',
    'lancercible':                   'Lancer la balle sur la cible',
    'lancerunsacgraincible':         'Lancer la balle sur la cible',

    // Band 3 (11-16 ans)
    'retournerchevillemainpreferee': 'Retourner les chevilles main préférée',
    'retournerchevillemainnonpreferee': 'Retourner les chevilles main non préférée',
    'ecrouboulon':                   'Triangle avec écrous et boulon',
    'attraper1mainmeilleuremain':    'Attraper à une main main préférée',
    'equilibre2planche':             'Équilibre sur deux planches',
    'equilibresuruneplanchejambemeilleurejambe': 'Équilibre sur une planche jambe meilleure jambe',
    'equilibresuruneplanchejambeautrejambe': 'Équilibre sur une planche jambe autre jambe',
    'marchertalonpointeenavant':     'Marcher talon pointe en avant',
    'marchertalonpointeareculons':   'Marcher talon pointe à reculons',
    'sauteraclochepiedsurtapis':     'Sauter à cloche pied sur tapis',
    'sauterenzigzag':                'Sauter en zig-zag',
    'attraperaunemainmainnonpreferee':'Attraper à une main main non préférée',

    // Composites
    'dexteritemanuelle':             'Note totale dextérité manuelle',
    'dextmanuelle':                  'Note totale dextérité manuelle',
    'dextman':                       'Note totale dextérité manuelle',
    'equilibre':                     'Note totale Équilibre',
    'viserattraper':                 'Note totale viser et attraper',
    'viseereception':                'Visée et Réception',
    'lacetlacing':                   'Lacet (Lacing)',
  },

  // ──────────── NEPSY 2 ────────────
  'nepsy2': {
    // Attention et fonctions exécutives
    'aa':                           'Attention auditive',
    'attentionauditive':            'Attention auditive',
    'attentionauditivereponsesassociees': 'Attention auditive',
    'reponsesassociees':            'Attention auditive',
    'categorisation':               'Catégorisation',
    'trianimaux':                   'Catégorisation',
    'animalsorting':                'Catégorisation',
    'fd':                           'Fluidité de dessin',
    'fluiditedessin':               'Fluidité de dessin',
    'fluiditedeconception':         'Fluidité de dessin',
    'designfluency':                'Fluidité de dessin',
    'inhibition':                   'Inhibition',
    'inhibitiondenomination':       'Inhibition',
    'inhibitiondenominationtemps':  'Inhibition',
    'inhibitiontemps':              'Inhibition',
    'in':                           'Inhibition',
    'st':                           'Statue',
    'statue':                       'Statue',

    // Langage
    'cc':                           'Compréhension de consignes',
    'comprehensiondeconsignes':     'Compréhension de consignes',
    'comprehensionconsigne':        'Compréhension de consignes',
    'dr':                           'Dénomination rapide',
    'denominationrapide':           'Dénomination rapide',
    'speedednaing':                 'Dénomination rapide',
    'speedednaming':                'Dénomination rapide',
    'phonologie':                   'Phonologie',
    'traitementphonologique':       'Phonologie',
    'ph':                           'Phonologie',
    'pm':                           'Production de mots',
    'productiondemots':             'Production de mots',
    'fluenceverbale':               'Production de mots',
    'wordgeneration':               'Production de mots',
    'rp':                           'Répétition de phrases',
    'repetitiondephrases':          'Répétition de phrases',
    'repetitionphrase':             'Répétition de phrases',

    // Mémoire et apprentissages
    'mf':                           'Mémoire de figures',
    'memoiredefigure':              'Mémoire de figures',
    'memoiredefigures':             'Mémoire de figures',
    'ml':                           'Mémoire de liste',
    'memoiredeliste':               'Mémoire de liste',
    'memoireliste':                 'Mémoire de liste',
    'mn':                           'Mémoire narrative',
    'memoirenarrative':             'Mémoire narrative',
    'md':                           'Mémoire des prénoms',
    'memoiredesnoms':               'Mémoire des prénoms',
    'memoireprenom':                'Mémoire des prénoms',
    'memoryforname':                'Mémoire des prénoms',
    'mv':                           'Mémoire des visages',
    'memoiredesvisages':            'Mémoire des visages',
    'ilm':                          'Interférence de liste de mots',
    'interferencedelistedemots':    'Interférence de liste de mots',
    'interferencemot':              'Interférence de liste de mots',
    'wordlistinterference':         'Interférence de liste de mots',

    // Fonctions sensorimotrices
    'ip':                           'Imitation de positions de mains',
    'imitationpositionmain':        'Imitation de positions de mains',
    'imitationdepositionsdemain':   'Imitation de positions de mains',
    'precisionvisuomotrice':        'Précision visuomotrice',
    'precisionvisuo':               'Précision visuomotrice',
    'pv':                           'Précision visuomotrice',
    'sm':                           'Séquences motrices manuelles',
    'sequencesmotricesmanuelles':   'Séquences motrices manuelles',
    'sequencemotrice':              'Séquences motrices manuelles',
    'td':                           'Tapotement des doigts',
    'tapotementdesdoigts':          'Tapotement des doigts',
    'tapotementdoigt':              'Tapotement des doigts',
    'fingertapping':                'Tapotement des doigts',

    // Traitements visuospatiaux
    'cb':                           'Cubes',
    'constructionaveccubes':        'Cubes',
    'constructioncube':             'Cubes',
    'cube':                         'Cubes',
    'cf':                           'Copie de figures',
    'copiefigure':                  'Copie de figures',
    'copie':                        'Copie de figures',
    'copiedefigure':                'Copie de figures',
    'fl':                           'Flèches',
    'fleche':                       'Flèches',
    'arrows':                       'Flèches',
    'horloge':                      'Horloges',
    'orientation':                  'Orientation',
    'or':                           'Orientation',
    'pt':                           'Puzzles géométriques',
    'puzzles':                      'Puzzles géométriques',
    'puzzlesscoretotal':            'Puzzles géométriques',
    'pi':                           'Puzzles d\'images',
    'puzzlesdimages':               'Puzzles d\'images',
    'puzzlesimage':                 'Puzzles d\'images',
    'pg':                           'Puzzles géométriques',
    'puzzlesgeometrique':           'Puzzles géométriques',
    'puzzlesgeometriques':          'Puzzles géométriques',
    'ri':                           'Orientation',
    'rechercheditineraire':         'Orientation',
    'routefinding':                 'Orientation',

    // Perception sociale
    'ra':                           'Reconnaissance des affects',
    'reconnaissancedesaffects':     'Reconnaissance des affects',
    'reconnaissanceaffect':         'Reconnaissance des affects',
    'affectrecognition':            'Reconnaissance des affects',
    'te':                           'Théorie de l\'esprit',
    'theoriedelesprit':             'Théorie de l\'esprit',
    'theoryofmind':                 'Théorie de l\'esprit',
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
    'copiedumodele':          'Copie du modèle',
    'typecopie':              'Type de copie',
    'richesseexactitudecopie':'Richesse et exactitude de la copie',
    'tempscopie':             'Temps de copie',
    'reproductionmemoire':    'Reproduction de mémoire',
    'typereproduction':       'Type de reproduction',
    'richesseexactitudereproduction': 'Richesse et exactitude de la reproduction',
    'copie':                  'Copie du modèle',
    'memoire':                'Reproduction de mémoire',
    'rappel':                 'Reproduction de mémoire',
    'reproduction':           'Reproduction de mémoire',
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
    'copie':                      'Subtest 1, Copying (Copie)',
    'copieforme':                 'Subtest 1, Copying (Copie)',
    'copying':                    'Subtest 1, Copying (Copie)',
    'figurefond':                 'Subtest 2, Figure-Ground (Figure-Fond)',
    'figureground':               'Subtest 2, Figure-Ground (Figure-Fond)',
    'recherchevisuomotrice':      'Subtest 3, Visual-Motor Search (Recherche visuo-motrice)',
    'visualmotorsearch':          'Subtest 3, Visual-Motor Search (Recherche visuo-motrice)',
    'fermeturevisuelle':          'Subtest 4, Visual Closure (Fermeture Visuelle)',
    'cloturevisuelle':            'Subtest 4, Visual Closure (Fermeture Visuelle)',
    'visualclosure':              'Subtest 4, Visual Closure (Fermeture Visuelle)',
    'constanceforme':             'Subtest 6, Form Constancy (Constance de la forme)',
    'formconstancy':              'Subtest 6, Form Constancy (Constance de la forme)',
    'vitessevisuomotrice':        'Subtest 5, Visual-Motor Speed (Vitesse visuo-motrice)',
    'visualmotorspeed':           'Subtest 5, Visual-Motor Speed (Vitesse visuo-motrice)',
    'sommede3soustests':          'Somme de 3 sous-tests',
    'sommede6soustests':          'Somme de 6 sous-tests',
  },

  // ──────────── Lespargot ────────────
  'lespargot': {
    'repetition':                 'Répétition',
    'dictee':                     'Dictée',
    'copie':                      'Copie',
    'scoreglobaltrace':           'Copie',
    'vitesseexecution':           'Répétition',
    'precisiontrace':             'Dictée',
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

type ResolveSubtestAliasOptions = {
  abbreviation?: string | null;
  domain?: string | null;
};

const normalizeAliasAbbreviation = (value?: string | null): string => (
  String(value || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9&/ -]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
);

export const resolveSubtestAlias = (
  testName: string,
  subtestName: string,
  options?: ResolveSubtestAliasOptions,
): string => {
  const trimmed = subtestName.trim();
  if (!testName || !trimmed) return trimmed;

  const testKey = normalizeTestName(testName);

  const aliasTable = SUBTEST_ALIASES[testKey];
  if (!aliasTable) return trimmed;

  const aliasKey = normalizeSubtestName(trimmed);
  return aliasTable[aliasKey] || trimmed;
};
