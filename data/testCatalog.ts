
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

// SNAPSHOT POUR LE MODE DÉMO UNIQUEMENT
// Pour la production, ces données sont chargées depuis Supabase (official_tests)
export const TEST_CATALOG: CategoryDef[] = [
  {
    id: 'attention-executif',
    name: 'Attention / Exécutif',
    iconName: 'Focus',
    tests: [
      { 
        id: 'test-cloches', 
        name: 'Test des Cloches',
        subtests: [
          { id: 'cloches-barrees', name: 'Cloches Barrées (Total)', unit: 'cloches', scoreType: 'standard' },
        ]
      }
    ],
  },
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
      }
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
          { id: 'vitesse', name: 'Vitesse', unit: 'car/5min', scoreType: 'standard' }, 
          { id: 'qualite', name: 'Qualité', unit: 'pts', scoreType: 'standard', lowerIsBetter: true },
        ]
      }
    ],
  }
];
