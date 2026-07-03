/**
 * reevaluationHelpers.ts
 * Shared utilities for the reevaluation flow.
 * Used by: Step2Evolution, Step3Synthesis, DeltaTable
 */

import type { ScoreResult, TestData } from '../types';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DeltaEntry {
    subtestId: string;
    subtestName: string;
    testName: string;
    prevNS: number | null;
    newNS: number | null;
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
            const prevNS = parseNS(prevSubtests[subtestId] as ScoreResult | undefined);
            const newNS = parseNS(newSubtests[subtestId] as ScoreResult | undefined);
            result.push({
                subtestId,
                subtestName: subtestNameMap.get(subtestId) ?? subtestId,
                testName: testNameMap.get(testId) ?? testId,
                prevNS,
                newNS,
                delta: prevNS !== null && newNS !== null ? newNS - prevNS : null,
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
): string => {
    const lines: string[] = [];
    Object.entries(tests).forEach(([, subtests]) => {
        Object.entries(subtests).forEach(([subtestId, score]) => {
            const name = subtestNameMap.get(subtestId) ?? subtestId;
            const ns = parseNS(score as ScoreResult);
            if (ns !== null) lines.push(`${name}: NS ${ns}`);
            else if ((score as ScoreResult).raw) lines.push(`${name}: brut ${(score as ScoreResult).raw}`);
        });
    });
    return lines.join('\n') || 'Aucun score enregistré.';
};

/** Build a plain-text evolution summary for AI context. */
export const buildEvolutionSummaryText = (deltas: DeltaEntry[]): string =>
    deltas
        .filter(d => d.delta !== null)
        .map(d => {
            const sign = (d.delta! > 0 ? '+' : '') + d.delta!.toFixed(1);
            const trend = d.delta! > 0.5 ? 'amélioration' : d.delta! < -0.5 ? 'régression' : 'stable';
            return `${d.subtestName} (${d.testName}): ${sign} NS (${trend})`;
        })
        .join('\n') || 'Pas assez de données pour calculer des deltas.';
