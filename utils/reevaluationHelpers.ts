/**
 * reevaluationHelpers.ts — score comparison between a previous assessment and
 * a re-evaluation (delta table, summaries sent to the AI).
 *
 * The trend (amélioration / stable / régression) is decided on the z-score
 * difference so that the same threshold means the same thing for every scale
 * (±0.5 SD = ±1.5 points on a scaled score, ±7.5 points on a standard score).
 * When a z-score cannot be computed (unknown scale), no trend is shown.
 */

import type { TestData } from '../types';
import type { CatalogIndex } from './catalogIndex';
import { type Metric, describeScore, formatMetricValue, resolveScores } from './resolvedScore';

/** Metric shown in the delta table — the one typed in the previous assessment. */
export type DeltaMetric = Metric;
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

export const buildDeltaEntries = (previousTests: TestData, newTests: TestData, index: CatalogIndex): DeltaEntry[] => {
  const entries: DeltaEntry[] = [];
  const testIds = new Set([...Object.keys(previousTests), ...Object.keys(newTests)]);

  for (const testId of testIds) {
    const prevSubtests = previousTests[testId] ?? {};
    const newSubtests = newTests[testId] ?? {};
    for (const subtestId of new Set([...Object.keys(prevSubtests), ...Object.keys(newSubtests)])) {
      const prev = describeScore(index, testId, subtestId, prevSubtests[subtestId]);
      const next = describeScore(index, testId, subtestId, newSubtests[subtestId]);
      const metric = prev.metric ?? next.metric;
      if (!metric) continue; // qualitative / empty on both sides: nothing to compare

      const prevValue = prev.valueIn(metric);
      const newValue = next.valueIn(metric);
      const zDelta = prev.z !== null && next.z !== null ? parseFloat((next.z - prev.z).toFixed(2)) : null;

      entries.push({
        testId,
        subtestId,
        subtestName: prev.score.customLabel ? prev.label : next.label,
        testName: prev.testName,
        metric,
        prevValue,
        newValue,
        measured: next.metric !== null,
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
  const lines = resolveScores(tests, index).flatMap((test) =>
    test.subtests.filter((r) => r.metric !== null || r.isQualitative).map((r) => `${r.label} (${r.testName}): ${r.display()}`),
  );
  const header = date ? `[${date}]\n` : '';
  return (header + (lines.join('\n') || 'Aucun score enregistré.')).trim();
};

/** Plain-text evolution summary for the AI. */
export const buildEvolutionSummaryText = (deltas: DeltaEntry[]): string =>
  deltas
    .filter((d) => d.delta !== null)
    .map((d) => {
      const trend = d.trend ? TREND_LABEL[d.trend] : 'tendance non calculable';
      const zPart = d.zDelta !== null ? `, soit ${formatMetricValue(d.zDelta, 'ET')}` : '';
      return `${d.subtestName} (${d.testName}): ${formatMetricValue(d.delta!, d.metric, true)}${zPart} (${trend})`;
    })
    .join('\n') || 'Pas assez de données pour calculer des deltas.';
