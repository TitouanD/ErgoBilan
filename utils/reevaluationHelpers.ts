/**
 * reevaluationHelpers.ts — score comparison between a previous assessment and
 * a re-evaluation (delta table, summaries sent to the AI).
 *
 * The trend (amélioration / stable / régression) is decided on the z-score
 * difference so that the same threshold means the same thing for every scale
 * (±0.5 SD = ±1.5 points on a scaled score, ±7.5 points on a standard score).
 * When a z-score cannot be computed (unknown scale), no trend is shown.
 */

import type { ScoreResult, TestData } from '../types';
import { type CatalogIndex, getScaleType, getSubtestName, getTestName } from './catalogIndex';
import { deriveDisplayScores, formatZ, getZFromScore, parseNum } from './scoring';

/** Metric shown in the delta table — the one typed in the previous assessment. */
export type DeltaMetric = 'NS' | 'ET' | '%';
export type Trend = 'improved' | 'stable' | 'declined';

/** |Δz| below this value is considered stable. */
export const STABILITY_THRESHOLD_Z = 0.5;

export interface DeltaEntry {
  testId: string;
  subtestId: string;
  subtestName: string;
  testName: string;
  metric: DeltaMetric;
  prevValue: number | null;
  /** Re-evaluation value in `metric` (converted when typed in another metric; null when not convertible). */
  newValue: number | null;
  /** The subtest has a standardized score in the re-evaluation. false = "non mesuré". */
  measured: boolean;
  /** Difference in the displayed metric (null when either side is missing). */
  delta: number | null;
  /** Difference in z units (null when not computable). */
  zDelta: number | null;
  /** null = not re-measured, or trend not computable. */
  trend: Trend | null;
}

export const trendFromZDelta = (zDelta: number | null): Trend | null => {
  if (zDelta === null || !Number.isFinite(zDelta)) return null;
  if (zDelta > STABILITY_THRESHOLD_Z) return 'improved';
  if (zDelta < -STABILITY_THRESHOLD_Z) return 'declined';
  return 'stable';
};

export const TREND_LABEL: Record<Trend, string> = { improved: 'amélioration', stable: 'stable', declined: 'régression' };

/** Standardized metric of a (normalized) score, or null for raw/qualitative/empty scores. */
export const detectMetric = (score?: ScoreResult): DeltaMetric | null => {
  if (score?.unit === 'NS' || score?.unit === 'ET' || score?.unit === '%') return score.unit;
  return null;
};

/**
 * Numeric value of `score` expressed in `metric`. Only the typed metric is
 * stored: a score typed in another metric is converted with the subtest scale
 * (null when the scale is unknown and the metrics differ).
 */
export const extractMetricValue = (score: ScoreResult | undefined, metric: DeltaMetric, scaleType: string): number | null => {
  const typed = detectMetric(score);
  if (!typed) return null;
  if (typed === metric) return parseNum(score?.value);
  const derived = deriveDisplayScores(score, scaleType);
  if (metric === 'ET') return typeof derived.zScore === 'number' && Number.isFinite(derived.zScore) ? parseFloat(derived.zScore.toFixed(2)) : null;
  return parseNum(metric === 'NS' ? derived.standard : derived.percentile);
};

export const buildDeltaEntries = (previousTests: TestData, newTests: TestData, index: CatalogIndex): DeltaEntry[] => {
  const entries: DeltaEntry[] = [];
  const testIds = new Set([...Object.keys(previousTests), ...Object.keys(newTests)]);

  for (const testId of testIds) {
    const prevSubtests = previousTests[testId] ?? {};
    const newSubtests = newTests[testId] ?? {};
    for (const subtestId of new Set([...Object.keys(prevSubtests), ...Object.keys(newSubtests)])) {
      const prevScore = prevSubtests[subtestId];
      const newScore = newSubtests[subtestId];
      const metric = detectMetric(prevScore) ?? detectMetric(newScore);
      if (!metric) continue; // qualitative / raw / empty on both sides: nothing to compare

      const scaleType = getScaleType(index, testId, subtestId);
      const prevValue = extractMetricValue(prevScore, metric, scaleType);
      const newValue = extractMetricValue(newScore, metric, scaleType);
      const prevZ = getZFromScore(prevScore, scaleType);
      const newZ = getZFromScore(newScore, scaleType);
      const zDelta = prevZ !== null && newZ !== null ? parseFloat((newZ - prevZ).toFixed(2)) : null;

      entries.push({
        testId,
        subtestId,
        subtestName: getSubtestName(index, testId, subtestId, prevScore?.customLabel ?? newScore?.customLabel),
        testName: getTestName(index, testId),
        metric,
        prevValue,
        newValue,
        measured: detectMetric(newScore) !== null && parseNum(newScore?.value) !== null,
        delta: prevValue !== null && newValue !== null ? parseFloat((newValue - prevValue).toFixed(2)) : null,
        zDelta,
        trend: trendFromZDelta(zDelta),
      });
    }
  }
  return entries;
};

export const buildDeltaStats = (entries: DeltaEntry[]) => ({
  total: entries.filter((d) => d.trend !== null).length,
  improved: entries.filter((d) => d.trend === 'improved').length,
  stable: entries.filter((d) => d.trend === 'stable').length,
  declined: entries.filter((d) => d.trend === 'declined').length,
  notMeasured: entries.filter((d) => !d.measured).length,
});

/** Plain-text scores summary for the AI (one line per scored subtest). */
export const buildScoresSummaryText = (tests: TestData, index: CatalogIndex, date?: string): string => {
  const lines: string[] = [];
  for (const [testId, subtests] of Object.entries(tests)) {
    for (const [subtestId, score] of Object.entries(subtests)) {
      const name = `${getSubtestName(index, testId, subtestId, score.customLabel)} (${getTestName(index, testId)})`;
      const metric = detectMetric(score);
      if (metric && score.value) lines.push(`${name}: ${score.value} ${metric}`);
      else if (score.unit === 'qualitative' && (score.qualitativeLabel || score.value)) lines.push(`${name}: ${score.qualitativeLabel || score.value}`);
      else if (score.unit === 'raw' && score.value) lines.push(`${name}: brut ${score.value}`);
    }
  }
  const header = date ? `[${date}]\n` : '';
  return (header + (lines.join('\n') || 'Aucun score enregistré.')).trim();
};

/** Plain-text evolution summary for the AI. */
export const buildEvolutionSummaryText = (deltas: DeltaEntry[]): string =>
  deltas
    .filter((d) => d.delta !== null)
    .map((d) => {
      const trend = d.trend ? TREND_LABEL[d.trend] : 'tendance non calculable';
      const zPart = d.zDelta !== null ? `, soit ${formatZ(d.zDelta, 2)} ET` : '';
      return `${d.subtestName} (${d.testName}): ${formatZ(d.delta!, 1)} ${d.metric}${zPart} (${trend})`;
    })
    .join('\n') || 'Pas assez de données pour calculer des deltas.';
