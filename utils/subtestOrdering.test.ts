import { describe, expect, it } from 'vitest';
import type { CategoryDef, SubtestDef } from '../data/testCatalog';
import { buildCatalogIndex, getSubtestName } from './catalogIndex';
import { compareSubtestsForDisplay, getDisplayGroupKey, getDisplayGroupLabel, getDisplayOrderIndex } from './subtestOrdering';

const st = (id: string, name: string, extra: Partial<SubtestDef> = {}): SubtestDef => ({
  id,
  name,
  unit: 'pts',
  scoreType: 'scaled',
  inputModel: 'numeric_4mode',
  ...extra,
});

describe('libellé et ordre des sous-tests (nom du catalogue)', () => {
  it('getSubtestName renvoie le nom du catalogue, puis les replis', () => {
    const catalog: CategoryDef[] = [
      { id: 'c', name: 'C', iconKey: 'Box', sortOrder: 1, tests: [{ id: 't', name: 'T', subtests: [st('a', 'Dextérité')] }] },
    ];
    const index = buildCatalogIndex(catalog);
    expect(getSubtestName(index, 't', 'a')).toBe('Dextérité');
    expect(getSubtestName(index, 't', 'a', '  Libre  ')).toBe('Libre');
    expect(getSubtestName(index, 't', 'custom_x')).toBe('Observation libre');
    expect(getSubtestName(index, 't', 'mon_test-2_abcdef12')).toBe('mon test 2');
  });

  it('déduit groupe et rang du nom quand la configuration est absente', () => {
    const s = st('a', 'Visuo-spatial — 3. Copie');
    expect(getDisplayGroupLabel(s)).toBe('Visuo-spatial');
    expect(getDisplayGroupKey(s)).toBe('visuo_spatial');
    expect(getDisplayOrderIndex(st('b', 'Subtest 4 : Mémoire'))).toBe(4);
    expect(getDisplayOrderIndex(st('c', '2) Barrage'))).toBe(2);
    expect(getDisplayOrderIndex(st('d', 'Barrage'))).toBe(999);
  });

  it('trie par groupe, rang puis nom (ordre alphabétique français)', () => {
    const list = [
      st('z', 'Écriture'),
      st('y', 'barrage'),
      st('x', 'Copie', { displayGroupOrder: 1 }),
      st('w', 'Attention', { displayOrder: 1 }),
    ];
    expect([...list].sort(compareSubtestsForDisplay).map((s) => s.id)).toEqual(['x', 'w', 'y', 'z']);
  });
});
