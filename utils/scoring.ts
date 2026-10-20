/**
 * scoring.ts — single source of truth for score maths and interpretation.
 *
 * - Scale types (`score_type` in the catalogue) and their mean/SD.
 * - Conversions between the three standardized metrics: NS (scale score),
 *   ET (z-score / écart-type) and % (percentile rank).
 * - Interpretation zones (deficit / fragile / normal), shared by the score
 *   tables, the on-screen report and the PDF so they can never drift apart.
 * - The minimal persisted `ScoreResult` shape (`{ value, unit, ... }`) and the
 *   backward-compatible normalization of scores saved by older app versions.
 *
 * A score stores only the metric the practitioner typed ("last wins"); the
 * other metrics are derived on the fly and never persisted.
 */

import type { ScoreResult } from '../types';
import type { ScoreType } from '../data/testCatalog';

// ─── Vocabulary ─────────────────────────────────────────────────────────────

export type ScoreUnit = NonNullable<ScoreResult['unit']>;
/** A standardized metric the practitioner can type into a score table. */
export type ScoreMetric = 'standard' | 'z' | 'percentile';

export const parseNum = (value: string | number | undefined | null): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const n = parseFloat(String(value ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

// ─── Scale types ────────────────────────────────────────────────────────────

/** Mean / SD of each parametric scale. `null` = no parametric conversion from NS. */
export const SCALE_PARAMS: Record<ScoreType, { mean: number; sd: number } | null> = {
  scaled: { mean: 10, sd: 3 },
  standard: { mean: 100, sd: 15 },
  't-score': { mean: 50, sd: 10 },
  // Vineland « notes v » (sous-domaines, #90).
  'v-scale': { mean: 15, sd: 3 },
  // Notes d'échelle des sous-tests du BOT-2 (#123).
  'scaled-15': { mean: 15, sd: 5 },
  sten: { mean: 5.5, sd: 2 },
  stanine: { mean: 5, sd: 2 },
  percentile: null,
  none: null,
};

const SCALE_ALIASES: Record<string, ScoreType> = {
  standard: 'standard',
  std: 'standard',
  standard_score: 'standard',
  scaled: 'scaled',
  ns: 'scaled',
  note_standard: 'scaled',
  'note standard': 'scaled',
  scaled_score: 'scaled',
  't-score': 't-score',
  tscore: 't-score',
  't score': 't-score',
  t: 't-score',
  'v-scale': 'v-scale',
  vscale: 'v-scale',
  'note v': 'v-scale',
  'scaled-15': 'scaled-15',
  percentile: 'percentile',
  pct: 'percentile',
  percentile_rank: 'percentile',
  'percentile rank': 'percentile',
  sten: 'sten',
  stanine: 'stanine',
  stennine: 'stanine',
};

/**
 * Normalize any catalogue/legacy scale label to a known `ScoreType`.
 * Unknown or missing values resolve to `'none'` — never to `'standard'`:
 * guessing a mean of 100 turns a scaled score of 8 into z ≈ −6.
 */
export const resolveScaleType = (value?: string | null): ScoreType => {
  if (!value) return 'none';
  return SCALE_ALIASES[value.toLowerCase().trim()] ?? 'none';
};

/** True when the scale is unknown: NS cannot be converted to ET/% (ET ↔ % still can). */
export const isUnscaled = (scaleType?: string | null): boolean => resolveScaleType(scaleType) === 'none';

// ─── Normal distribution helpers ────────────────────────────────────────────

/** Standard normal CDF (Abramowitz & Stegun 26.2.17). */
export const normalCDF = (z: number): number => {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const poly = t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const p = 1 - (1 / Math.sqrt(2 * Math.PI)) * Math.exp(-0.5 * z * z) * poly;
  return z >= 0 ? p : 1 - p;
};

/** Inverse standard normal CDF (rational approximation). */
export const invNormalCDF = (p: number): number => {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  if (p < 0.5) return -invNormalCDF(1 - p);
  const t = Math.sqrt(-2 * Math.log(1 - p));
  return t - (2.515517 + 0.802853 * t + 0.010328 * t * t) / (1 + 1.432788 * t + 0.189269 * t * t + 0.001308 * t * t * t);
};

// ─── Conversions ────────────────────────────────────────────────────────────

export interface DerivedScores {
  standard?: string;
  zScore?: number;
  percentile?: string;
}

/**
 * Given a value typed in one metric, derive the other two (display only).
 * ET ↔ % conversions are scale-independent; NS needs a parametric scale
 * (or a percentile scale, where the NS column already holds a percentile).
 */
export const deriveScores = (value: number, metric: ScoreMetric, scaleType: string): DerivedScores => {
  const scale = resolveScaleType(scaleType);
  const params = SCALE_PARAMS[scale];
  const result: DerivedScores = {};
  let z: number | null = null;

  if (metric === 'standard') {
    result.standard = String(value);
    if (params) {
      z = (value - params.mean) / params.sd;
    } else if (scale === 'percentile') {
      result.percentile = String(value);
      const pf = value / 100;
      if (pf > 0 && pf < 1) z = invNormalCDF(pf);
    }
  } else if (metric === 'z') {
    z = value;
    if (params) result.standard = String(Math.round(z * params.sd + params.mean));
  } else {
    result.percentile = String(value);
    const pf = value / 100;
    if (pf > 0 && pf < 1) {
      z = invNormalCDF(pf);
      if (params) result.standard = String(Math.round(z * params.sd + params.mean));
    }
  }

  if (z !== null && Number.isFinite(z)) {
    result.zScore = parseFloat(z.toFixed(3));
    if (result.percentile === undefined) result.percentile = String(Math.round(normalCDF(z) * 100));
  }
  return result;
};

export const unitToMetric = (unit?: ScoreUnit): ScoreMetric | null => {
  if (unit === 'NS') return 'standard';
  if (unit === 'ET') return 'z';
  if (unit === '%') return 'percentile';
  return null;
};

export const metricToUnit = (metric: ScoreMetric): ScoreUnit => (metric === 'standard' ? 'NS' : metric === 'z' ? 'ET' : '%');

/** Derive NS/ET/% display values from a stored `{ value, unit }` pair. Never persisted. */
export const deriveDisplayScores = (score: Pick<ScoreResult, 'value' | 'unit'> | undefined, scaleType: string): DerivedScores => {
  const metric = unitToMetric(score?.unit);
  const n = parseNum(score?.value);
  if (!metric || n === null) return {};
  return deriveScores(n, metric, scaleType);
};

/** z-score of a stored score (null when it cannot be computed). */
export const getZFromScore = (score: Pick<ScoreResult, 'value' | 'unit'> | undefined, scaleType: string): number | null => {
  const derived = deriveDisplayScores(score, scaleType);
  return typeof derived.zScore === 'number' && Number.isFinite(derived.zScore) ? derived.zScore : null;
};

/** Percentile rank of a stored score (null when it cannot be computed). */
export const getPercentileFromScore = (score: Pick<ScoreResult, 'value' | 'unit'> | undefined, scaleType: string): number | null => {
  if (score?.unit === '%') return parseNum(score.value);
  return parseNum(deriveDisplayScores(score, scaleType).percentile);
};

// ─── Interpretation zones ───────────────────────────────────────────────────

export type ScoreZone = 'deficit' | 'fragile' | 'normal';

/** Zone boundaries, in z units. Percentile boundaries are derived from them (≈ P2.3 and P15.9). */
export const ZONE_Z_THRESHOLDS = { deficit: -2, fragile: -1 } as const;
export const ZONE_PERCENTILE_THRESHOLDS = {
  deficit: normalCDF(ZONE_Z_THRESHOLDS.deficit) * 100,
  fragile: normalCDF(ZONE_Z_THRESHOLDS.fragile) * 100,
} as const;

export const zoneFromZ = (z: number | null | undefined): ScoreZone | null => {
  if (z === null || z === undefined || !Number.isFinite(z)) return null;
  if (z <= ZONE_Z_THRESHOLDS.deficit) return 'deficit';
  if (z <= ZONE_Z_THRESHOLDS.fragile) return 'fragile';
  return 'normal';
};

export const zoneFromPercentile = (pct: number | null | undefined): ScoreZone | null => {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return null;
  if (pct <= ZONE_PERCENTILE_THRESHOLDS.deficit) return 'deficit';
  if (pct <= ZONE_PERCENTILE_THRESHOLDS.fragile) return 'fragile';
  return 'normal';
};

/** Display metadata of each zone (hex colors are used by both Recharts/HTML and @react-pdf). */
export const ZONE_META: Record<ScoreZone, { label: string; color: string; band: string; zLegend: string; pctLegend: string }> = {
  deficit: {
    label: 'Zone de difficulté',
    color: '#E07A5F',
    band: '#FFE4E6',
    zLegend: 'Inférieur ou égal à -2 ET',
    pctLegend: 'Rang percentile inférieur ou égal à 2,3 (-2 ET)',
  },
  fragile: {
    label: 'Zone de fragilité',
    color: '#F2CC8F',
    band: '#FEF3C7',
    zLegend: 'Entre -2 et -1 ET',
    pctLegend: 'Rang percentile entre 2,3 et 15,9 (-2 à -1 ET)',
  },
  normal: {
    label: 'Dans la moyenne',
    color: '#81B29A',
    band: '#D1FAE5',
    zLegend: 'Supérieur à -1 ET',
    pctLegend: 'Rang percentile supérieur à 15,9',
  },
};

// ─── Formatting ─────────────────────────────────────────────────────────────

/** Signed z for chart labels. Scores are formatted by `resolvedScore.ts`. */
export const formatZ = (z: number, digits = 2): string => `${z > 0 ? '+' : ''}${z.toFixed(digits)}`;

// ─── Persisted shape & backward compatibility ───────────────────────────────

/**
 * Convert any ScoreResult (current minimal shape OR legacy shape with
 * raw/standard/percentile/zScore/entryMetric/scoreSource/...) into the
 * minimal shape. Idempotent.
 */
export const normalizeScoreResult = (s: ScoreResult | undefined | null): ScoreResult => {
  if (!s) return {};
  const passthrough = {
    observation: s.observation,
    qualitativeLabel: s.qualitativeLabel,
    customLabel: s.customLabel,
  };
  // Raw values are no longer entered: keep them readable as the start of the observation.
  const keepRawAsObservation = (raw: string): ScoreResult => ({
    ...passthrough,
    observation: [`Brut : ${raw}`, s.observation?.trim()].filter(Boolean).join('\n'),
  });

  if (s.value !== undefined && s.unit !== undefined) {
    if ((s.unit as string) === 'raw') return keepRawAsObservation(s.value);
    return { value: s.value, unit: s.unit, ...passthrough };
  }

  let value: string | undefined;
  let unit: ScoreUnit | undefined;
  const set = (v: string | number, u: ScoreUnit) => {
    value = String(v);
    unit = u;
  };
  const hasZ = typeof s.zScore === 'number' && Number.isFinite(s.zScore);

  if (s.qualitativeCode) set(s.qualitativeCode, 'qualitative');
  else if ((s.entryMetric === 'z' || s.scoreSource === 'manual_et') && hasZ) set(s.zScore!, 'ET');
  else if ((s.entryMetric === 'percentile' || s.scoreSource === 'manual_pct') && s.percentile) set(s.percentile, '%');
  else if ((s.entryMetric === 'raw' || s.scoreSource === 'manual_raw') && s.raw) return keepRawAsObservation(s.raw);
  else if (s.standard) set(s.standard, 'NS');
  else if (hasZ) set(s.zScore!, 'ET');
  else if (s.percentile) set(s.percentile, '%');
  else if (s.raw) return keepRawAsObservation(s.raw);

  return { ...(value !== undefined ? { value, unit } : {}), ...passthrough };
};

/** Normalize every ScoreResult inside a TestData object (test → subtest → score). */
export const normalizeTestData = <T extends Record<string, Record<string, ScoreResult>>>(tests: T | undefined | null): T => {
  if (!tests) return {} as T;
  const out: Record<string, Record<string, ScoreResult>> = {};
  for (const [testId, subtests] of Object.entries(tests)) {
    out[testId] = normalizeFlatResults(subtests);
  }
  return out as T;
};

/** Normalize a flat Record<subtestId, ScoreResult> (`PatientAssessment.results`). */
export const normalizeFlatResults = (results: Record<string, ScoreResult> | undefined | null): Record<string, ScoreResult> => {
  const out: Record<string, ScoreResult> = {};
  for (const [subId, score] of Object.entries(results ?? {})) out[subId] = normalizeScoreResult(score);
  return out;
};

/** Does this (normalized) ScoreResult carry any meaningful data? */
export const hasScoreValue = (r?: Partial<ScoreResult>): boolean =>
  Boolean(
    (r?.value && String(r.value).trim()) ||
    (r?.observation && String(r.observation).trim()) ||
    (r?.customLabel && String(r.customLabel).trim()),
  );

/** Drop subtests without data and tests left empty (e.g. before persisting a finalized assessment). */
export const pruneEmptyScores = (tests: Record<string, Record<string, ScoreResult>>): Record<string, Record<string, ScoreResult>> => {
  const out: Record<string, Record<string, ScoreResult>> = {};
  for (const [testId, subtests] of Object.entries(tests)) {
    const kept = Object.fromEntries(Object.entries(subtests).filter(([, s]) => hasScoreValue(s)));
    if (Object.keys(kept).length > 0) out[testId] = kept;
  }
  return out;
};
