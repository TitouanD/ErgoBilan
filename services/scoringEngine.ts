/**
 * scoringEngine.ts
 *
 * Norm computation removed — scores are entered manually by the clinician.
 * This file now exposes only pure math helpers for NS ↔ ET ↔ % conversions
 * used to derive colours and graphs.
 */

/** Approximation of the normal CDF (Abramowitz & Stegun). */
export function normalCDF(z: number): number {
    const t = 1 / (1 + 0.2316419 * Math.abs(z));
    const poly = t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
    const p = 1 - (1 / Math.sqrt(2 * Math.PI)) * Math.exp(-0.5 * z * z) * poly;
    return z >= 0 ? p : 1 - p;
}

/**
 * Derive ET (z-score) and percentile from a standard score.
 * @param ns   - the standard score entered by the clinician
 * @param mean - scale mean (e.g. 10 for NS, 100 for QI)
 * @param sd   - scale sd   (e.g. 3  for NS,  15 for QI)
 */
export function deriveFromNS(
    ns: number,
    mean: number,
    sd: number,
): { zScore: number; percentile: number } {
    const z = (ns - mean) / sd;
    return { zScore: parseFloat(z.toFixed(3)), percentile: Math.round(normalCDF(z) * 100) };
}

/** Colour token based on z-score. */
export function zColor(z: number | null): string {
    if (z === null) return 'text-[var(--text-secondary)]';
    if (z <= -2) return 'text-rose-600';
    if (z <= -1) return 'text-amber-500';
    return 'text-emerald-600';
}

