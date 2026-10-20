/**
 * demoCatalog.ts — catalogue used by the demo mode.
 *
 * The real catalogue comes from Supabase views that require an onboarded
 * account, so the demo (no account) gets this static excerpt instead. Ids,
 * names and scale types mirror `official_tests` / `official_subtests` so the
 * demo data (data/demoData.ts) renders exactly like real assessments.
 */

import type { CategoryDef, SubtestDef } from './testCatalog';

const numeric = (id: string, name: string, scoreType: SubtestDef['scoreType'], displayOrder: number): SubtestDef => ({
  id,
  name,
  unit: '',
  scoreType,
  inputModel: 'numeric_4mode',
  displayOrder,
});

export const DEMO_CATALOG: CategoryDef[] = [
  {
    id: 'ecriture',
    name: 'Écriture',
    iconKey: 'PenTool',
    sortOrder: 1,
    tests: [
      {
        id: 'bhk',
        name: 'BHK',
        subtests: [numeric('bhk__quality', 'Qualité', 'none', 1), numeric('bhk__speed', 'Vitesse', 'none', 2)],
      },
    ],
  },
  {
    id: 'motricite-globale',
    name: 'Motricité globale',
    iconKey: 'Activity',
    sortOrder: 2,
    tests: [
      {
        id: 'mabc-2',
        name: 'MABC-2',
        subtests: [
          numeric('mabc-2__manual-dexterity-total', 'Note totale dextérité manuelle', 'scaled', 1),
          numeric('mabc-2__aiming-catching-total', 'Note totale viser et attraper', 'scaled', 2),
          numeric('mabc-2__balance-composite', 'Note totale Équilibre', 'scaled', 3),
          numeric('mabc-2__total-score', 'Note totale du test', 'scaled', 4),
        ],
      },
    ],
  },
  {
    id: 'visuo-perceptif',
    name: 'Visuo-perceptif',
    iconKey: 'Eye',
    sortOrder: 3,
    tests: [
      {
        id: 'test-cloches',
        name: 'Test des Cloches',
        subtests: [
          numeric('test-cloches__cibles', 'Nombre de cloches repérées (/35)', 'standard', 1),
          numeric('test-cloches__temps-total-secondes', 'Temps total (secondes)', 'none', 2),
        ],
      },
    ],
  },
];
