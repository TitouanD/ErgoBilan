
import { Patient, TestData, Observations } from '../types';

export const DEMO_PATIENTS = {
  LEO: {
    id: 'demo-leo',
    patient: {
      firstName: 'Léo',
      lastName: 'MARTIN',
      dob: '2014-09-15', // Adapté pour correspondre à un CM1/CM2 (approx 10 ans)
      age: '10 ans', // CM2 pour coller aux normes du test des cloches
      gender: 'M',
      address: '12 Rue des Lilas, 75000 Paris',
      parentNames: 'Mme Martin',
      parentPhone: '06 00 00 00 00',
      parentEmail: 'famille.martin@email.com',
      school: 'École Jules Ferry',
      classLevel: 'CM2', // Modifié pour le test des cloches
      teacher: 'Mme Dubois',
      carePlan: 'PAP en cours',
      avs: 'NON',
      avsDetails: '',
      prescribingDoctor: 'Dr. Généraliste',
      medicalDiagnosis: 'Suspicion TDC',
      medicalTreatments: 'Orthophonie (en cours)',
      medicalFollowup: '',
      reason: 'Difficultés scolaires globales, lenteur, maladresse. Écriture coûteuse.',
      familyExpectations: 'Comprendre pourquoi il se fatigue tant et trouver des solutions pour le collège.',
      pregnancyBirth: 'RAS',
      developmentMotor: 'Marche 14 mois. Vélo sans roulette tardif (8 ans).',
      developmentLanguage: 'RAS',
      sleep: 'Agité, réveils nocturnes.',
      sensory: 'Gêne bruits forts (cantine, cour).',
      meals: 'Salit sa place, utilise ses doigts.',
      dressing: 'Lacets impossibles. Boutons difficiles.',
      continence: 'Ok',
      timeSpace: 'Perd ses affaires, difficulté à lire l\'heure.',
      schoolAttention: 'Fatigabilité importante l\'après-midi.',
      writingIssues: 'Illisible si rapide. Douleur poignet.',
      toolUsage: 'Non',
      schoolAccommodations: '',
      remarks: '',
      priorities: ''
    } as Patient,
    tests: {
      'test-cloches': {
        // LE TEST EST VIDE POUR QUE L'UTILISATEUR LE REMPLISSE ET VOIT LE CALCUL
        'cloches-barrees': { raw: '', standard: '', percentile: '', zScore: 0, status: 'empty' }
      },
      'mabc-2': {
        'manual-dexterity': { raw: '', standard: '', percentile: '', zScore: 0, status: 'empty' },
        'ball-skills': { raw: '', standard: '', percentile: '', zScore: 0, status: 'empty' },
        'balance': { raw: '', standard: '', percentile: '', zScore: 0, status: 'empty' }
      },
      'bhk': {
        'vitesse': { raw: '', standard: '', percentile: '10', zScore: -1.2, status: 'validated' },
        'qualite': { raw: '', standard: '', percentile: '2', zScore: -2.1, status: 'validated', observation: 'Tremblements, crispation.' }
      }
    } as TestData,
    observations: {
      anamnese: "enfant volontaire mais vite découragé / conscient diff / anxiété perf ++",
      motricite: "course maladroite, chute cour récré, tonus axial faible",
      coordination: "diff bimanuel (couverts, règle ciseaux)",
      spatial: "sauts lignes lecture / copie tableau lente",
      graphique: "douleur poignet 5 min / pression stylo forte"
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
        address: '8 Avenue Jean Jaurès',
        parentNames: 'M. Dubois',
        parentPhone: '06 99 88 77 66',
        parentEmail: 'p.dubois@email.com',
        school: 'École Victor Hugo',
        classLevel: 'CP',
        teacher: 'M. Lecomte',
        carePlan: '',
        avs: '',
        avsDetails: '',
        prescribingDoctor: 'Pédiatre',
        medicalDiagnosis: '',
        medicalTreatments: '',
        medicalFollowup: '',
        reason: 'Apprentissage écriture difficile. Refus d\'écrire.',
        familyExpectations: 'Aider à la tenue du crayon.',
        pregnancyBirth: 'RAS',
        developmentMotor: 'RAS',
        developmentLanguage: 'RAS',
        sleep: 'Ok',
        sensory: 'RAS',
        meals: 'Ok',
        dressing: 'Ok',
        continence: 'Ok',
        timeSpace: 'Ok',
        schoolAttention: 'Bonne, sauf en écriture.',
        writingIssues: 'Crispation, douleurs.',
        toolUsage: '',
        schoolAccommodations: '',
        remarks: '',
        priorities: ''
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
    history: []
  }
};
