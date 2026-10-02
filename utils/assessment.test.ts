import { describe, expect, it } from 'vitest';
import type { SubtestDef } from '../data/testCatalog';
import { addCatalogSelection } from './assessment';
import { buildCatalogIndex } from './catalogIndex';

const st = (id: string, displayGroupOrder: number, displayOrder: number): SubtestDef => ({
  id,
  name: id,
  unit: '',
  scoreType: 'scaled',
  inputModel: 'numeric_4mode',
  displayGroupOrder,
  displayOrder,
});

const index = buildCatalogIndex([
  {
    id: 'cat',
    name: 'Cat',
    iconKey: 'Box',
    sortOrder: 1,
    tests: [{ id: 'dtvp', name: 'DTVP', subtests: [st('a', 1, 1), st('b', 1, 2), st('c', 1, 3), st('indice', 2, 4)] }],
  },
]);

describe('addCatalogSelection (#92)', () => {
  it("range les sous-tests cochés dans l'ordre du catalogue, pas dans l'ordre des clics", () => {
    const { tests, newTestIds } = addCatalogSelection({}, { dtvp: ['indice', 'c', 'a'] }, index);
    expect(Object.keys(tests.dtvp)).toEqual(['a', 'c', 'indice']);
    expect(newTestIds).toEqual(['dtvp']);
  });

  it('garde l’ordre déjà présent (réarrangé à la main) et ajoute les nouveaux à la suite', () => {
    const { tests } = addCatalogSelection({ dtvp: { c: {}, a: { value: '7', unit: 'NS' } } }, { dtvp: ['indice', 'b'] }, index);
    expect(Object.keys(tests.dtvp)).toEqual(['c', 'a', 'b', 'indice']);
    expect(tests.dtvp.a).toEqual({ value: '7', unit: 'NS' });
  });

  it('un sous-test hors catalogue (observation libre) reste ajouté', () => {
    const { tests } = addCatalogSelection({}, { custom_observations: ['custom_1'] }, index);
    expect(Object.keys(tests.custom_observations)).toEqual(['custom_1']);
  });
});
