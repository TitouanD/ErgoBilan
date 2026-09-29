/**
 * resolvedScore.ts — the "score résolu" (see CONTEXT.md): a stored score
 * completed with everything derived from it (names, scale, z, percentile,
 * zone, displayed text).
 *
 * Screens, report data, the PDF and the AI payload read scores through this
 * module only, so the zone rule and the display format live in one place.
 * The maths stay in `scoring.ts`, the names in `catalogIndex.ts`.
 */

import type { CategoryDef, ScoreType, SubtestDef } from '../data/testCatalog';
import type { ScoreResult, TestData } from '../types';
import { CUSTOM_OBSERVATIONS_TEST_ID, type CatalogIndex, getScaleType, getSubtestDef, getSubtestName, getTestName } from './catalogIndex';
import {
  type ScoreZone,
  deriveDisplayScores,
  getPercentileFromScore,
  getZFromScore,
  hasScoreValue,
  parseNum,
  zoneFromPercentile,
  zoneFromZ,
} from './scoring';

/** Standardized metric, as written in the report: note standard, écart type, rang percentile. */
export type Metric = 'NS' | 'ET' | '%';

export interface ResolvedScore {
  testId: string;
  subtestId: string;
  /** `${testId}:${subtestId}` */
  key: string;
  label: string;
  testName: string;
  /** Catalogue definition (undefined for free observations and subtests missing from the catalogue). */
  def?: SubtestDef;
  scale: ScoreType;
  score: ScoreResult;
  /** Metric the practitioner typed; null for qualitative, free-text or empty scores. */
  metric: Metric | null;
  isQualitative: boolean;
  /** Free observation (pseudo-test or `custom_text` subtest): a note, not a score. */
  isFreeText: boolean;
  z: number | null;
  pct: number | null;
  /** From z, else from the percentile; null when the score is not standardized. */
  zone: ScoreZone | null;
  /** The score expressed in `metric` (converted with the scale; null when not convertible). */
  valueIn: (metric: Metric) => number | null;
  /** Text shown for the score, in `mode` when it can be derived, else as typed. */
  display: (mode?: Metric) => string;
}

export interface ResolvedTest {
  testId: string;
  testName: string;
  category?: CategoryDef;
  isFreeObservations: boolean;
  /** Mean z of the subtests that have one (null when none). */
  meanZ: number | null;
  /** Subtests holding data (score, observation or label), in stored order. */
  subtests: ResolvedScore[];
}

const isMetric = (unit: ScoreResult['unit']): unit is Metric => unit === 'NS' || unit === 'ET' || unit === '%';

const trimNumber = (value: number): string => String(parseFloat(value.toFixed(2)));

/**
 * `85 NS`, `+1.2 ET`, `42 %`. ET is always signed; pass `signed` for a
 * difference (`+5 NS`).
 */
export const formatMetricValue = (value: number, metric: Metric, signed = metric === 'ET'): string => {
  const text = trimNumber(value);
  return `${signed && value > 0 ? '+' : ''}${text} ${metric}`;
};

export const describeScore = (index: CatalogIndex, testId: string, subtestId: string, stored?: ScoreResult): ResolvedScore => {
  const score = stored ?? {};
  const def = getSubtestDef(index, testId, subtestId);
  const scale = getScaleType(index, testId, subtestId);
  const metric = isMetric(score.unit) && parseNum(score.value) !== null ? score.unit : null;
  const isFreeText = testId === CUSTOM_OBSERVATIONS_TEST_ID || def?.inputModel === 'custom_text';
  const isQualitative = !isFreeText && (def?.inputModel === 'qualitative_category' || score.unit === 'qualitative');
  const z = metric ? getZFromScore(score, scale) : null;
  const pct = metric ? getPercentileFromScore(score, scale) : null;

  const valueIn = (target: Metric): number | null => {
    if (!metric) return null;
    if (target === metric) return parseNum(score.value);
    if (target === 'ET') return z !== null ? parseFloat(z.toFixed(2)) : null;
    const derived = deriveDisplayScores(score, scale);
    return parseNum(target === 'NS' ? derived.standard : derived.percentile);
  };

  const display = (mode?: Metric): string => {
    if (!score.value?.trim()) return '—';
    if (!metric) return score.qualitativeLabel || score.value;
    const shown = mode && valueIn(mode) !== null ? mode : metric;
    return formatMetricValue(valueIn(shown)!, shown);
  };

  return {
    testId,
    subtestId,
    key: `${testId}:${subtestId}`,
    label: getSubtestName(index, testId, subtestId, score.customLabel),
    testName: getTestName(index, testId),
    def,
    scale,
    score,
    metric,
    isQualitative,
    isFreeText,
    z,
    pct,
    zone: zoneFromZ(z) ?? zoneFromPercentile(pct),
    valueIn,
    display,
  };
};

export const resolveScores = (tests: TestData, index: CatalogIndex): ResolvedTest[] =>
  Object.entries(tests).map(([testId, subtests]) => {
    const resolved = Object.entries(subtests)
      .filter(([, score]) => hasScoreValue(score))
      .map(([subtestId, score]) => describeScore(index, testId, subtestId, score));
    const zs = resolved.flatMap((r) => (r.z !== null ? [r.z] : []));
    return {
      testId,
      testName: getTestName(index, testId),
      category: index.categoryByTestId.get(testId),
      isFreeObservations: testId === CUSTOM_OBSERVATIONS_TEST_ID,
      meanZ: zs.length > 0 ? zs.reduce((a, b) => a + b, 0) / zs.length : null,
      subtests: resolved,
    };
  });
