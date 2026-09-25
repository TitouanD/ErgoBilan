import { describe, expect, it } from 'vitest';
import {
  deriveDisplayScores,
  formatScoreCompact,
  getPercentileFromScore,
  getZFromScore,
  normalizeScoreResult,
  pruneEmptyScores,
  resolveScaleType,
  zoneFromPercentile,
  zoneFromZ,
} from './scoring';

describe('resolveScaleType', () => {
  it('maps known aliases', () => {
    expect(resolveScaleType('NS')).toBe('scaled');
    expect(resolveScaleType('Standard')).toBe('standard');
    expect(resolveScaleType('t score')).toBe('t-score');
  });

  it('never falls back to "standard" for unknown or missing scales', () => {
    expect(resolveScaleType(undefined)).toBe('none');
    expect(resolveScaleType('')).toBe('none');
    expect(resolveScaleType('whatever')).toBe('none');
  });
});

describe('conversions', () => {
  it('converts a scaled score (mean 10, sd 3) to z and percentile', () => {
    const d = deriveDisplayScores({ value: '7', unit: 'NS' }, 'scaled');
    expect(d.zScore).toBe(-1);
    expect(d.percentile).toBe('16');
  });

  it('does not invent a z-score for NS on an unknown scale', () => {
    expect(getZFromScore({ value: '8', unit: 'NS' }, 'none')).toBeNull();
  });

  it('still converts ET and % on an unknown scale (scale-independent)', () => {
    expect(getZFromScore({ value: '-1.5', unit: 'ET' }, 'none')).toBe(-1.5);
    expect(getZFromScore({ value: '50', unit: '%' }, 'none')).toBeCloseTo(0, 2);
    expect(getPercentileFromScore({ value: '-1', unit: 'ET' }, 'none')).toBe(16);
  });

  it('reads the NS column as a percentile on percentile scales', () => {
    expect(getPercentileFromScore({ value: '5', unit: 'NS' }, 'percentile')).toBe(5);
  });

  it('accepts decimal commas', () => {
    expect(getZFromScore({ value: '-1,5', unit: 'ET' }, 'scaled')).toBe(-1.5);
  });
});

describe('zones', () => {
  it('uses the same boundaries in z and percentile', () => {
    expect(zoneFromZ(-2)).toBe('deficit');
    expect(zoneFromZ(-1.5)).toBe('fragile');
    expect(zoneFromZ(-1)).toBe('fragile');
    expect(zoneFromZ(-0.9)).toBe('normal');
    expect(zoneFromPercentile(2)).toBe('deficit');
    expect(zoneFromPercentile(10)).toBe('fragile');
    expect(zoneFromPercentile(16)).toBe('normal');
  });

  it('returns null without data', () => {
    expect(zoneFromZ(null)).toBeNull();
    expect(zoneFromPercentile(undefined)).toBeNull();
  });
});

describe('normalizeScoreResult', () => {
  it('passes the current shape through', () => {
    expect(normalizeScoreResult({ value: '12', unit: 'NS', observation: 'ok' })).toEqual({
      value: '12',
      unit: 'NS',
      observation: 'ok',
      qualitativeLabel: undefined,
      customLabel: undefined,
    });
  });

  it('converts legacy shapes using the entered metric', () => {
    expect(normalizeScoreResult({ zScore: -1.2, entryMetric: 'z', standard: '85' })).toMatchObject({ value: '-1.2', unit: 'ET' });
    expect(normalizeScoreResult({ standard: '85' })).toMatchObject({ value: '85', unit: 'NS' });
    expect(normalizeScoreResult({ raw: '42' })).toMatchObject({ value: '42', unit: 'raw' });
  });
});

describe('helpers', () => {
  it('formats compact scores', () => {
    expect(formatScoreCompact({ value: '1.50', unit: 'ET' })).toBe('ET +1.5');
    expect(formatScoreCompact({ value: '12', unit: 'raw' })).toBe('Brut 12');
    expect(formatScoreCompact({})).toBe('—');
  });

  it('prunes empty scores and empty tests', () => {
    expect(pruneEmptyScores({ a: { x: {}, y: { value: '3', unit: 'NS' } }, b: { z: {} } })).toEqual({
      a: { y: { value: '3', unit: 'NS' } },
    });
  });
});
