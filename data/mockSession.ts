
import { Patient, TestData, Observations } from '../types';

export const MOCK_SESSION_DATA = {
    patient: {
        firstName: 'Mayrick',
        lastName: 'MOCK',
        dob: '2015-04-23', // 10 ans et 5 mois en Oct 2025
        age: '10 ans 5 mois',
        gender: 'M',
        address: '29800 Landerneau',
        parentNames: 'Mr et Mme MOCK',
        parentPhone: '06 00 00 00 00',
        parentEmail: 'parents@mock.com',
        guardArrangement: '',
        siblings: [],
        
        // Scolarité
        school: 'Ecole Simone Veil',
        classLevel: 'CM2',
        teacher: '',
        carePlan: 'PPS',
        avs: 'OUI',
        avsDetails: 'AESH temps plein',
        
        // Médical
        prescribingDoctor: 'Dr RAKOTOSEHENO',
        medicalDiagnosis: 'TDAH (2020)',
        medicalTreatments: 'Sous traitement',
        medicalFollowup: 'Suivi classique',
        
        // Motif
        reason: 'Demande ordi. Écriture illisible, lente et douloureuse. Fatigue ++.',
        familyExpectations: 'Mise en place outil info pour le collège.',
        
        // Développement & Vie Quotidienne
        pregnancyBirth: 'RAS',
        developmentMotor: 'Marche ok. Foot en club.',
        developmentLanguage: 'RAS',
        sleep: 'Difficile le soir',
        sensory: 'RAS',
        
        meals: 'Mange avec les mains (préférence).',
        dressing: 'Autonome mais besoin stimulation.',
        continence: 'Ok',
        timeSpace: 'Ok',
        
        schoolAttention: 'TDAH impactant. AESH recadre l\'attention. Aime les maths/arts, déteste le français.',
        writingIssues: 'Douleurs poignet. Illisible. Lenteur.',
        toolUsage: 'Non',
        schoolAccommodations: 'Allègement écriture',
        
        remarks: 'Crainte de l\'échec. Impulsivité.',
        priorities: '',
        interviewNotes: 'Enfant volontaire mais vite frustré. Douleur poignet rapportée 4/10.'
    } as Patient,

    tests: {
        'mabc-2': {
            'manual-dexterity': { raw: '', standard: '5', percentile: '5', zScore: -1.6, status: 'validated' },
            'ball-skills': { raw: '', standard: '10', percentile: '50', zScore: 0, status: 'validated' },
            'balance': { raw: '', standard: '10', percentile: '50', zScore: 0, status: 'validated' }
        },
        'dtvp-3': {
            'copying': { raw: '', standard: '5', percentile: '5', zScore: -1.6, status: 'validated', observation: 'Lenteur. Bonne orga mais visu 3D difficile.' }
        },
        'nepsy-2': {
            'fleches': { raw: '', standard: '10', percentile: '50', zScore: 0, status: 'validated' },
            'cubes': { raw: '', standard: '5', percentile: '5', zScore: -1.6, status: 'validated', observation: 'Difficile percevoir l\'implicite.' },
            'precision-visuomotrice': { raw: '', standard: '7', percentile: '16', zScore: -1, status: 'validated', observation: 'Élévation épaule compensatoire.' }
        },
        'bhk': {
            'vitesse': { raw: '', standard: '', percentile: '0.1', zScore: -2.3, status: 'validated', observation: 'Lenteur majeure (-2.3 à -3 ET).' },
            'qualite': { raw: '', standard: '', percentile: '0.1', zScore: -4.8, status: 'validated', observation: 'Illisible. Douleur.' }
        }
    } as TestData,

    observations: {
        anamnese: "TDAH 2020 traité. Dvlpt moteur ok (foot). Mange avec les mains. AESH temps plein nécessaire pour recentrage. Tolérance frustration faible.",
        motricite: "Globale ok. Fine : manque précision gestes fins.",
        coordination: "Bimanuelle difficile. Précision insuffisante.",
        spatial: "Visuo-constructif ok. Exploration visuelle stratégique difficile (organisation spatiale).",
        graphique: "Prise tridigitale crispée. Douleur poignet (jusqu'à 4.5/10). Écriture coûteuse en énergie. Orthographe prend toutes les ressources attentionnelles."
    } as Observations
};
