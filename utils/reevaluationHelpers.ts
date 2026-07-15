/**
 * reevaluationHelpers.ts
 * Shared utilities for the reevaluation flow.
 * Used by: Step2Evolution, Step3Synthesis, DeltaTable
 */

import type { ScoreResult, TestData } from '../types';

// ─── Types ───────────────────────────────────────────────────────────────────

export type ScoreMetric = 'NS' | 'ET' | '%';

export interface DeltaEntry {
    subtestId: string;
    subtestName: string;
    testName: string;
    /** The metric actually entered in the previous assessment */
    metric: ScoreMetric;
    prevValue: number | null;
    newValue: number | null;
    delta: number | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export const parseNS = (score?: ScoreResult): number | null => {
    if (!score?.standard) return null;
    const n = parseFloat(String(score.standard).replace(',', '.'));
    return isFinite(n) ? n : null;
};

export const deltaClass = (delta: number | null): string => {
    if (delta === null) return 'text-[var(--text-disabled)]';
    if (delta > 0.5) return 'text-emerald-600 font-bold';
    if (delta < -0.5) return 'text-rose-600 font-bold';
    return 'text-amber-500';
};

/** Detect which metric was actually entered for a ScoreResult */
export const detectMetric = (score?: ScoreResult): ScoreMetric => {
    if (!score) return 'NS';
    if (score.entryMetric === 'z') return 'ET';
    if (score.entryMetric === 'standard') return 'NS';
    if (score.entryMetric === 'percentile') return '%';
    if (typeof score.zScore === 'number' && isFinite(score.zScore)) return 'ET';
    if (score.standard) {
        const n = parseFloat(String(score.standard).replace(',', '.'));
        if (isFinite(n)) return 'NS';
    }
    if (score.percentile) {
        const n = parseFloat(String(score.percentile).replace(',', '.'));
        if (isFinite(n)) return '%';
    }
    return 'NS';
};

/** Extract the numeric value for the given (or auto-detected) metric */
export const extractMetricValue = (score?: ScoreResult, metric?: ScoreMetric): number | null => {
    if (!score) return null;
    const m = metric ?? detectMetric(score);
    if (m === 'ET') return typeof score.zScore === 'number' && isFinite(score.zScore) ? score.zScore : null;
    if (m === 'NS') return parseNS(score);
    if (!score.percentile) return null;
    const n = parseFloat(String(score.percentile).replace(',', '.'));
    return isFinite(n) ? n : null;
};

/**
 * Build a flat list of delta entries from previous and new TestData.
 * subtestNameMap: Map<subtestId, displayName>
 * testNameMap:   Map<testId, testName>
 */
export const buildDeltaEntries = (
    previousTests: TestData,
    newTests: TestData,
    subtestNameMap: Map<string, string>,
    testNameMap: Map<string, string>,
): DeltaEntry[] => {
    const result: DeltaEntry[] = [];
    const allTestIds = new Set([...Object.keys(previousTests), ...Object.keys(newTests)]);

    allTestIds.forEach(testId => {
        const prevSubtests = previousTests[testId] ?? {};
        const newSubtests = newTests[testId] ?? {};
        const allSubIds = new Set([...Object.keys(prevSubtests), ...Object.keys(newSubtests)]);

        allSubIds.forEach(subtestId => {
            const prevScore = prevSubtests[subtestId] as ScoreResult | undefined;
            const newScore = newSubtests[subtestId] as ScoreResult | undefined;
            const metric = detectMetric(prevScore ?? newScore);
            const prevValue = extractMetricValue(prevScore, metric);
            const newValue = extractMetricValue(newScore, metric);
            result.push({
                subtestId,
                subtestName: subtestNameMap.get(subtestId) ?? subtestId,
                testName: testNameMap.get(testId) ?? testId,
                metric,
                prevValue,
                newValue,
                delta: prevValue !== null && newValue !== null ? parseFloat((newValue - prevValue).toFixed(2)) : null,
            });
        });
    });

    return result;
};

/** Stats summary from a list of delta entries. */
export const buildDeltaStats = (entries: DeltaEntry[]) => {
    const withDelta = entries.filter(d => d.delta !== null);
    return {
        total: withDelta.length,
        improved: withDelta.filter(d => d.delta! > 0.5).length,
        stable: withDelta.filter(d => Math.abs(d.delta!) <= 0.5).length,
        declined: withDelta.filter(d => d.delta! < -0.5).length,
    };
};

/** Build a plain-text scores summary for AI context. */
export const buildScoresSummaryText = (
    tests: TestData,
    subtestNameMap: Map<string, string>,
    date?: string,
): string => {
    const header = date ? `[${date}]\n` : '';
    const lines: string[] = [];
    Object.entries(tests).forEach(([, subtests]) => {
        Object.entries(subtests).forEach(([subtestId, score]) => {
            const r = score as ScoreResult;
            const name = subtestNameMap.get(subtestId) ?? subtestId;
            const metric = detectMetric(r);
            const value = extractMetricValue(r, metric);
            if (value !== null) {
                lines.push(`${name}: ${value} ${metric}`);
            } else if (r.raw) {
                lines.push(`${name}: brut ${r.raw}`);
            }
        });
    });
    return (header + (lines.join('\n') || 'Aucun score enregistré.')).trim();
};

/** Build a plain-text evolution summary for AI context. */
export const buildEvolutionSummaryText = (deltas: DeltaEntry[]): string =>
    deltas
        .filter(d => d.delta !== null)
        .map(d => {
            const sign = (d.delta! > 0 ? '+' : '') + d.delta!.toFixed(1);
            const trend = d.delta! > 0.5 ? 'amélioration' : d.delta! < -0.5 ? 'régression' : 'stable';
            return `${d.subtestName} (${d.testName}): ${sign} ${d.metric} (${trend})`;
        })
        .join('\n') || 'Pas assez de données pour calculer des deltas.';
