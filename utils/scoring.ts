/**
 * scoring.ts — Shared scoring utilities.
 *
 * Single source of truth for:
 *   - Parametric NS/ET/% conversion (deriveScores, SCALE_PARAMS, normal CDF helpers)
 *   - The new minimal ScoreResult shape: `{ value, unit, observation, ... }`
 *   - Backward-compatible normalization of legacy ScoreResult objects
 *     (raw/standard/percentile/zScore/status/entryMetric/scoreSource/...)
 *     so older bilans keep working without any migration step.
 *
 * Writers (ScorePage.tsx, Step2Tests.tsx) should only ever persist the new
 * minimal shape. Readers should call `normalizeScoreResult` (or rely on
 * normalization already applied upstream) before reading `.value` / `.unit`.
 */

import type { ScoreResult } from '../types';
import type { ScoreType } from '../data/testCatalog';

// ─── Unit / metric vocabulary ─────────────────────────────────────────────
export type ScoreUnit = 'NS' | 'ET' | '%' | 'qualitative' | 'raw';
export type ScoreMetric = 'standard' | 'z' | 'percentile';

export const parseNum = (value: string | undefined): number | null => {
  const n = parseFloat(String(value ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

export const isManualOnlyScoreType = (scoreType?: ScoreType | string): boolean => (
  String(scoreType || '').toLowerCase() === 'none'
);

// ─── Parametric conversion engine ─────────────────────────────────────────
export const SCALE_PARAMS: Record<string, { mean: number; sd: number } | null> = {
  scaled:     { mean: 10,  sd: 3  },
  standard:   { mean: 100, sd: 15 },
  't-score':  { mean: 50,  sd: 10 },
  sten:       { mean: 5.5, sd: 2  },
  stanine:    { mean: 5,   sd: 2  },
  percentile: null,
  none:       null,
};

// Standard normal CDF (Abramowitz & Stegun 26.2.17)
export const normalCDF = (z: number): number => {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const poly = t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const p = 1 - (1 / Math.sqrt(2 * Math.PI)) * Math.exp(-0.5 * z * z) * poly;
  return z >= 0 ? p : 1 - p;
};

// Inverse normal CDF (rational approximation)
export const invNormalCDF = (p: number): number => {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  if (p < 0.5) return -invNormalCDF(1 - p);
  const t = Math.sqrt(-2 * Math.log(1 - p));
  return t - (2.515517 + 0.802853 * t + 0.010328 * t * t) /
    (1 + 1.432788 * t + 0.189269 * t * t + 0.001308 * t * t * t);
};

export interface DerivedScores { standard?: string; zScore?: number; percentile?: string; }

/** Given a value entered in one metric, derive the other two (display-only, never persisted). */
export const deriveScores = (value: number, metric: ScoreMetric, scoreType: string): DerivedScores => {
  const params = SCALE_PARAMS[scoreType];
  const result: DerivedScores = {};
  let z: number | null = null;

  if (metric === 'standard') {
    if (params) {
      z = (value - params.mean) / params.sd;
    } else if (scoreType === 'percentile') {
      result.percentile = String(value);
      const pf = value / 100;
      if (pf > 0 && pf < 1) z = invNormalCDF(pf);
    }
    result.standard = String(value);
  } else if (metric === 'z') {
    z = value;
    if (params) result.standard = String(Math.round(z * params.sd + params.mean));
  } else if (metric === 'percentile') {
    const pf = value / 100;
    if (pf > 0 && pf < 1) {
      z = invNormalCDF(pf);
      if (params) result.standard = String(Math.round(z * params.sd + params.mean));
    }
    result.percentile = String(value);
  }

  if (z !== null && Number.isFinite(z)) {
    result.zScore = parseFloat(z.toFixed(3));
    if (metric !== 'percentile') {
      result.percentile = String(Math.round(normalCDF(z) * 100));
    }
  }
  return result;
};

export const unitToMetric = (unit?: ScoreUnit): ScoreMetric | null => {
  if (unit === 'NS') return 'standard';
  if (unit === 'ET') return 'z';
  if (unit === '%') return 'percentile';
  return null;
};

export const metricToUnit = (metric?: ScoreMetric): ScoreUnit | null => {
  if (metric === 'standard') return 'NS';
  if (metric === 'z') return 'ET';
  if (metric === 'percentile') return '%';
  return null;
};

/**
 * Derive NS/ET/% display values from the single stored `{value, unit}` pair.
 * Used to show non-editable "placeholder" values in the columns the
 * practitioner did NOT fill in. Never persisted.
 */
export const deriveDisplayScores = (score: Pick<ScoreResult, 'value' | 'unit'> | undefined, scoreType: string): DerivedScores => {
  if (!score?.value || isManualOnlyScoreType(scoreType)) return {};
  const metric = unitToMetric(score.unit);
  if (!metric) return {};
  const n = parseNum(score.value);
  if (n === null) return {};
  return deriveScores(n, metric, scoreType);
};

/** Recompute a z-score from the stored `{value, unit}` pair (for charts/severity coloring). */
export const getZFromScore = (score: Pick<ScoreResult, 'value' | 'unit'> | undefined, scoreType?: string): number | null => {
  if (!score?.value) return null;
  const metric = unitToMetric(score.unit);
  if (!metric) return null;
  const n = parseNum(score.value);
  if (n === null) return null;
  if (metric === 'z') return n;
  const derived = deriveScores(n, metric, String(scoreType || 'standard'));
  return typeof derived.zScore === 'number' && Number.isFinite(derived.zScore) ? derived.zScore : null;
};

export const scoreToneFromZ = (z: number | null): 'bad' | 'warn' | 'good' | null => {
  if (z === null || !Number.isFinite(z)) return null;
  if (z <= -2) return 'bad';
  if (z <= -1) return 'warn';
  return 'good';
};

export const zToneClass = (z: number | null): string => {
  if (z === null || !Number.isFinite(z)) return 'text-[var(--text-secondary)]';
  if (z <= -2) return 'text-rose-600 font-bold';
  if (z <= -1) return 'text-amber-600 font-bold';
  return 'text-emerald-600 font-bold';
};

// ─── Backward-compatible normalization ────────────────────────────────────

/**
 * Convert any ScoreResult (new minimal shape OR legacy shape with
 * raw/standard/percentile/zScore/entryMetric/scoreSource/status/...) into
 * the new minimal shape `{ value, unit, observation, qualitativeLabel,
 * customLabel, rawItems }`.
 *
 * Idempotent — safe to call on an already-normalized score.
 */
export const normalizeScoreResult = (s: ScoreResult | undefined | null): ScoreResult => {
  if (!s) return {};

  // Already new format — pass through, dropping any lingering legacy fields.
  if (s.value !== undefined && s.unit !== undefined) {
    return {
      value: s.value,
      unit: s.unit,
      observation: s.observation,
      qualitativeLabel: s.qualitativeLabel,
      customLabel: s.customLabel,
      rawItems: s.rawItems,
    };
  }

  let value: string | undefined;
  let unit: ScoreUnit | undefined;

  if (s.qualitativeCode) {
    value = s.qualitativeCode;
    unit = 'qualitative';
  } else if (s.entryMetric === 'z' || s.scoreSource === 'manual_et') {
    if (typeof s.zScore === 'number' && Number.isFinite(s.zScore)) { value = String(s.zScore); unit = 'ET'; }
  } else if (s.entryMetric === 'percentile' || s.scoreSource === 'manual_pct') {
    if (s.percentile) { value = String(s.percentile); unit = '%'; }
  } else if (s.entryMetric === 'raw' || s.scoreSource === 'manual_raw') {
    if (s.raw) { value = String(s.raw); unit = 'raw'; }
  } else if (s.standard) {
    value = String(s.standard);
    unit = 'NS';
  }

  // Fallbacks if the above didn't resolve a value (older / inconsistent data).
  if (value === undefined) {
    if (s.standard) { value = String(s.standard); unit = 'NS'; }
    else if (typeof s.zScore === 'number' && Number.isFinite(s.zScore)) { value = String(s.zScore); unit = 'ET'; }
    else if (s.percentile) { value = String(s.percentile); unit = '%'; }
    else if (s.raw) { value = String(s.raw); unit = 'raw'; }
  }

  return {
    ...(value !== undefined ? { value } : {}),
    ...(unit !== undefined ? { unit } : {}),
    observation: s.observation,
    qualitativeLabel: s.qualitativeLabel,
    customLabel: s.customLabel,
    rawItems: s.rawItems,
  };
};

/** Normalize every ScoreResult inside a TestData object (nested test → subtest → ScoreResult). */
export const normalizeTestData = <T extends Record<string, Record<string, ScoreResult>>>(tests: T | undefined | null): T => {
  if (!tests) return {} as T;
  const out: Record<string, Record<string, ScoreResult>> = {};
  for (const [testId, subtests] of Object.entries(tests)) {
    out[testId] = {};
    for (const [subId, score] of Object.entries(subtests)) {
      out[testId][subId] = normalizeScoreResult(score);
    }
  }
  return out as T;
};

/** Normalize a flat Record<subtestId, ScoreResult> (legacy `PatientAssessment.results`). */
export const normalizeFlatResults = (results: Record<string, ScoreResult> | undefined | null): Record<string, ScoreResult> => {
  if (!results) return {};
  const out: Record<string, ScoreResult> = {};
  for (const [subId, score] of Object.entries(results)) {
    out[subId] = normalizeScoreResult(score);
  }
  return out;
};

/** Does this (normalized) ScoreResult carry any meaningful data? */
export const hasScoreValue = (r?: Partial<ScoreResult>): boolean => {
  if (!r) return false;
  return Boolean(
    (r.value && String(r.value).trim()) ||
    (r.observation && String(r.observation).trim()) ||
    (r.customLabel && String(r.customLabel).trim()),
  );
};

/** Human-readable "NS 85" / "ET +1.2" / "42 %" / label for compact display. */
export const formatScoreCompact = (r?: Partial<ScoreResult>): string => {
  if (!r?.value) return '—';
  if (r.unit === 'qualitative') return r.qualitativeLabel || r.value;
  if (r.unit === 'ET') {
    const n = parseNum(r.value);
    return n !== null ? `ET ${n > 0 ? '+' : ''}${n}` : `ET ${r.value}`;
  }
  if (r.unit === '%') return `${r.value}\u202f%`;
  if (r.unit === 'raw') return `Brut ${r.value}`;
  return `NS ${r.value}`;
};
