import { describe, expect, it } from 'vitest';
import type { CategoryDef } from '../data/testCatalog';
import type { ReportSection } from '../types';
import { buildAssessmentRecord, buildEmptyTestsFrom, getAssessmentTests, getLatestFormalAssessment } from './assessment';
import { buildCatalogIndex, getSubtestName, getTestName, resolveTestDef } from './catalogIndex';
import { buildDeltaEntries, buildDeltaStats } from './reevaluationHelpers';
import { markdownToHtml, sectionToHtml } from './reportContent';
import {
  buildDefaultPages,
  buildTestScoreBlocks,
  computeDotChart,
  computeRadarData,
  moveSectionInPages,
  reconcilePages,
  resolvePages,
  zToFraction,
} from './reportData';

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
          { id: 'grip', name: 'Préhension', unit: '', scoreType: 'none', inputModel: 'qualitative_category', inputConfig: { options: [{ code: 'mature', label: 'Mature', order: 1, reportText: 'Prise tripode.' }] } },
        ],
      },
    ],
  },
  {
    id: 'visual',
    name: 'Visuel',
    iconKey: 'Eye',
    sortOrder: 2,
    tests: [
      {
        id: 'dtvp',
        name: 'DTVP',
        subtests: [{ id: 'copy', name: 'Copie', unit: 'pts', scoreType: 'standard', inputModel: 'numeric_4mode' }],
      },
    ],
  },
  {
    id: 'attention',
    name: 'Attention',
    iconKey: 'Focus',
    sortOrder: 3,
    tests: [
      {
        id: 'bells',
        name: 'Cloches',
        subtests: [{ id: 'omis', name: 'Omissions', unit: 'pts', scoreType: 'none', inputModel: 'numeric_4mode' }],
      },
    ],
  },
];
const index = buildCatalogIndex(catalog);

describe('catalogIndex', () => {
  it('resolves names with fallbacks', () => {
    expect(getTestName(index, 'mabc')).toBe('MABC-2');
    expect(getTestName(index, 'custom_observations')).toBe('Observations personnalisées');
    expect(getSubtestName(index, 'mabc', 'dext')).toBe('Dextérité');
    expect(getSubtestName(index, 'x', 'custom_123', 'Écologique')).toBe('Écologique');
  });
});

describe('assessment helpers', () => {
  it('rebuilds tests from flat results of old assessments', () => {
    const tests = getAssessmentTests(
      { id: 'a', date: '2024-01-01', kind: 'initial', hasFormalReport: true, results: { dext: { standard: '7' } } },
      index,
    );
    expect(tests).toEqual({ mabc: { dext: expect.objectContaining({ value: '7', unit: 'NS' }) } });
  });

  it('picks the latest formal assessment', () => {
    const latest = getLatestFormalAssessment([
      { id: '1', date: '2023-01-01', kind: 'initial', hasFormalReport: true },
      { id: '2', date: '2024-01-01', kind: 'reevaluation', hasFormalReport: true },
      { id: '3', date: '2025-01-01', kind: 'initial', hasFormalReport: false },
    ]);
    expect(latest?.id).toBe('2');
  });

  it('starts a re-evaluation with empty scores', () => {
    expect(buildEmptyTestsFrom({ mabc: { dext: { value: '7', unit: 'NS' } } })).toEqual({ mabc: { dext: {} } });
  });

  it('builds a record without empty scores', () => {
    const record = buildAssessmentRecord({
      kind: 'initial',
      date: '2024-05-01',
      tests: { mabc: { dext: { value: '7', unit: 'NS' }, free: {} }, dtvp: { copy: {} } },
      sections: [],
      patientName: 'A B',
      index,
    });
    expect(record.tests).toEqual({ mabc: { dext: { value: '7', unit: 'NS' } } });
    expect(record.results).toEqual({ dext: { value: '7', unit: 'NS' } });
    expect(record.testName).toBe('MABC-2');
    expect(record.report).toBeUndefined();
  });
});

describe('resolveTestDef', () => {
  it('keeps stored scores of subtests or tests missing from the catalogue', () => {
    const known = resolveTestDef(index, 'mabc', ['dext', 'old_subtest']);
    expect(known.name).toBe('MABC-2');
    expect(known.subtests.map((s) => s.id)).toEqual(['dext', 'grip', 'old_subtest']);
    expect(known.subtests[2]).toMatchObject({ scoreType: 'none', inputModel: 'numeric_4mode' });

    const deleted = resolveTestDef(index, 'deleted-test', ['custom_1a2b3c4d']);
    expect(deleted.name).toBe('Test personnalisé');
    expect(deleted.subtests[0]).toMatchObject({ name: 'Observation libre', inputModel: 'custom_text' });

    expect(resolveTestDef(index, 'dtvp', ['copy'])).toBe(index.testById.get('dtvp'));
  });
});

describe('re-evaluation deltas', () => {
  it('classifies trends in z units and marks unmeasured subtests', () => {
    const entries = buildDeltaEntries(
      { mabc: { dext: { value: '7', unit: 'NS' } }, dtvp: { copy: { value: '85', unit: 'NS' } } },
      { mabc: { dext: { value: '9', unit: 'NS' } }, dtvp: { copy: {} } },
      index,
    );
    const dext = entries.find((e) => e.subtestId === 'dext')!;
    expect(dext.delta).toBe(2);
    expect(dext.zDelta).toBeCloseTo(0.67, 2);
    expect(dext.trend).toBe('improved');

    const copy = entries.find((e) => e.subtestId === 'copy')!;
    expect(copy.newValue).toBeNull();
    expect(copy.trend).toBeNull();
    expect(buildDeltaStats(entries)).toMatchObject({ improved: 1, notMeasured: 1 });
  });

  it('converts a score typed in another metric instead of reporting it as not measured', () => {
    const [entry] = buildDeltaEntries({ mabc: { dext: { value: '7', unit: 'NS' } } }, { mabc: { dext: { value: '50', unit: '%' } } }, index);
    expect(entry.measured).toBe(true);
    expect(entry.newValue).toBe(10);
    expect(entry.delta).toBe(3);
    expect(entry.trend).toBe('improved');
    expect(buildDeltaStats([entry])).toMatchObject({ improved: 1, notMeasured: 0 });
  });

  it('treats a small change on a standard scale as stable', () => {
    const [entry] = buildDeltaEntries(
      { dtvp: { copy: { value: '85', unit: 'NS' } } },
      { dtvp: { copy: { value: '90', unit: 'NS' } } },
      index,
    );
    expect(entry.trend).toBe('stable');
  });
});

describe('report data', () => {
  it('shows the typed value when the requested metric cannot be derived', () => {
    const [block] = buildTestScoreBlocks({ bells: { omis: { value: '8', unit: 'NS' } } }, index, { bells: 'ET' });
    expect(block.rows[0].display).toBe('8 NS');
  });

  it('formats rows per mode, colors them by zone and puts categories in their own table', () => {
    const [block] = buildTestScoreBlocks(
      { mabc: { dext: { value: '4', unit: 'NS' }, grip: { value: 'mature', unit: 'qualitative', qualitativeLabel: 'Mature' } } },
      index,
      { mabc: 'ET' },
    );
    expect(block.rows).toEqual([expect.objectContaining({ display: '-2 ET', zone: 'deficit' })]);
    expect(block.qualitativeRows).toEqual([expect.objectContaining({ category: 'Mature', interpretation: 'Prise tripode.' })]);
  });

  it('adds the evolution since the reference assessment, in the shown metric (#61)', () => {
    const previous = { mabc: { dext: { value: '7', unit: 'NS' as const } } };
    const tests = { mabc: { dext: { value: '9', unit: 'NS' as const } }, dtvp: { copy: { value: '85', unit: 'NS' as const } } };
    const [mabc, dtvp] = buildTestScoreBlocks(tests, index, { mabc: 'NS' }, previous);
    expect(mabc.showEvolution).toBe(true);
    expect(mabc.rows[0].evolution).toEqual({ text: '+2 NS', trend: 'improved', trendLabel: 'amélioration' });
    // Test absent from the reference assessment: nothing to compare.
    expect(dtvp.rows[0].evolution).toEqual({ text: '—', trend: null, trendLabel: '' });

    const [inEt] = buildTestScoreBlocks(tests, index, { mabc: 'ET' }, previous);
    expect(inEt.rows[0].evolution?.text).toBe('+0.67 ET');
  });

  it('has no evolution column outside a re-evaluation', () => {
    const [block] = buildTestScoreBlocks({ mabc: { dext: { value: '9', unit: 'NS' } } }, index);
    expect(block.showEvolution).toBe(false);
    expect(block.rows[0].evolution).toBeUndefined();
  });

  it('places profile dots on the axis with the zone bands', () => {
    const chart = computeDotChart('z', { mabc: { dext: { value: '4', unit: 'NS' } } }, index);
    expect(chart.items).toEqual([expect.objectContaining({ label: 'Dextérité', zone: 'deficit', value: '-2.0', position: zToFraction(-2) })]);
    expect(chart.bands.map((b) => b.zone)).toEqual(['deficit', 'fragile', 'normal']);
    expect(chart.bands[0].to).toBe(chart.bands[1].from);
    expect(computeDotChart('percentile', {}, index).items).toEqual([]);
  });

  it('needs three categories for a radar', () => {
    expect(computeRadarData({ mabc: { dext: { value: '7', unit: 'NS' } } }, index)).toEqual([]);
    const data = computeRadarData(
      {
        mabc: { dext: { value: '7', unit: 'NS' } },
        dtvp: { copy: { value: '100', unit: 'NS' } },
        bells: { omis: { value: '-1', unit: 'ET' } },
      },
      index,
    );
    expect(data.map((d) => d.label)).toEqual(['Motricité', 'Visuel', 'Attention']);
  });

  const sections = (ids: string[]): ReportSection[] => ids.map((id) => ({ id, title: id, content: '', status: 'draft' }));

  it('builds the default layout, hides objectifs and appends extra sections', () => {
    expect(buildDefaultPages('initial', sections(['mandat_ref', 'profil', 'diagnostic', 'objectifs', 'project', 'ecole']))).toEqual([
      ['mandat_ref', 'profil'],
      ['diagnostic', 'project', 'ecole'],
      ['annexes'],
    ]);
    expect(buildDefaultPages('reevaluation', sections(['conclusion', 'recommandations_reev']))).toEqual([
      ['conclusion', 'recommandations_reev'],
      ['annexes'],
    ]);
  });

  it('moves sections without mutating and reconciles layouts', () => {
    const pages = [['a', 'b'], ['c'], ['annexes']];
    expect(moveSectionInPages(pages, 'b', 'up')).toEqual([['b', 'a'], ['c'], ['annexes']]);
    expect(moveSectionInPages(pages, 'c', 'prevPage')).toEqual([['a', 'b', 'c'], ['annexes']]);
    expect(pages).toEqual([['a', 'b'], ['c'], ['annexes']]);
    expect(reconcilePages([['a', 'gone'], ['annexes']], 'initial', sections(['a', 'new']))).toEqual([['a', 'new'], ['annexes']]);
  });

  it('resumes a saved layout (#59), reconciled with the sections, or falls back to the default one', () => {
    const current = sections(['mandat_ref', 'profil', 'diagnostic']);
    expect(resolvePages(undefined, 'initial', current)).toEqual(buildDefaultPages('initial', current));
    expect(resolvePages(null, 'initial', current)).toEqual(buildDefaultPages('initial', current));
    expect(resolvePages([['diagnostic'], ['profil', 'mandat_ref', 'gone'], ['annexes']], 'initial', current)).toEqual([
      ['diagnostic'],
      ['profil', 'mandat_ref'],
      ['annexes'],
    ]);
  });
});

describe('report content', () => {
  it('converts AI markdown to escaped HTML with real lists', () => {
    expect(markdownToHtml('## Titre\n- **un**\n- deux\nTexte <b>')).toBe(
      '<h2>Titre</h2><ul><li><strong>un</strong></li><li>deux</li></ul><p>Texte &lt;b&gt;</p>',
    );
  });

  it('keeps HTML sections as HTML', () => {
    expect(sectionToHtml({ content: '<p>ok</p>', contentFormat: 'html' })).toBe('<p>ok</p>');
  });
});
