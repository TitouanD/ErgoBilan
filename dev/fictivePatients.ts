/**
 * fictivePatients.ts — credible fictitious patients for the dev scenarios
 * (dev/scenarios.ts) and the component tests. Development only: never
 * imported by the production build.
 *
 * Every patient has the last name FICTIF, which is how « Purger les fictifs »
 * finds them. Each profile fills the step 1 required fields (utils/patient.ts
 * isAdministrativeSectionReady) and lists the tests a practitioner would
 * plausibly give for its reason, with the subtests of the child's age band.
 * `level` shifts the scores (z) around the reason: a struggling child
 * stays mostly in the fragile/deficit zones.
 */

import type { Patient } from '../types';
import { initialPatient } from '../utils/assessmentInProgress';
import { CUSTOM_OBSERVATIONS_TEST_ID } from '../utils/catalogIndex';

export const FICTIF_LAST_NAME = 'FICTIF';

export interface FictiveTest {
  testId: string;
  /** Subtests to fill; all subtests of the test when omitted. */
  subtests?: string[];
}

export interface FictiveProfile {
  id: string;
  patient: Patient;
  tests: FictiveTest[];
  /** Mean z of the scores (negative: difficulties). */
  level: number;
  /** Clinical interview notes (step 1), fed to the AI in real use. */
  notes: string;
}

const MABC2_BAND2: FictiveTest = {
  testId: 'mabc-2',
  subtests: [
    'mabc-2__pegs-preferred',
    'mabc-2__pegs-non-preferred',
    'mabc-2__lacing',
    'mabc-2__trail-band2',
    'mabc-2__catch-two-hands',
    'mabc-2__throw-bag-mat',
    'mabc-2__balance-board-best',
    'mabc-2__balance-board-other',
    'mabc-2__heel-to-toe-forward',
    'mabc-2__hop-mat-one-leg',
    'mabc-2__hop-mat-other-leg',
    'mabc-2__manual-dexterity-total',
    'mabc-2__aiming-catching-total',
    'mabc-2__balance-composite',
    'mabc-2__total-score',
  ],
};

const MABC2_BAND1: FictiveTest = {
  testId: 'mabc-2',
  subtests: [
    'mabc-2__coin-pref',
    'mabc-2__coin-non-pref',
    'mabc-2__bead-threading',
    'mabc-2__trail-band1',
    'mabc-2__catch-bag',
    'mabc-2__throw-bag',
    'mabc-2__balance-one-leg-best',
    'mabc-2__balance-one-leg-other',
    'mabc-2__tiptoe-walk',
    'mabc-2__mat-jump',
    'mabc-2__manual-dexterity-total',
    'mabc-2__aiming-catching-total',
    'mabc-2__balance-composite',
    'mabc-2__total-score',
  ],
};

const patient = (fields: Partial<Patient> & Pick<Patient, 'firstName' | 'dob' | 'gender' | 'reason'>): Patient => ({
  ...initialPatient,
  lastName: FICTIF_LAST_NAME,
  ...fields,
});

export const FICTIVE_PROFILES: FictiveProfile[] = [
  {
    id: 'leo',
    level: -1.3,
    tests: [{ testId: 'bhk' }, { testId: 'beery-vmi' }, MABC2_BAND2, { testId: CUSTOM_OBSERVATIONS_TEST_ID }],
    notes: 'Prise tripode crispée, forte pression sur le crayon. Se plaint de douleurs au poignet après une page.',
    patient: patient({
      firstName: 'Léo',
      dob: '2018-03-14',
      gender: 'M',
      parent1Name: 'Claire FICTIF',
      parent1Phone: '06 00 00 00 01',
      parent1Email: 'claire.fictif@example.com',
      prescribingDoctor: 'Dr Morel',
      prescribingDoctorProfession: 'Pédiatre',
      school: 'École Jules Ferry',
      classLevel: 'CE2',
      reason: "Écriture lente et peu lisible, douleurs à la main lors des copies. L'enseignante signale une fatigue importante à l'écrit.",
      familyExpectations: "Qu'il écrive sans avoir mal et qu'il reprenne confiance.",
    }),
  },
  {
    id: 'ines',
    level: -1.8,
    tests: [MABC2_BAND2, { testId: 'dcdq-f' }, { testId: 'bhk' }],
    notes: 'Maladresse globale, difficultés à attraper la balle, équilibre précaire sur la planche.',
    patient: patient({
      firstName: 'Inès',
      dob: '2016-11-02',
      gender: 'F',
      parent1Name: 'Karim FICTIF',
      parent1Phone: '06 00 00 00 02',
      parent2Name: 'Sophie FICTIF',
      parent2Email: 'sophie.fictif@example.com',
      medicalDiagnosis: 'Trouble développemental de la coordination (TDC)',
      prescribingDoctor: 'Dr Lambert',
      prescribingDoctorProfession: 'Neuropédiatre',
      school: 'École du Parc',
      classLevel: 'CM2',
      reason: 'TDC diagnostiqué : maladresse, difficultés en EPS et dans les gestes du quotidien (lacets, couverts).',
      familyExpectations: 'Gagner en autonomie avant le collège.',
    }),
  },
  {
    id: 'noah',
    level: -0.9,
    tests: [{ testId: 'pdms-2' }, { testId: 'dtvp-3' }, MABC2_BAND1],
    notes: 'Tenue du crayon immature (prise palmaire), découpage difficile, coloriage qui déborde.',
    patient: patient({
      firstName: 'Noah',
      dob: '2021-01-20',
      gender: 'M',
      parent1Name: 'Julie FICTIF',
      parent1Phone: '06 00 00 00 03',
      prescribingDoctor: 'Dr Petit',
      prescribingDoctorProfession: 'Médecin généraliste',
      school: 'École maternelle Les Tilleuls',
      classLevel: 'GS',
      reason: 'Retard en motricité fine et en graphisme signalé par la maîtresse de grande section.',
      familyExpectations: 'Être prêt pour le CP.',
    }),
  },
  {
    id: 'chloe',
    level: -1.1,
    tests: [{ testId: 'bhk-ado' }, { testId: 'brief-2' }, { testId: 'figure-rey' }, { testId: 'tea-ch' }],
    notes: 'Organisation de la feuille très difficile, oublis fréquents de consignes, lenteur en copie.',
    patient: patient({
      firstName: 'Chloé',
      dob: '2014-06-08',
      gender: 'F',
      parent1Name: 'Nathalie FICTIF',
      parent1Email: 'nathalie.fictif@example.com',
      medicalDiagnosis: 'TDAH',
      medicalTreatments: 'Méthylphénidate',
      prescribingDoctor: 'Dr Garnier',
      prescribingDoctorProfession: 'Pédopsychiatre',
      school: 'Collège Victor Hugo',
      classLevel: '5e',
      reason: "Lenteur et désorganisation à l'écrit, difficultés à suivre le rythme des prises de notes au collège.",
      familyExpectations: 'Mettre en place un ordinateur en classe si besoin.',
    }),
  },
  {
    id: 'adam',
    level: -1.5,
    tests: [{ testId: 'profil-sensoriel-2' }, { testId: 'vineland-3' }],
    notes: 'Se bouche les oreilles à la cantine, refuse certaines textures, recherche de mouvement en classe.',
    patient: patient({
      firstName: 'Adam',
      dob: '2019-09-30',
      gender: 'M',
      parent1Name: 'Mehdi FICTIF',
      parent1Phone: '06 00 00 00 05',
      medicalDiagnosis: "Trouble du spectre de l'autisme (TSA)",
      prescribingDoctor: 'Dr Roux',
      prescribingDoctorProfession: 'Pédopsychiatre',
      school: 'École Pasteur',
      classLevel: 'CE1',
      reason: "Particularités sensorielles gênantes en classe et à la maison, autonomie limitée pour l'habillage et les repas.",
      familyExpectations: 'Des repas et un habillage plus sereins.',
    }),
  },
  {
    id: 'lina',
    level: -1.2,
    tests: [{ testId: 'bhk' }, { testId: 'dtvp-2' }],
    notes: 'Lettres mal formées, irrégularité de la taille, bonne volonté mais fatigabilité.',
    patient: patient({
      firstName: 'Lina',
      dob: '2017-05-12',
      gender: 'F',
      parent1Name: 'Amélie FICTIF',
      parent1Phone: '06 00 00 00 06',
      prescribingDoctor: 'Dr Morel',
      prescribingDoctorProfession: 'Pédiatre',
      school: 'École Jules Ferry',
      classLevel: 'CM1',
      reason: 'Dysgraphie : écriture irrégulière et coûteuse, suivi en ergothérapie depuis un an.',
      familyExpectations: "Continuer les progrès à l'écrit.",
    }),
  },
];

export const getFictiveProfile = (id: string | null | undefined): FictiveProfile | undefined => FICTIVE_PROFILES.find((p) => p.id === id);

export const isFictivePatient = (p: Pick<Patient, 'lastName'>): boolean => p.lastName?.trim().toUpperCase() === FICTIF_LAST_NAME;
