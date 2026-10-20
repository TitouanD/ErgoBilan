/**
 * retiredCatalog.ts — noms des tests et sous-tests retirés du catalogue officiel
 * après vérification contre les protocoles publiés (#50, #90 ; sources dans
 * docs/catalogue/). Un bilan local garde les scores saisis avant le retrait :
 * ils s'affichent sous ces noms (échelle `none`, voir `resolveTestDef`) plutôt
 * que sous un nom reconstruit à partir de l'identifiant.
 *
 * Ajouter ici chaque ligne qu'une migration retire du catalogue officiel.
 */

/** Tests officiels retirés, par identifiant. */
export const RETIRED_TEST_NAMES: Readonly<Record<string, string>> = {
  ozeretzki: "Découpage d'Ozeretzki",
};

/** Sous-tests officiels retirés, par identifiant (unique dans tout le catalogue). */
export const RETIRED_SUBTEST_NAMES: Readonly<Record<string, string>> = {
  // 20261001100300_catalogue_corrections.sql (#50)
  'test-cloches__omissions-gauche': 'Omissions hémichamp gauche',
  'test-cloches__omissions-droite': 'Omissions hémichamp droit',
  'nepsy-2__discrimination-digitale': 'Discrimination digitale',
  'nepsy-2__precision-motrice': 'Précision motrice',
  'alouette__indice-d-efficience-ctl': "Indice d'efficience (CTL)",
  tihm__shift: 'Shift (translation linéaire digitale)',
  tihm__rotation: 'Rotation simple',

  // 20261020200000_catalogue_douteux.sql (#90)
  'ozeretzki__decoupage-cercle': 'Temps de découpage, main dominante (secondes)',
  'ozeretzki__temps-main-non-dominante': 'Temps de découpage, main non dominante (secondes)',
  'ozeretzki__decoupage-qualite': 'Qualité de découpage',
  'reversal__nombre-d-inversions': "Nombre d'inversions",
  'nepsy-2__inhibition': 'Inhibition',
  'nepsy-2__tapotement-des-doigts': 'Tapotement des doigts',
  'moca__memory-score': 'Mémoire',
  'vineland-3__maladaptive-behavior': 'Comportements inadaptés (Maladaptive Behavior)',
  'brief-2__task-completion': 'Task-Completion',
  'mvpt-4__discrimination-visuelle': 'Discrimination visuelle',
  'mvpt-4__figure-fond': 'Figure-fond',
  'mvpt-4__m-moire-visuelle': 'Mémoire visuelle',
  'mvpt-4__closure-visuelle': 'Closure visuelle',
  'mvpt-4__relations-spatiales': 'Relations spatiales',
  'figure-rey__copie-modele': 'Copie du modèle',
  'figure-rey__reproduction-memoire': 'Reproduction de mémoire',
  'egp__equilibre-statique': 'Équilibre statique',
  'egp__equilibre-dynamique': 'Équilibre dynamique',
  'egp__communication-verbale': 'Communication verbale',
  'egp__communication-non-verbale': 'Communication non verbale',
  'bot-2__coloring': 'Coloriage',
  'bot-2__copy-complex': "Copie d'étoiles/figures complexes",
  'bot-2__copy-shapes': 'Copie de formes (cercles, carrés, losanges)',
  'bot-2__shuttle-run': 'Course navette',
  'bot-2__cutting': 'Découpage',
  'bot-2__dribbling': 'Dribbler une balle',
  'bot-2__beads': 'Enfiler des perles',
  'bot-2__throw-catch': 'Lancer/Attraper',
  'bot-2__folding': 'Pliage',
  'bot-2__pushups': 'Pompes',
  'bot-2__balance-beam': 'Poutre yeux ouverts/fermés',
  'bot-2__situps': 'Redressements assis',
  'bot-2__broad-jump': 'Saut en longueur',
  'bot-2__jumping-jacks': 'Sauts en étoile',
  'bot-2__side-hops': 'Sauts latéraux',
  'bot-2__line-stand': 'Station debout ligne droite',
  'bot-2__finger-tapping': 'Tapoter doigts/pieds simultanément',
  'bot-2__transfer': 'Transvaser des jetons',
  'bot-2__cards': 'Trier des cartes',
  'jebsen-taylor__writing': 'Écriture (main non précisée)',
  'jebsen-taylor__card-turning': 'Retournement de cartes (main non précisée)',
  'jebsen-taylor__small-objects': 'Petits objets communs (main non précisée)',
  'jebsen-taylor__feeding': 'Alimentation simulée (main non précisée)',
  'jebsen-taylor__checkers': 'Empilement de jetons (main non précisée)',
  'jebsen-taylor__large-light': 'Grands objets légers (main non précisée)',
  'jebsen-taylor__large-heavy': 'Grands objets lourds (main non précisée)',
};
