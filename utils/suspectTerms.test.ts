import { describe, expect, it } from 'vitest';
import type { CategoryDef } from '../data/testCatalog';
import type { Patient } from '../types';
import { buildCatalogIndex } from './catalogIndex';
import { applySuspectTermDecisions, findSuspectTerms } from './suspectTerms';

const catalog: CategoryDef[] = [
  {
    id: 'visual',
    name: 'Visuel',
    iconKey: 'Eye',
    sortOrder: 1,
    tests: [
      {
        id: 'rey',
        name: 'Figure de Rey',
        subtests: [{ id: 'copy', name: 'Copie', unit: 'pts', scoreType: 'none', inputModel: 'numeric_4mode' }],
      },
    ],
  },
];
const index = buildCatalogIndex(catalog);
const find = (value: unknown, allowed?: string[]) => findSuspectTerms(value, { index, allowed });

describe('findSuspectTerms', () => {
  it('flags capitalized words inside a sentence, once', () => {
    expect(find('Il voit sa tante Josette et Josette le garde.')).toEqual(['Josette']);
  });

  it('ignores sentence starts, catalogue names, capitals only, months and common words', () => {
    expect(find('Bonne copie. Résultat à la Figure de Rey en mars, TDAH suspecté, en CE1 à l’École.\n- Suivi en Orthophonie')).toEqual([]);
    expect(find({ a: ['{{PATIENT_PRENOM}} va bien.'] })).toEqual([]);
  });

  it('flags the word after a title, whatever its case, and elided names', () => {
    expect(find('Vu avec Mme lefort et Dr. Bernard.')).toEqual(['lefort', 'Bernard']);
    expect(find("Le cahier d'Emma. L'Hôpital Necker.")).toEqual(['Emma', 'Hôpital', 'Necker']);
  });

  it('does not take the unit « m » for a title', () => {
    expect(find('Course de 10 m en 5 s, lancer à 3 m du mur.')).toEqual([]);
  });

  it('skips allowed words (case-insensitive)', () => {
    expect(find('Il parle de Pikachu.', ['pikachu'])).toEqual([]);
  });
});

describe('applySuspectTermDecisions', () => {
  it('appends the choices without duplicates', () => {
    const patient = { aiMaskedTerms: ['Titi'], aiAllowedTerms: [] } as unknown as Patient;
    expect(applySuspectTermDecisions(patient, { masked: ['titi', 'Josette'], allowed: ['Pikachu'] })).toEqual({
      aiMaskedTerms: ['Titi', 'Josette'],
      aiAllowedTerms: ['Pikachu'],
    });
  });
});
