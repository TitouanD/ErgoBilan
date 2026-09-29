import { describe, expect, it } from 'vitest';
import type { CategoryDef } from '../data/testCatalog';
import { buildCatalogIndex } from './catalogIndex';
import { describeScore, formatMetricValue, resolveScores } from './resolvedScore';

const catalog: CategoryDef[] = [
  {
    id: 'motor',
    name: 'Motricité',
    iconKey: 'Hand',
    sortOrder: 1,
    tests: [
      {
        id: 'mabc',
        name: 'MABC-2',
        subtests: [
          { id: 'dext', name: 'Dextérité', unit: 'pts', scoreType: 'scaled', inputModel: 'numeric_4mode' },
          { id: 'balance', name: 'Équilibre', unit: 'pts', scoreType: 'scaled', inputModel: 'numeric_4mode' },
          { id: 'omis', name: 'Omissions', unit: 'pts', scoreType: 'none', inputModel: 'numeric_4mode' },
          { id: 'grip', name: 'Préhension', unit: '', scoreType: 'none', inputModel: 'qualitative_category' },
          { id: 'eco', name: 'Écologique', unit: '', scoreType: 'none', inputModel: 'custom_text' },
        ],
      },
    ],
  },
];
const index = buildCatalogIndex(catalog);

describe('formatMetricValue', () => {
  it('writes the value then the metric, ET always signed', () => {
    expect(formatMetricValue(85, 'NS')).toBe('85 NS');
    expect(formatMetricValue(42, '%')).toBe('42 %');
    expect(formatMetricValue(1.2, 'ET')).toBe('+1.2 ET');
    expect(formatMetricValue(-2, 'ET')).toBe('-2 ET');
    expect(formatMetricValue(1.256, 'ET')).toBe('+1.26 ET');
  });

  it('signs a difference on request', () => {
    expect(formatMetricValue(5, 'NS', true)).toBe('+5 NS');
    expect(formatMetricValue(-3, '%', true)).toBe('-3 %');
    expect(formatMetricValue(0, 'NS', true)).toBe('0 NS');
  });
});

describe('describeScore', () => {
  it('resolves names, scale, z, percentile and zone of a standardized score', () => {
    const r = describeScore(index, 'mabc', 'dext', { value: '4', unit: 'NS' });
    expect(r).toMatchObject({ label: 'Dextérité', testName: 'MABC-2', scale: 'scaled', metric: 'NS', z: -2, pct: 2, zone: 'deficit' });
  });

  it('displays the score as typed, or in the requested metric when it can be derived', () => {
    const r = describeScore(index, 'mabc', 'dext', { value: '7', unit: 'NS' });
    expect(r.display()).toBe('7 NS');
    expect(r.display('ET')).toBe('-1 ET');
    expect(r.display('%')).toBe('16 %');
    expect(describeScore(index, 'mabc', 'dext', { value: '1.50', unit: 'ET' }).display()).toBe('+1.5 ET');
    expect(describeScore(index, 'mabc', 'dext', { value: '-1,5', unit: 'ET' }).display()).toBe('-1.5 ET');
  });

  it('falls back to the typed value when the scale is unknown', () => {
    const r = describeScore(index, 'mabc', 'omis', { value: '8', unit: 'NS' });
    expect(r.z).toBeNull();
    expect(r.zone).toBeNull();
    expect(r.display('ET')).toBe('8 NS');
  });

  it('takes the zone from the percentile when no z can be computed', () => {
    const r = describeScore(index, 'mabc', 'omis', { value: '0', unit: '%' });
    expect(r.z).toBeNull();
    expect(r.zone).toBe('deficit');
  });

  it('takes the zone from z at the boundary where the rounded percentile disagrees', () => {
    const r = describeScore(index, 'mabc', 'omis', { value: '-1', unit: 'ET' });
    expect(r.pct).toBe(16);
    expect(r.zone).toBe('fragile');
  });

  it('gives no zone and shows the label of a qualitative score', () => {
    const r = describeScore(index, 'mabc', 'grip', { value: 'mature', unit: 'qualitative', qualitativeLabel: 'Mature' });
    expect(r).toMatchObject({ isQualitative: true, metric: null, zone: null });
    expect(r.display('ET')).toBe('Mature');
  });

  it('recognizes free observations and empty scores', () => {
    expect(describeScore(index, 'mabc', 'eco', { observation: 'ok' }).isFreeText).toBe(true);
    expect(describeScore(index, 'custom_observations', 'custom_1', { customLabel: 'Cour' })).toMatchObject({
      isFreeText: true,
      label: 'Cour',
    });
    expect(describeScore(index, 'mabc', 'dext').display()).toBe('—');
  });

  it('expresses the score in another metric with the scale', () => {
    const r = describeScore(index, 'mabc', 'dext', { value: '50', unit: '%' });
    expect(r.valueIn('%')).toBe(50);
    expect(r.valueIn('NS')).toBe(10);
    expect(r.valueIn('ET')).toBe(0);
  });
});

describe('resolveScores', () => {
  it('groups subtests holding data by test, in stored order, with the mean z', () => {
    const [test] = resolveScores(
      { mabc: { balance: { value: '13', unit: 'NS' }, dext: { value: '7', unit: 'NS' }, omis: {}, eco: { observation: 'note' } } },
      index,
    );
    expect(test).toMatchObject({ testId: 'mabc', testName: 'MABC-2', isFreeObservations: false, meanZ: 0 });
    expect(test.category?.id).toBe('motor');
    expect(test.subtests.map((r) => r.subtestId)).toEqual(['balance', 'dext', 'eco']);
  });

  it('keeps tests without data, with no mean', () => {
    expect(resolveScores({ mabc: { dext: {} } }, index)).toEqual([expect.objectContaining({ meanZ: null, subtests: [] })]);
  });
});
