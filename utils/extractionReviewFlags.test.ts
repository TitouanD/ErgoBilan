import { readFileSync } from 'node:fs';
import type { ExtractedRow } from '../types';
import { analyzePageRows } from './extractionReviewFlags';
import { describe, expect, it } from 'vitest';

type FixturePayload = {
  pageId: string;
  structure: 'LOOKUP' | 'PARAMETRIC' | 'UNKNOWN';
  rows: ExtractedRow[];
};

const loadFixture = (filename: string): FixturePayload => {
  const content = readFileSync(new URL(`../tests/fixtures/extraction/${filename}`, import.meta.url), 'utf-8');
  return JSON.parse(content) as FixturePayload;
};

const makeLookupRows = (
  subtest: string,
  standards: number[],
  sourceColumnKey: string,
  options?: {
    rawStart?: number;
    rawStep?: number;
    forceOverlap?: boolean;
    reverseStandardOrder?: boolean;
  },
): ExtractedRow[] => {
  const rawStart = options?.rawStart ?? 0;
  const rawStep = options?.rawStep ?? 2;
  return standards.map((standard, index) => {
    const rawMin = options?.forceOverlap ? rawStart : rawStart + index * rawStep;
    const rawMax = rawMin + 1;
    const visibleStandard = options?.reverseStandardOrder ? standards[standards.length - 1 - index] : standard;
    return {
      id: `${sourceColumnKey}-${index}`,
      subtest,
      label: '10;6-10;11',
      raw: `${rawMin}-${rawMax}`,
      standard: String(visibleStandard),
      zScore: '',
      percentile: '',
      hidden_age_min: 126,
      hidden_age_max: 131,
      source_column_key: sourceColumnKey,
      source_abbreviation: sourceColumnKey,
    };
  });
};

describe('extractionReviewFlags LOOKUP v1', () => {
  it('handles boundary unscored rows without blocking flood', () => {
    const fixture = loadFixture('lookup-boundary-unscored.json');
    const flags = analyzePageRows({
      pageId: fixture.pageId,
      rows: fixture.rows,
      structure: fixture.structure,
    });

    expect(flags.some((flag) => flag.code === 'LOOKUP_REQUIRED_FIELD_MISSING')).toBe(false);
    expect(flags.some((flag) => flag.code === 'LOOKUP_INTERNAL_SCORE_GAP')).toBe(false);
    expect(flags.some((flag) => flag.code === 'LOOKUP_BOUNDARY_UNSCORED' && flag.severity === 'info')).toBe(true);
    expect(flags.some((flag) => flag.severity === 'blocking')).toBe(false);
  });

  it('detects internal score gaps inside scored core', () => {
    const fixture = loadFixture('lookup-internal-gap.json');
    const flags = analyzePageRows({
      pageId: fixture.pageId,
      rows: fixture.rows,
      structure: fixture.structure,
    });

    const internalGap = flags.find((flag) => flag.code === 'LOOKUP_INTERNAL_SCORE_GAP');
    expect(internalGap).toBeDefined();
    expect(internalGap?.severity).toBe('warning');
  });

  it('detects atypical standard and percentile jumps', () => {
    const fixture = loadFixture('lookup-step-outlier.json');
    const flags = analyzePageRows({
      pageId: fixture.pageId,
      rows: fixture.rows,
      structure: fixture.structure,
    });

    expect(flags.some((flag) => flag.code === 'LOOKUP_STANDARD_STEP_OUTLIER' && flag.severity === 'warning')).toBe(true);
    expect(flags.some((flag) => flag.code === 'LOOKUP_PERCENTILE_STEP_OUTLIER' && flag.severity === 'warning')).toBe(true);
  });

  it('flags age headers captured as subtest names', () => {
    const fixture = loadFixture('lookup-age-as-subtest.json');
    const flags = analyzePageRows({
      pageId: fixture.pageId,
      rows: fixture.rows,
      structure: fixture.structure,
    });

    const ageCaptured = flags.find((flag) => flag.code === 'LOOKUP_SUBTEST_AGE_HEADER_CAPTURED');
    expect(ageCaptured).toBeDefined();
    expect(ageCaptured?.severity).toBe('blocking');
  });

  it('flags score-without-raw as blocking and keeps deprecated missing rule silent', () => {
    const fixture = loadFixture('lookup-boundary-unscored.json');
    const rows = [...fixture.rows];
    rows.push({
      id: 'missing-raw-score',
      subtest: 'Integration Visuo-Motrice',
      label: '4;0 - 4;1',
      raw: '',
      standard: '100',
      zScore: '0',
      percentile: '50',
      hidden_age_min: 48,
      hidden_age_max: 49,
    });

    const flags = analyzePageRows({
      pageId: 'fixture-score-without-raw',
      rows,
      structure: 'LOOKUP',
    });

    expect(flags.some((flag) => flag.code === 'LOOKUP_SCORE_WITHOUT_RAW' && flag.severity === 'blocking')).toBe(true);
    expect(flags.some((flag) => flag.code === 'LOOKUP_REQUIRED_FIELD_MISSING')).toBe(false);
  });

  it('downgrades sparse-but-structured lookup columns', () => {
    const denseStandards = Array.from({ length: 19 }, (_, i) => i + 1);
    const sparseStandards = [1, 2, 4, 6, 9];

    const rows: ExtractedRow[] = [
      ...makeLookupRows('Dense A', denseStandards, 'DA', { rawStart: 0 }),
      ...makeLookupRows('Dense B', denseStandards, 'DB', { rawStart: 4 }),
      ...makeLookupRows('Sparse Structured', sparseStandards, 'SS', { rawStart: 2 }),
    ];

    const flags = analyzePageRows({
      pageId: 'fixture-sparse-structured',
      rows,
      structure: 'LOOKUP',
    });

    const sparseFlags = flags.filter((flag) => flag.subtest === 'Sparse Structured');

    expect(sparseFlags.some((flag) => flag.code === 'GROUP_ROW_COUNT_MISMATCH')).toBe(true);
    expect(sparseFlags.some((flag) => flag.code === 'GROUP_ROW_COUNT_MISMATCH' && flag.severity === 'blocking')).toBe(false);
    expect(sparseFlags.some((flag) => flag.code === 'LOOKUP_ROW_COUNT_SUSPICIOUSLY_LOW')).toBe(false);
    expect(sparseFlags.some((flag) => flag.code === 'LOOKUP_NS_RANGE_INCOMPLETE' && flag.severity === 'blocking')).toBe(false);
  });

  it('keeps blocking flags for incoherent low-coverage lookup columns', () => {
    const denseStandards = Array.from({ length: 19 }, (_, i) => i + 1);
    const brokenStandards = [1, 4, 2, 5, 3];

    const rows: ExtractedRow[] = [
      ...makeLookupRows('Dense A', denseStandards, 'DA', { rawStart: 0 }),
      ...makeLookupRows('Dense B', denseStandards, 'DB', { rawStart: 4 }),
      ...makeLookupRows('Sparse Broken', brokenStandards, 'SB', {
        rawStart: 1,
        forceOverlap: true,
        reverseStandardOrder: true,
      }),
    ];

    const flags = analyzePageRows({
      pageId: 'fixture-sparse-broken',
      rows,
      structure: 'LOOKUP',
    });

    const blockingBroken = flags.filter((flag) => flag.subtest === 'Sparse Broken' && flag.severity === 'blocking');
    expect(blockingBroken.length).toBeGreaterThan(0);
    expect(blockingBroken.some((flag) => flag.code === 'GROUP_ROW_COUNT_MISMATCH' || flag.code === 'LOOKUP_NS_RANGE_INCOMPLETE')).toBe(true);
  });

  it('flags duplicate raw rows with conflicting scores as blocking', () => {
    const rows: ExtractedRow[] = [
      {
        id: 'dup-1',
        subtest: 'Mémoire de la Navigation',
        label: '5;0 - 5;5',
        raw: '0',
        standard: '3',
        zScore: '',
        percentile: '',
        hidden_age_min: 60,
        hidden_age_max: 65,
        source_column_key: 'MN::1',
      },
      {
        id: 'dup-2',
        subtest: 'Mémoire de la Navigation',
        label: '5;0 - 5;5',
        raw: '0',
        standard: '4',
        zScore: '',
        percentile: '',
        hidden_age_min: 60,
        hidden_age_max: 65,
        source_column_key: 'MN::1',
      },
      {
        id: 'dup-3',
        subtest: 'Mémoire de la Navigation',
        label: '5;0 - 5;5',
        raw: '1',
        standard: '5',
        zScore: '',
        percentile: '',
        hidden_age_min: 60,
        hidden_age_max: 65,
        source_column_key: 'MN::1',
      },
    ];

    const flags = analyzePageRows({
      pageId: 'fixture-duplicate-raw-conflict',
      rows,
      structure: 'LOOKUP',
    });

    expect(flags.some((flag) => flag.code === 'LOOKUP_RAW_DUPLICATE_CONFLICT' && flag.severity === 'blocking')).toBe(true);
  });

  it('flags duplicate raw rows with partial score coverage as blocking', () => {
    const rows: ExtractedRow[] = [
      {
        id: 'partial-1',
        subtest: 'Attention Auditive',
        label: '6;0 - 6;5',
        raw: '5-6',
        standard: '8',
        zScore: '',
        percentile: '',
        hidden_age_min: 72,
        hidden_age_max: 77,
        source_column_key: 'AA::1',
      },
      {
        id: 'partial-2',
        subtest: 'Attention Auditive',
        label: '6;0 - 6;5',
        raw: '5-6',
        standard: '',
        zScore: '',
        percentile: '',
        hidden_age_min: 72,
        hidden_age_max: 77,
        source_column_key: 'AA::1',
      },
    ];

    const flags = analyzePageRows({
      pageId: 'fixture-duplicate-raw-partial',
      rows,
      structure: 'LOOKUP',
    });

    expect(flags.some((flag) => flag.code === 'LOOKUP_RAW_DUPLICATE_PARTIAL' && flag.severity === 'blocking')).toBe(true);
  });

  it('suggests replacing ghost value with dash instead of fixing the range', () => {
    // Pattern: prev=0 (single value), curr=0-1 (range starting at same value)
    // The fix should target prev (replace "0" with "-"), NOT modify curr
    const rows: ExtractedRow[] = [
      {
        id: 'ghost-0',
        subtest: 'MP & MPD',
        label: '5;5 – 5;11',
        raw: '0',
        standard: '1',
        zScore: '',
        percentile: '',
        hidden_age_min: 65,
        hidden_age_max: 71,
        source_column_key: 'MP_MPD::1',
      },
      {
        id: 'ghost-1',
        subtest: 'MP & MPD',
        label: '5;5 – 5;11',
        raw: '0-1',
        standard: '2',
        zScore: '',
        percentile: '',
        hidden_age_min: 65,
        hidden_age_max: 71,
        source_column_key: 'MP_MPD::1',
      },
      {
        id: 'ghost-2',
        subtest: 'MP & MPD',
        label: '5;5 – 5;11',
        raw: '2',
        standard: '3',
        zScore: '',
        percentile: '',
        hidden_age_min: 65,
        hidden_age_max: 71,
        source_column_key: 'MP_MPD::1',
      },
    ];

    const flags = analyzePageRows({
      pageId: 'fixture-ghost-value',
      rows,
      structure: 'LOOKUP',
    });

    const overlapFlag = flags.find((f) => f.code === 'LOOKUP_RAW_RANGE_OVERLAP');
    expect(overlapFlag).toBeDefined();
    expect(overlapFlag?.severity).toBe('warning');
    // Fix should target the PREVIOUS row (ghost value), not the range row
    expect(overlapFlag?.suggestedFix?.rowId).toBe('ghost-0');
    expect(overlapFlag?.suggestedFix?.value).toBe('-');
    expect(overlapFlag?.suggestedFix?.field).toBe('raw');
  });

  it('detects raw range gap and suggests fix when a dash row exists in between', () => {
    // Pattern: 0-24 at NS=1, dash at NS=2, 28-29 at NS=3 → gap of 25-27
    const rows: ExtractedRow[] = [
      {
        id: 'gap-0',
        subtest: 'CFPT',
        label: '5;5 – 5;11',
        raw: '0-24',
        standard: '1',
        zScore: '',
        percentile: '',
        hidden_age_min: 65,
        hidden_age_max: 71,
        source_column_key: 'CFPT::1',
      },
      {
        id: 'gap-1',
        subtest: 'CFPT',
        label: '5;5 – 5;11',
        raw: '-',
        standard: '2',
        zScore: '',
        percentile: '',
        hidden_age_min: 65,
        hidden_age_max: 71,
        source_column_key: 'CFPT::1',
      },
      {
        id: 'gap-2',
        subtest: 'CFPT',
        label: '5;5 – 5;11',
        raw: '28-29',
        standard: '3',
        zScore: '',
        percentile: '',
        hidden_age_min: 65,
        hidden_age_max: 71,
        source_column_key: 'CFPT::1',
      },
    ];

    const flags = analyzePageRows({
      pageId: 'fixture-raw-gap',
      rows,
      structure: 'LOOKUP',
    });

    const gapFlag = flags.find((f) => f.code === 'LOOKUP_RAW_RANGE_GAP');
    expect(gapFlag).toBeDefined();
    expect(gapFlag?.severity).toBe('warning');
    // Should suggest fixing the dash row with the missing range
    expect(gapFlag?.suggestedFix?.rowId).toBe('gap-1');
    expect(gapFlag?.suggestedFix?.value).toBe('25-27');
    expect(gapFlag?.suggestedFix?.field).toBe('raw');
  });

  it('detects raw range gap without fix when no dash row bridge exists', () => {
    const rows: ExtractedRow[] = [
      {
        id: 'nobridge-0',
        subtest: 'TestX',
        label: '5;5 – 5;11',
        raw: '0-5',
        standard: '1',
        zScore: '',
        percentile: '',
        hidden_age_min: 65,
        hidden_age_max: 71,
        source_column_key: 'TX::1',
      },
      {
        id: 'nobridge-1',
        subtest: 'TestX',
        label: '5;5 – 5;11',
        raw: '10-15',
        standard: '3',
        zScore: '',
        percentile: '',
        hidden_age_min: 65,
        hidden_age_max: 71,
        source_column_key: 'TX::1',
      },
    ];

    const flags = analyzePageRows({
      pageId: 'fixture-raw-gap-nobridge',
      rows,
      structure: 'LOOKUP',
    });

    const gapFlag = flags.find((f) => f.code === 'LOOKUP_RAW_RANGE_GAP');
    expect(gapFlag).toBeDefined();
    expect(gapFlag?.severity).toBe('warning');
    expect(gapFlag?.suggestedFix).toBeUndefined();
  });

  it('suppresses gap flag when enough dash rows explain the gap (intentional normative gap)', () => {
    // Simulates CFPL: 0-2 at NS=1, dash at NS=2, dash at NS=3, 4 at NS=4
    // Gap size = 1 (missing raw=3), dash rows between = 2 → suppressed
    const rows: ExtractedRow[] = [
      {
        id: 'norm-gap-0', subtest: 'CFPL', label: '5;5 – 5;11',
        raw: '0-2', standard: '1', zScore: '', percentile: '',
        hidden_age_min: 65, hidden_age_max: 71, source_column_key: 'CFPL::1',
      },
      {
        id: 'norm-gap-1', subtest: 'CFPL', label: '5;5 – 5;11',
        raw: '-', standard: '2', zScore: '', percentile: '',
        hidden_age_min: 65, hidden_age_max: 71, source_column_key: 'CFPL::1',
      },
      {
        id: 'norm-gap-2', subtest: 'CFPL', label: '5;5 – 5;11',
        raw: '-', standard: '3', zScore: '', percentile: '',
        hidden_age_min: 65, hidden_age_max: 71, source_column_key: 'CFPL::1',
      },
      {
        id: 'norm-gap-3', subtest: 'CFPL', label: '5;5 – 5;11',
        raw: '4', standard: '4', zScore: '', percentile: '',
        hidden_age_min: 65, hidden_age_max: 71, source_column_key: 'CFPL::1',
      },
    ];

    const flags = analyzePageRows({
      pageId: 'fixture-intentional-gap',
      rows,
      structure: 'LOOKUP',
    });

    const gapFlags = flags.filter((f) => f.code === 'LOOKUP_RAW_RANGE_GAP');
    expect(gapFlags).toHaveLength(0);
  });
});
