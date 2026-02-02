
import React from 'react';
import { Brain, Pencil, Eye, Hand, Focus, Home } from 'lucide-react';

export interface SubtestDef {
  id: string;
  name: string;
  unit: string; // e.g., "mots/min", "erreurs", "pts", "sec"
  lowerIsBetter?: boolean;
  scoreType: 'standard' | 'scaled' | 't-score' | 'percentile'; // standard (100/15), scaled (10/3), t-score (50/10)
}

export interface TestDef {
  id: string;
  name: string;
  subtests: SubtestDef[];
}

export interface CategoryDef {
  id: string;
  name: string;
  iconName: 'Brain' | 'Pencil' | 'Eye' | 'Hand' | 'Focus' | 'Home';
  tests: TestDef[];
}

export const TEST_CATALOG: CategoryDef[] = [
  {
    id: 'motricite-globale',
    name: 'Motricité Globale',
    iconName: 'Brain',
    tests: [
      { 
        id: 'mabc-2', 
        name: 'MABC-2',
        subtests: [
          { id: 'manual-dexterity', name: 'Dextérité manuelle', unit: 'pts', scoreType: 'scaled' },
          { id: 'ball-skills', name: 'Viser et Attraper', unit: 'pts', scoreType: 'scaled' },
          { id: 'balance', name: 'Équilibre', unit: 'pts', scoreType: 'scaled' },
          { id: 'total-score', name: 'Score Total', unit: 'pts', scoreType: 'standard' },
        ]
      },
      { 
        id: 'pdms-2', 
        name: 'PDMS-2',
        subtests: [
          { id: 'fine-motor-quotient', name: 'Quotient moteur fin', unit: 'pts', scoreType: 'standard' },
          { id: 'gross-motor-quotient', name: 'Quotient moteur global', unit: 'pts', scoreType: 'standard' },
        ]
      },
    ],
  },
  {
    id: 'ecriture',
    name: 'Écriture',
    iconName: 'Pencil',
    tests: [
      { 
        id: 'bhk', 
        name: 'BHK (Enfant)',
        subtests: [
          { id: 'vitesse', name: 'Vitesse', unit: 'car/5min', scoreType: 'standard' }, // Souvent étalonné en écart-type direct, mais simulons standard pour l'UX
          { id: 'qualite', name: 'Qualité', unit: 'pts', scoreType: 'standard', lowerIsBetter: true },
        ]
      },
      { 
        id: 'bhk-ado', 
        name: 'BHK Ado',
        subtests: [
          { id: 'vitesse', name: 'Vitesse', unit: 'car/5min', scoreType: 'standard' },
          { id: 'lisibilite', name: 'Lisibilité', unit: 'pts', scoreType: 'standard' },
        ]
      },
    ],
  },
  {
    id: 'visuo-perceptif',
    name: 'Visuo-perceptif',
    iconName: 'Eye',
    tests: [
      { 
        id: 'beery-vmi', 
        name: 'Beery VMI',
        subtests: [
          { id: 'integration', name: 'VMI (Intégration)', unit: 'pts', scoreType: 'standard' },
          { id: 'perception', name: 'Perception Visuelle', unit: 'pts', scoreType: 'standard' },
          { id: 'coordination', name: 'Coordination Motrice', unit: 'pts', scoreType: 'standard' },
        ]
      },
      { 
        id: 'dtvp-3', 
        name: 'DTVP-3',
        subtests: [
          { id: 'eye-hand', name: 'Coordination Œil-Main', unit: 'pts', scoreType: 'scaled' },
          { id: 'copying', name: 'Copie', unit: 'pts', scoreType: 'scaled' },
          { id: 'figure-ground', name: 'Figure-Fond', unit: 'pts', scoreType: 'scaled' },
          { id: 'visual-closure', name: 'Complètement Visuel', unit: 'pts', scoreType: 'scaled' },
          { id: 'form-constancy', name: 'Constance de Forme', unit: 'pts', scoreType: 'scaled' },
        ]
      },
    ],
  },
  {
    id: 'attention-executif',
    name: 'Attention / Exécutif',
    iconName: 'Focus',
    tests: [
      { 
        id: 'tea-ch', 
        name: 'TEA-Ch',
        subtests: [
          { id: 'sky-search', name: 'Recherche dans le ciel', unit: 'sec', scoreType: 'scaled', lowerIsBetter: true },
          { id: 'score-attention', name: 'Coups de fusil', unit: 'pts', scoreType: 'scaled' },
          { id: 'creature-counting', name: 'Les petits bonhommes', unit: 'sec', scoreType: 'scaled', lowerIsBetter: true },
        ]
      },
      { 
        id: 'nepsy-2', 
        name: 'NEPSY-II',
        subtests: [
          { id: 'cubes', name: 'Cubes (Visuo-Spatial)', unit: 'pts', scoreType: 'scaled' },
          { id: 'fleches', name: 'Flèches', unit: 'pts', scoreType: 'scaled' },
          { id: 'precision-visuomotrice', name: 'Précision Visuomotrice', unit: 'pts', scoreType: 'scaled' },
          { id: 'attention-visuelle', name: 'Attention Visuelle', unit: 'pts', scoreType: 'scaled' },
          { id: 'inhibition', name: 'Inhibition', unit: 'sec', scoreType: 'scaled', lowerIsBetter: true },
        ]
      },
      { 
        id: 'brief-2', 
        name: 'BRIEF-2',
        subtests: [
          { id: 'inhibition', name: 'Inhibition', unit: 'pts', scoreType: 't-score', lowerIsBetter: true }, // T-Score : Moyenne 50, SD 10
          { id: 'flexibilite', name: 'Flexibilité', unit: 'pts', scoreType: 't-score', lowerIsBetter: true },
          { id: 'memoire', name: 'Mémoire de travail', unit: 'pts', scoreType: 't-score', lowerIsBetter: true },
        ]
      },
    ],
  },
  {
    id: 'sensoriel',
    name: 'Sensoriel',
    iconName: 'Hand',
    tests: [
      { 
        id: 'profil-sensoriel-2', 
        name: 'Profil Sensoriel 2',
        subtests: [
          { id: 'seeking', name: 'Recherche', unit: 'pts', scoreType: 'standard' }, // Simplification
          { id: 'avoiding', name: 'Évitement', unit: 'pts', scoreType: 'standard' },
          { id: 'sensitivity', name: 'Sensibilité', unit: 'pts', scoreType: 'standard' },
          { id: 'registration', name: 'Enregistrement', unit: 'pts', scoreType: 'standard' },
        ]
      },
    ],
  },
];
