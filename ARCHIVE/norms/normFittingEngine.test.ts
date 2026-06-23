import { describe, expect, it } from 'vitest';
import { analyzeFitting, buildValueFixSuggestions, inferScoreTypeForLookup, inferScoreTypeForParametric, normalizeScoreTypeToken } from './normFittingEngine';
import type { FittingRow } from '../types';

describe('normFittingEngine', () => {
  it('normalizes score type tokens', () => {
    expect(normalizeScoreTypeToken('t_score')).toBe('t-score');
    expect(normalizeScoreTypeToken('  scaled ')).toBe('scaled');
    expect(normalizeScoreTypeToken('')).toBeNull();
  });

  it('infers LOOKUP scaled score type on scaled-like rows', () => {
    const rows: FittingRow[] = [
      { rawMin: 1, standardScore: 4, percentile: 2 },
      { rawMin: 2, standardScore: 7, percentile: 16 },
      { rawMin: 3, standardScore: 10, percentile: 50 },
      { rawMin: 4, standardScore: 13, percentile: 84 },
      { rawMin: 5, standardScore: 16, percentile: 98 },
    ];
    const inferred = inferScoreTypeForLookup(rows);
    expect(inferred.scoreType).toBe('scaled');
    expect(inferred.meta.bestScore).toBeLessThan(2.6);
  });

  it('returns null on LOOKUP rows without usable score values', () => {
    const rows: FittingRow[] = [
      { rawMin: 1 },
      { rawMin: 2 },
      { rawMin: 3 },
      { rawMin: 4 },
    ];
    const inferred = inferScoreTypeForLookup(rows);
    expect(inferred.scoreType).toBeNull();
  });

  it('infers PARAMETRIC standard score type from mean/sd rows', () => {
    const rows: FittingRow[] = [
      { mean: 100, sd: 15 },
      { mean: 101, sd: 14.8 },
      { mean: 99, sd: 15.2 },
      { mean: 100.5, sd: 15.1 },
    ];
    const inferred = inferScoreTypeForParametric(rows);
    expect(inferred.scoreType).toBe('standard');
  });

  it('flags mismatch and dispersion on LOOKUP analysis', () => {
    const rows: FittingRow[] = [
      { normId: 'n1', rawMin: 1, standardScore: 4, percentile: 2 },
      { normId: 'n2', rawMin: 2, standardScore: 3, percentile: 16 },
      { normId: 'n3', rawMin: 3, standardScore: 10, percentile: 50 },
      { normId: 'n4', rawMin: 4, standardScore: 13, percentile: 84 },
      { normId: 'n5', rawMin: 5, standardScore: 16, percentile: 98 },
    ];

    const result = analyzeFitting({
      rows,
      structure: 'LOOKUP',
      currentScoreType: 'standard',
      confidenceForValueFixes: 0.95,
    });

    expect(result.suggestedScoreType).toBe('scaled');
    expect(result.issues.some((issue) => issue.code === 'FIT_SCORE_TYPE_MISMATCH')).toBe(true);
    expect(result.issues.some((issue) => issue.code === 'FIT_LOOKUP_NON_MONOTONIC')).toBe(true);
  });

  it('does not flag decreasing monotonic tables (reverse scale) as non-monotonic', () => {
    const rows: FittingRow[] = [
      { normId: 'a1', seriesKey: 'g1', rawMin: 1, standardScore: 120, percentile: 91 },
      { normId: 'a2', seriesKey: 'g1', rawMin: 2, standardScore: 115, percentile: 84 },
      { normId: 'a3', seriesKey: 'g1', rawMin: 3, standardScore: 110, percentile: 75 },
      { normId: 'a4', seriesKey: 'g1', rawMin: 4, standardScore: 105, percentile: 63 },
      { normId: 'a5', seriesKey: 'g1', rawMin: 5, standardScore: 100, percentile: 50 },
    ];

    const result = analyzeFitting({
      rows,
      structure: 'LOOKUP',
      currentScoreType: 'standard',
    });

    expect(result.issues.some((issue) => issue.code === 'FIT_LOOKUP_NON_MONOTONIC')).toBe(false);
  });

  it('detects monotonic issues per series instead of mixing groups', () => {
    const rows: FittingRow[] = [
      { normId: 'g1-1', seriesKey: 'g1', rawMin: 1, standardScore: 80, percentile: 9 },
      { normId: 'g1-2', seriesKey: 'g1', rawMin: 2, standardScore: 85, percentile: 16 },
      { normId: 'g1-3', seriesKey: 'g1', rawMin: 3, standardScore: 90, percentile: 25 },
      { normId: 'g2-1', seriesKey: 'g2', rawMin: 1, standardScore: 120, percentile: 91 },
      { normId: 'g2-2', seriesKey: 'g2', rawMin: 2, standardScore: 115, percentile: 84 },
      { normId: 'g2-3', seriesKey: 'g2', rawMin: 3, standardScore: 110, percentile: 75 },
    ];

    const result = analyzeFitting({
      rows,
      structure: 'LOOKUP',
      currentScoreType: 'standard',
    });

    expect(result.issues.some((issue) => issue.code === 'FIT_LOOKUP_NON_MONOTONIC')).toBe(false);
  });

  it('gates value fixes with confidence threshold', () => {
    const rows: FittingRow[] = [
      { normId: 'n1', standardScore: 10, percentile: 10 },
      { normId: 'n2', standardScore: 13, percentile: 10 },
    ];

    const noFix = buildValueFixSuggestions({
      rows,
      structure: 'LOOKUP',
      currentScoreType: 'scaled',
      suggestedScoreType: 'scaled',
      confidence: 0.8,
      confidenceThreshold: 0.9,
    });
    expect(noFix.some((fix) => fix.kind === 'value_fix')).toBe(false);

    const withFix = buildValueFixSuggestions({
      rows,
      structure: 'LOOKUP',
      currentScoreType: 'scaled',
      suggestedScoreType: 'scaled',
      confidence: 0.95,
      confidenceThreshold: 0.9,
    });
    expect(withFix.some((fix) => fix.kind === 'value_fix')).toBe(true);
  });

  it('builds PARAMETRIC mean/sd value fixes only with high confidence', () => {
    const rows: FittingRow[] = [
      { normId: 'p1', mean: 20, sd: 12 },
      { normId: 'p2', mean: 19, sd: 11 },
    ];

    const noFix = buildValueFixSuggestions({
      rows,
      structure: 'PARAMETRIC',
      currentScoreType: 'scaled',
      suggestedScoreType: 'scaled',
      confidence: 0.88,
      confidenceThreshold: 0.9,
    });
    expect(noFix.some((fix) => fix.kind === 'value_fix')).toBe(false);

    const withFix = buildValueFixSuggestions({
      rows,
      structure: 'PARAMETRIC',
      currentScoreType: 'scaled',
      suggestedScoreType: 'scaled',
      confidence: 0.95,
      confidenceThreshold: 0.9,
    });

    expect(withFix.some((fix) => fix.field === 'mean')).toBe(true);
    expect(withFix.some((fix) => fix.field === 'sd')).toBe(true);
  });

});
