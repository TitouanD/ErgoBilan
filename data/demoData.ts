
import type { Patient, TestData, Observations } from '../types';

export const DEMO_PATIENTS = {
  LEO: {
    id: 'demo-leo',
    patient: {
      firstName: 'Elya',
      lastName: 'RAVEL',
      dob: '2018-10-12',
      age: '7 ans',
      gender: 'F',
      address: '18 Rue des Amandiers, 44100 Nantes',
      parentNames: 'Mme Ravel',
      parentPhone: '06 11 22 33 44',
      parentEmail: 'famille.ravel@example.com',
      guardArrangement: 'Garde exclusive',
      guardMode: 'Domicile',
      siblings: [
        { firstName: 'Nino', age: '10 ans', relation: 'Frère', livesWithChild: true },
        { firstName: 'Mila', age: '8 ans', relation: 'Demi-soeur', livesWithChild: false },
      ],
      school: 'École des Tilleuls',
      classLevel: 'CE1',
      teacher: 'Mme Leroux',
      carePlan: 'PAP en discussion',
      avs: 'NON',
      avsDetails: '',
      prescribingDoctor: 'Dr. Giraud',
      medicalDiagnosis: "Difficultes d'organisation et de concentration",
      medicalTreatments: 'Aucun',
      medicalFollowup: '',
      medicalTracking: [
        { id: 'demo-track-1', type: 'Orthophoniste', name: 'Mme A.', frequency: '1x/semaine', since: '08/2025', contact: '', reason: 'Dyslexie' },
        { id: 'demo-track-2', type: 'Orthoptiste', name: 'Mme C.', frequency: '1x/semaine (10 seances)', since: '12/2024', contact: '', reason: 'Vision haut/bas, lateralite' },
        { id: 'demo-track-3', type: 'Psychologue', name: 'M. L.', frequency: 'Bilan en cours', since: '01/2026', contact: '', reason: 'Question d\'un TDA' },
      ],
      reason: 'Difficultes de concentration, lenteur et ecriture couteuse.',
      familyExpectations: "Comprendre l'origine des difficultes et aider a gagner en aisance a l'ecrit.",
      pregnancyBirth: 'RAS',
      developmentMotor: 'Bon developpement global. Besoin de bouger, pratique gymnastique et boxe.',
      developmentLanguage: 'Debut tardif vers 3 ans, inversions de syllabes.',
      walkingAge: '14 mois',
      crawling: '4 pattes vers 9 mois',
      cleanliness: 'Acquise avant 2 ans',
      languageStatus: 'Tardif',
      sleep: 'Difficile jusqu\'a 3 ans et demi, puis stable. Fatigable.',
      sleepStatus: 'Sommeil regulier, endormissement lent',
      sensory: 'Pas de particularite notable',
      meals: 'Autonome mais lente, se leve souvent, parle beaucoup.',
      eatingHabits: 'Peu de selectivite',
      dressing: 'Autonome mais lente, agitation.',
      clothingButtons: 'Coutant',
      clothingLaces: 'Non acquis',
      clothingZippers: 'Acquis',
      continence: 'Ok',
      timeSpace: "Difficulte a se reperer dans le temps, besoin d'un timer.",
      schoolAttention: "Calme mais lente, se perd quand l'environnement est bruyant.",
      socialBehavior: 'Relations difficiles, tendance a se devaloriser.',
      writingIssues: 'Ecriture lente, prise du crayon couteuse, lisibilite variable.',
      writingPain: 'Fatigue rapide, tension au poignet',
      toolUsage: 'Regle souvent de travers, ciseaux mal utilises (gauchere).',
      toolScissors: 'Gauchere, tenue instable',
      handDominance: 'Gauchere',
      schoolAccommodations: 'Photocopies en couleur avec syllabes segmentees',
      remarks: 'Utilise un timer pour mieux se repere dans le temps',
      priorities: 'Clarifier les difficultes et proposer des adaptations scolaires',
      goals: [
        'Evaluer les difficultes d\'ecriture et de vitesse',
        'Identifier les adaptations qui soulagent la charge cognitive',
        'Redonner confiance a l\'ecrit',
      ],
      interviewNotes: "Enfant volontaire, mais se decourage vite. Besoin de bouger entre les taches.",
      screenTime: '30-45 min/jour',
      emotionalRegulation: 'Se devalorise, frustration rapide'
    } as Patient,
    tests: {
      'test-cloches': {
        'cloches-barrees': { raw: '28', standard: '9', percentile: '25', zScore: -0.7, status: 'validated', observation: 'Repere les distracteurs, mais rythme irregulier.' }
      },
      'mabc-2': {
        'manual-dexterity': { raw: '7', standard: '6', percentile: '9', zScore: -1.4, status: 'validated', observation: 'Lenteur et manque de fluidite.' },
        'ball-skills': { raw: '9', standard: '8', percentile: '25', zScore: -0.7, status: 'validated', observation: 'Bonne comprehension, execution prudente.' },
        'balance': { raw: '6', standard: '5', percentile: '5', zScore: -1.6, status: 'validated', observation: 'Instabilite a la fatigue.' }
      },
      'bhk': {
        'vitesse': { raw: '95', standard: '', percentile: '10', zScore: -1.3, status: 'validated', observation: 'Lenteur avec pauses frequentes.' },
        'qualite': { raw: '18', standard: '', percentile: '4', zScore: -1.8, status: 'validated', observation: 'Tension de la main, irregularites.' }
      }
    } as TestData,
    observations: {
      anamnese: "Enfant motivee, mais vite decouragee. Tension quand la tache dure.",
      motricite: "Besoin de bouger, endurance limitee sur taches fines.",
      coordination: "Bimanuel couteux (regle, ciseaux).",
      spatial: "Copie lente, se perd en presence de distracteurs.",
      graphique: "Pression forte sur le stylo, fatigabilite rapide."
    } as Observations
  },
  SARAH: {
    id: 'demo-sarah',
    patient: {
        firstName: 'Sarah',
        lastName: 'DUBOIS',
        dob: '2018-06-20',
        age: '6 ans 10 mois',
        gender: 'F',
        address: '5 Rue des Ecoles, 33000 Bordeaux',
        parentNames: 'M. Dubois',
        parentPhone: '06 55 66 77 88',
        parentEmail: 'famille.dubois@example.com',
      guardArrangement: 'Garde alternee',
      guardMode: 'Domicile',
      siblings: [],
        school: 'École Victor Hugo',
        classLevel: 'CP',
        teacher: 'M. Lecomte',
        carePlan: 'PAI en cours',
        avs: 'NON',
        avsDetails: '',
        prescribingDoctor: 'Pediatre',
        medicalDiagnosis: 'Suspicion dysgraphie',
        medicalTreatments: 'Aucun',
        medicalFollowup: 'Suivi orthophonique ponctuel',
        medicalTracking: [
          { id: 'demo-sarah-track-1', type: 'Orthophoniste', name: 'Mme D.', frequency: '1x/semaine', since: '11/2025', contact: '', reason: 'Lecture et orthographe' },
        ],
        reason: "Difficulte d'ecriture, lenteur et evitemment de la tache ecrite.",
        familyExpectations: "Gagner en aisance et en confiance a l'ecrit.",
        pregnancyBirth: 'RAS',
        developmentMotor: 'Motricite globale dans la moyenne.',
        developmentLanguage: 'RAS',
        walkingAge: '13 mois',
        cleanliness: 'Acquise vers 2 ans',
        sleep: 'Sommeil regulier, endormissement lent',
        sleepStatus: 'Fatigabilite en fin de journee',
        sensory: 'Hypersensibilite au bruit en classe',
        meals: 'Autonome',
        dressing: 'Autonome, lenteur sur les boutons',
        clothingButtons: 'Coutant',
        clothingLaces: 'Non acquis',
        clothingZippers: 'Acquis',
        continence: 'Ok',
        timeSpace: 'Besoin de reperes visuels pour se situer dans le temps',
        schoolAttention: "Correcte, mais decrochage lors des taches longues.",
        socialBehavior: 'Sociable, mais s isole quand elle se sent en difficulte',
        writingIssues: 'Crispation, douleurs, taille des lettres variable.',
        writingPain: 'Douleur apres 5-10 min',
        toolUsage: 'Regle et ciseaux couteux',
        toolScissors: 'Tenue instable',
        handDominance: 'Droitiere',
        schoolAccommodations: 'Copie reduite, consignes segmentees',
        remarks: 'Baisse de confiance lors des evaluations',
        priorities: "Reduire la charge graphomotrice et stabiliser la posture.",
        goals: [
          "Ameliorer la vitesse d'ecriture",
          "Reduire la fatigue et la douleur",
          "Mieux s'organiser sur les devoirs",
        ],
        interviewNotes: "Se motive avec des objectifs courts et visibles.",
        screenTime: '30 min/jour',
        emotionalRegulation: 'Sensibilite aux echecs, besoin de valorisation'
    } as Patient,
    tests: {
        'bhk': {
            'vitesse': { raw: '130', standard: '', percentile: '50', zScore: 0, status: 'validated' },
            'qualite': { raw: '20', standard: '', percentile: '5', zScore: -1.6, status: 'validated', observation: 'Lettres mal formées, télescopages.' }
        }
    } as TestData,
    observations: {
        anamnese: "Joyeuse, dynamique. Se braque dès qu'on sort un crayon.",
        motricite: "Excellente en sport.",
        coordination: "Bonne.",
        spatial: "RAS.",
        graphique: "Prise en poignard parfois. Ne pose pas l'avant-bras."
    } as Observations,
    history: [
      {
        id: 'demo-session-sarah-1',
        date: new Date(Date.now() - 86400000 * 60).toISOString(),
        testId: 'multi',
        testName: 'Bilan initial',
        results: {
          'vitesse': { raw: '11', standard: '7', percentile: '16', zScore: -1.0, status: 'validated' },
          'qualite': { raw: '18', standard: '6', percentile: '9', zScore: -1.4, status: 'validated', observation: 'Tension a la prehension.' },
          'manual-dexterity': { raw: '8', standard: '7', percentile: '16', zScore: -1.0, status: 'validated' }
        }
      },
      {
        id: 'demo-session-sarah-2',
        date: new Date(Date.now() - 86400000 * 35).toISOString(),
        testId: 'multi',
        testName: 'Suivi 1',
        results: {
          'vitesse': { raw: '12', standard: '8', percentile: '25', zScore: -0.7, status: 'validated' },
          'qualite': { raw: '17', standard: '7', percentile: '16', zScore: -1.0, status: 'validated', observation: 'Moins de crispation.' },
          'manual-dexterity': { raw: '9', standard: '8', percentile: '25', zScore: -0.7, status: 'validated' },
          'cloches-barrees': { raw: '26', standard: '9', percentile: '25', zScore: -0.7, status: 'validated' }
        }
      },
      {
        id: 'demo-session-sarah-3',
        date: new Date(Date.now() - 86400000 * 14).toISOString(),
        testId: 'multi',
        testName: 'Suivi 2',
        results: {
          'vitesse': { raw: '13', standard: '9', percentile: '37', zScore: -0.3, status: 'validated' },
          'qualite': { raw: '16', standard: '8', percentile: '25', zScore: -0.7, status: 'validated', observation: 'Lettre plus stable.' },
          'manual-dexterity': { raw: '10', standard: '9', percentile: '37', zScore: -0.3, status: 'validated' },
          'balance': { raw: '9', standard: '8', percentile: '25', zScore: -0.7, status: 'validated' }
        }
      },
      {
        id: 'demo-session-sarah-4',
        date: new Date(Date.now() - 86400000 * 4).toISOString(),
        testId: 'multi',
        testName: 'Suivi 3',
        results: {
          'vitesse': { raw: '14', standard: '10', percentile: '50', zScore: 0, status: 'validated' },
          'qualite': { raw: '15', standard: '9', percentile: '37', zScore: -0.3, status: 'validated', observation: 'Meilleure fluidite.' },
          'manual-dexterity': { raw: '11', standard: '10', percentile: '50', zScore: 0, status: 'validated' },
          'cloches-barrees': { raw: '28', standard: '10', percentile: '50', zScore: 0, status: 'validated' }
        }
      }
    ],
    reports: [
      {
        id: 'demo-report-sarah-1',
        date: new Date(Date.now() - 86400000 * 60).toISOString(),
        type: 'initial',
        status: 'completed',
        patientName: 'Sarah DUBOIS',
        sections: [
          { id: 'demo-sarah-1', title: 'Motif', content: "Difficulte d'ecriture, lenteur et fatigue.", status: 'validated' },
          { id: 'demo-sarah-2', title: 'Synthese', content: 'Profil compatible avec une dysgraphie fonctionnelle avec retentissement scolaire.', status: 'validated' }
        ]
      },
      {
        id: 'demo-report-sarah-2',
        date: new Date(Date.now() - 86400000 * 14).toISOString(),
        type: 'reevaluation',
        status: 'completed',
        patientName: 'Sarah DUBOIS',
        sections: [
          { id: 'demo-sarah-3', title: 'Evolution', content: 'Progression de la vitesse et baisse de la crispation.', status: 'validated' }
        ]
      }
    ]
  }
};
