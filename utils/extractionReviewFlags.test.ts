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
});
