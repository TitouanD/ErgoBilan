import type {
  FittingIssue,
  FittingResult,
  FittingRow,
  FittingScoreType,
  FittingStructure,
  FittingSuggestion,
} from '../types';
import { percentileToZScore, zScoreToPercentile } from './scoring';

type FitScaleType = Exclude<FittingScoreType, 'percentile' | 'none'>;

type LookupFitCandidate = {
  type: FittingScoreType;
  mean?: number;
  sd?: number;
  softMin?: number;
  softMax?: number;
  hardMin?: number;
  hardMax?: number;
};

type LookupInferenceMeta = {
  bestScore: number;
  gap: number;
  ranked: Array<{ type: FittingScoreType; score: number }>;
};

type ParametricInferenceMeta = {
  bestScore: number;
  gap: number;
  ranked: Array<{ type: FitScaleType; score: number }>;
};

type MonotonicDirection = 'increasing' | 'decreasing';

type MonotonicDirectionInference = {
  direction: MonotonicDirection | null;
  confidence: number;
};

type AnalyzeFittingInput = {
  rows: FittingRow[];
  structure: FittingStructure;
  currentScoreType?: string | null;
  confidenceForValueFixes?: number;
};

type ParametricNoneFallback = {
  confidence: number;
};

const FIT_SCALE_TARGETS: Record<FitScaleType, { mean: number; sd: number }> = {
  standard: { mean: 100, sd: 15 },
  scaled: { mean: 10, sd: 3 },
  't-score': { mean: 50, sd: 10 },
  sten: { mean: 5.5, sd: 2 },
  stanine: { mean: 5, sd: 2 },
};

const isStandardizedScoreType = (value: FittingScoreType | null): value is FitScaleType => (
  value === 'standard' || value === 'scaled' || value === 't-score' || value === 'sten' || value === 'stanine'
);

const LOOKUP_FIT_CANDIDATES: LookupFitCandidate[] = [
  { type: 'percentile' },
  { type: 'sten', ...FIT_SCALE_TARGETS.sten, softMin: 1, softMax: 10, hardMin: 0, hardMax: 12 },
  { type: 'stanine', ...FIT_SCALE_TARGETS.stanine, softMin: 1, softMax: 9, hardMin: 1, hardMax: 10 },
  { type: 'scaled', ...FIT_SCALE_TARGETS.scaled, softMin: 1, softMax: 19, hardMin: 0, hardMax: 30 },
  { type: 't-score', ...FIT_SCALE_TARGETS['t-score'], softMin: 20, softMax: 80, hardMin: 10, hardMax: 90 },
  { type: 'standard', ...FIT_SCALE_TARGETS.standard, softMin: 55, softMax: 145, hardMin: 20, hardMax: 200 },
];

const clamp = (value: number, min = 0, max = 1): number => Math.min(max, Math.max(min, value));

const average = (values: number[]): number => (
  values.reduce((sum, value) => sum + value, 0) / values.length
);

const median = (values: number[]): number => {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
};

const sampleStdDev = (values: number[]): number => {
  if (values.length < 2) return 0;
  const mu = average(values);
  const variance = values.reduce((sum, value) => sum + (value - mu) ** 2, 0) / (values.length - 1);
  return Math.sqrt(Math.max(variance, 0));
};

const medianAbsoluteDeviation = (values: number[]): number => {
  if (values.length === 0) return 0;
  const med = median(values);
  const deviations = values.map((value) => Math.abs(value - med));
  return median(deviations);
};

const normalizeDashChars = (val: string): string => val.replace(/[\u2012\u2013\u2014\u2212]/g, '-');

const parseRawOrderingValue = (row: FittingRow): number | null => {
  if (typeof row.rawMin === 'number' && Number.isFinite(row.rawMin)) {
    return row.rawMin;
  }

  const raw = normalizeDashChars(String(row.rawText || '')).trim().replace(',', '.');
  if (!raw) return null;

  const ltMatch = raw.match(/^<\s*(-?\d+(?:\.\d+)?)$/);
  if (ltMatch) return Number(ltMatch[1]) - 0.5;

  const gtMatch = raw.match(/^>\s*(-?\d+(?:\.\d+)?)$/);
  if (gtMatch) return Number(gtMatch[1]) + 0.5;

  const plusMatch = raw.match(/^(-?\d+(?:\.\d+)?)\s*\+$/);
  if (plusMatch) return Number(plusMatch[1]) + 0.5;

  const rangeMatch = raw.match(/^(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)$/);
  if (rangeMatch) return Number(rangeMatch[1]);

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
};

const softRangePenalty = (
  value: number,
  softMin: number,
  softMax: number,
  hardMin: number,
  hardMax: number,
): number => {
  if (value < hardMin) {
    return 6 + (hardMin - value) / Math.max(1, softMin - hardMin);
  }
  if (value > hardMax) {
    return 6 + (value - hardMax) / Math.max(1, hardMax - softMax);
  }
  if (value < softMin) {
    return (softMin - value) / Math.max(1, softMin - hardMin);
  }
  if (value > softMax) {
    return (value - softMax) / Math.max(1, hardMax - softMax);
  }
  return 0;
};

const monotonicPenalty = (
  points: Array<{ order: number; metric: number }>,
  tolerance: number,
  normalization: number,
): number => {
  if (points.length < 3) return 0;
  const sorted = [...points].sort((a, b) => a.order - b.order);

  // Some LOOKUP scales are naturally increasing, others decreasing.
  const computeDirectionalPenalty = (direction: 'increasing' | 'decreasing'): number => {
    const sign = direction === 'increasing' ? 1 : -1;
    let penalty = 0;
    for (let i = 1; i < sorted.length; i += 1) {
      const delta = sign * (sorted[i].metric - sorted[i - 1].metric);
      if (delta < -tolerance) {
        penalty += Math.abs(delta) / Math.max(0.1, normalization);
      }
    }
    return penalty / (sorted.length - 1);
  };

  return Math.min(
    computeDirectionalPenalty('increasing'),
    computeDirectionalPenalty('decreasing'),
  );
};

const getSeriesKey = (value?: string | null): string => {
  const key = String(value || '').trim();
  return key || '__default__';
};

const monotonicPenaltyBySeries = (
  points: Array<{ seriesKey: string; order: number; metric: number }>,
  tolerance: number,
  normalization: number,
): number => {
  if (points.length < 3) return 0;
  const grouped = new Map<string, Array<{ order: number; metric: number }>>();
  points.forEach((point) => {
    const key = getSeriesKey(point.seriesKey);
    const current = grouped.get(key) || [];
    current.push({ order: point.order, metric: point.metric });
    grouped.set(key, current);
  });

  const penalties = Array.from(grouped.values())
    .filter((group) => group.length >= 3)
    .map((group) => monotonicPenalty(group, tolerance, normalization));

  if (penalties.length === 0) return 0;
  return average(penalties);
};

const inferMonotonicDirection = (
  points: Array<{ order: number; metric: number }>,
  tolerance: number,
): MonotonicDirectionInference => {
  if (points.length < 3) {
    return { direction: null, confidence: 0 };
  }
  const sorted = [...points].sort((a, b) => a.order - b.order);
  let increasing = 0;
  let decreasing = 0;

  for (let i = 1; i < sorted.length; i += 1) {
    const delta = sorted[i].metric - sorted[i - 1].metric;
    if (delta > tolerance) increasing += 1;
    else if (delta < -tolerance) decreasing += 1;
  }

  const directional = increasing + decreasing;
  if (directional === 0) {
    return { direction: null, confidence: 0 };
  }
  const direction: MonotonicDirection = increasing >= decreasing ? 'increasing' : 'decreasing';
  const confidence = Math.max(increasing, decreasing) / directional;

  if (confidence < 0.6 || Math.max(increasing, decreasing) < 2) {
    return { direction: null, confidence };
  }
  return { direction, confidence };
};

const mapDerivedStandardToPercentile = (value: number): number | null => {
  const rounded = Math.round(value);
  if (rounded === 69) return 2;
  if (rounded === 77) return 6;
  if (rounded === 82) return 11;
  if (rounded === 90) return 26;
  if (rounded === 100) return 51;
  if (rounded === 110) return 75;
  return null;
};

const makeIssueId = (code: FittingIssue['code'], normId?: string | null, index?: number): string => (
  [code, normId || 'subtest', String(index ?? 0)].join('::')
);

const makeSuggestionId = (kind: FittingSuggestion['kind'], normId?: string | null, field?: string): string => (
  [kind, normId || 'subtest', field || 'na'].join('::')
);

export const normalizeScoreTypeToken = (value?: string | null): FittingScoreType | null => {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return null;
  if (raw === 'standard') return 'standard';
  if (raw === 'scaled') return 'scaled';
  if (raw === 'percentile') return 'percentile';
  if (raw === 'sten') return 'sten';
  if (raw === 'stanine') return 'stanine';
  if (raw === 'none') return 'none';
  if (raw === 't-score' || raw === 't_score' || raw === 't score' || raw === 'tscore') return 't-score';
  return null;
};

export const inferScoreTypeForLookup = (
  rows: FittingRow[],
): { scoreType: FittingScoreType | null; meta: LookupInferenceMeta } => {
  const normalized = rows.map((row) => {
    const standardScore = typeof row.standardScore === 'number' && Number.isFinite(row.standardScore)
      ? row.standardScore
      : null;
    const percentile = typeof row.percentile === 'number' && Number.isFinite(row.percentile)
      ? row.percentile
      : null;
    const derivedPercentile = standardScore === null
      ? null
      : mapDerivedStandardToPercentile(standardScore);

    return {
      seriesKey: getSeriesKey(row.seriesKey),
      standardScore,
      percentile,
      derivedPercentile,
      rawOrder: parseRawOrderingValue(row),
    };
  });

  const standards = normalized
    .map((item) => item.standardScore)
    .filter((value): value is number => value !== null);
  const percentiles = normalized
    .map((item) => item.percentile)
    .filter((value): value is number => value !== null);

  if (standards.length === 0) {
    const fallback: FittingScoreType | null = percentiles.length > 0 ? 'percentile' : null;
    return {
      scoreType: fallback,
      meta: {
        bestScore: fallback ? 0.4 : Number.POSITIVE_INFINITY,
        gap: 0,
        ranked: fallback ? [{ type: fallback, score: 0.4 }] : [],
      },
    };
  }

  const ranked = LOOKUP_FIT_CANDIDATES
    .map((candidate) => {
      let score = 0;

      if (candidate.type === 'percentile') {
        const derivedCount = normalized.filter((item) => item.derivedPercentile !== null).length;
        const unmappedStandards = standards.length - derivedCount;

        if (percentiles.length === 0 && derivedCount === 0) {
          score += 8;
        }
        if (standards.length > 0) {
          score += (unmappedStandards / standards.length) * 3.5;
        }

        const monotonicPoints = normalized
          .filter((item): item is { seriesKey: string; standardScore: number | null; percentile: number | null; derivedPercentile: number | null; rawOrder: number } =>
            item.rawOrder !== null)
          .map((item) => ({ seriesKey: item.seriesKey, order: item.rawOrder, metric: item.percentile ?? item.derivedPercentile }))
          .filter((item): item is { seriesKey: string; order: number; metric: number } => item.metric !== null);
        score += monotonicPenaltyBySeries(monotonicPoints, 0.5, 12);
      } else {
        const { mean, sd, softMin, softMax, hardMin, hardMax } = candidate;
        if (
          mean === undefined || sd === undefined
          || softMin === undefined || softMax === undefined
          || hardMin === undefined || hardMax === undefined
        ) {
          return { type: candidate.type, score: Number.POSITIVE_INFINITY };
        }

        const rangePenalty = standards
          .map((value) => softRangePenalty(value, softMin, softMax, hardMin, hardMax))
          .reduce((sum, value) => sum + value, 0) / standards.length;
        score += rangePenalty;

        const meanObserved = average(standards);
        const sdObserved = sampleStdDev(standards);
        score += Math.abs(meanObserved - mean) / Math.max(1, sd * 2.5);
        if (sdObserved > 0) {
          score += Math.abs(sdObserved - sd) / Math.max(1, sd * 2.5);
        }

        const percentilePairs = normalized
          .filter((item): item is { seriesKey: string; standardScore: number; percentile: number; derivedPercentile: number | null; rawOrder: number | null } =>
            item.standardScore !== null && item.percentile !== null);
        if (percentilePairs.length > 0) {
          const mae = average(percentilePairs.map((pair) => {
            const predicted = zScoreToPercentile((pair.standardScore - mean) / sd);
            return Math.abs(predicted - pair.percentile);
          }));
          score += mae / 12;
        }

        const monotonicPoints = normalized
          .filter((item): item is { seriesKey: string; standardScore: number; percentile: number | null; derivedPercentile: number | null; rawOrder: number } =>
            item.rawOrder !== null && item.standardScore !== null)
          .map((item) => ({ seriesKey: item.seriesKey, order: item.rawOrder, metric: item.standardScore }));
        score += monotonicPenaltyBySeries(monotonicPoints, 0.25, Math.max(1, sd));
      }

      return { type: candidate.type, score };
    })
    .filter((entry) => Number.isFinite(entry.score))
    .sort((a, b) => a.score - b.score);

  if (ranked.length === 0) {
    return {
      scoreType: null,
      meta: { bestScore: Number.POSITIVE_INFINITY, gap: 0, ranked: [] },
    };
  }

  const best = ranked[0];
  const second = ranked[1];
  const gap = second ? second.score - best.score : 1;

  if (best.score > 2.6 || gap < 0.22) {
    return {
      scoreType: null,
      meta: { bestScore: best.score, gap, ranked },
    };
  }

  return {
    scoreType: best.type,
    meta: { bestScore: best.score, gap, ranked },
  };
};

export const inferScoreTypeForParametric = (
  rows: FittingRow[],
): { scoreType: FittingScoreType | null; meta: ParametricInferenceMeta } => {
  const means = rows
    .map((row) => row.mean)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const sds = rows
    .map((row) => row.sd)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));

  if (means.length === 0 || sds.length === 0) {
    return {
      scoreType: null,
      meta: { bestScore: Number.POSITIVE_INFINITY, gap: 0, ranked: [] },
    };
  }

  const meanCenter = median(means);
  const sdCenter = median(sds);
  const meanAvg = average(means);
  const sdAvg = average(sds);

  const ranked = (Object.entries(FIT_SCALE_TARGETS) as Array<[FitScaleType, { mean: number; sd: number }]>)
    .map(([type, target]) => {
      const centerPenalty = Math.abs(meanCenter - target.mean) / Math.max(1, target.sd);
      const spreadPenalty = Math.abs(sdCenter - target.sd) / Math.max(1, target.sd);
      const avgPenalty =
        Math.abs(meanAvg - target.mean) / Math.max(1, target.sd * 1.8) +
        Math.abs(sdAvg - target.sd) / Math.max(1, target.sd * 1.8);

      const rowPenalty = rows.reduce((sum, row) => {
        const m = row.mean;
        const s = row.sd;
        if (typeof m !== 'number' || !Number.isFinite(m) || typeof s !== 'number' || !Number.isFinite(s)) {
          return sum;
        }
        return sum +
          Math.abs(m - target.mean) / Math.max(1, target.sd * 4) +
          Math.abs(s - target.sd) / Math.max(1, target.sd * 3);
      }, 0) / Math.max(1, rows.length);

      return { type, score: centerPenalty + spreadPenalty + avgPenalty + rowPenalty };
    })
    .sort((a, b) => a.score - b.score);

  if (ranked.length === 0) {
    return {
      scoreType: null,
      meta: { bestScore: Number.POSITIVE_INFINITY, gap: 0, ranked: [] },
    };
  }

  const best = ranked[0];
  const second = ranked[1];
  const gap = second ? second.score - best.score : 1;

  if (best.score > 3.2 || gap < 0.2) {
    return { scoreType: null, meta: { bestScore: best.score, gap, ranked } };
  }

  return { scoreType: best.type, meta: { bestScore: best.score, gap, ranked } };
};

const inferNoneForParametricRows = (
  rows: FittingRow[],
  currentScoreType: FittingScoreType,
  bestScore: number,
): ParametricNoneFallback | null => {
  const means = rows
    .map((row) => row.mean)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const sds = rows
    .map((row) => row.sd)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));

  if (means.length < 2 || sds.length < 2) return null;
  if (!isStandardizedScoreType(currentScoreType)) return null;

  const meanMedian = median(means);
  const sdMedian = median(sds);
  const target = FIT_SCALE_TARGETS[currentScoreType];

  const meanDrift = Math.abs(meanMedian - target.mean) / Math.max(1, target.sd);
  const sdDrift = Math.abs(sdMedian - target.sd) / Math.max(1, target.sd);

  const rawLikeByRange = meanMedian < 35 || meanMedian > 145 || sdMedian > 18;
  const severeForCurrent = meanDrift >= 2.2 || sdDrift >= 1.8;
  const globallyBadFit = !Number.isFinite(bestScore) || bestScore >= 2.8;

  // Scales with small standard deviation like scaled (sd=3), sten (sd=2) or stanine (sd=2)
  // are very prone to false-positive parametric rejection under these strict rules.
  if (target.sd <= 3 && !rawLikeByRange) return null;

  if (!rawLikeByRange && !severeForCurrent) return null;
  if (!globallyBadFit && !(rawLikeByRange && severeForCurrent)) return null;

  const confidence = Number(
    clamp(
      0.76
      + (rawLikeByRange ? 0.08 : 0)
      + (severeForCurrent ? 0.08 : 0)
      + (globallyBadFit ? 0.04 : 0),
      0.76,
      0.94,
    ).toFixed(2),
  );

  return { confidence };
};

const estimateInferenceConfidence = (bestScore: number, gap: number): number => {
  if (!Number.isFinite(bestScore)) return 0;
  const scoreQuality = clamp(1 - bestScore / 3.4, 0, 1);
  const separation = clamp(gap / 0.75, 0, 1);
  return Number((0.55 * scoreQuality + 0.45 * separation).toFixed(2));
};

const buildLookupIssues = (
  rows: FittingRow[],
  scaleForConsistency: FittingScoreType | null,
): FittingIssue[] => {
  const issues: FittingIssue[] = [];
  const ordered = rows
    .map((row) => ({
      row,
      seriesKey: getSeriesKey(row.seriesKey),
      order: parseRawOrderingValue(row),
      standard: typeof row.standardScore === 'number' && Number.isFinite(row.standardScore) ? row.standardScore : null,
      percentile: typeof row.percentile === 'number' && Number.isFinite(row.percentile) ? row.percentile : null,
    }))
    .filter((entry): entry is {
      row: FittingRow;
      seriesKey: string;
      order: number;
      standard: number | null;
      percentile: number | null;
    } => entry.order !== null);

  const grouped = new Map<string, typeof ordered>();
  ordered.forEach((entry) => {
    const current = grouped.get(entry.seriesKey) || [];
    current.push(entry);
    grouped.set(entry.seriesKey, current);
  });
  grouped.forEach((group) => {
    group.sort((a, b) => a.order - b.order);
  });

  const collectMonotonicDiagnostics = (
    metric: 'standard' | 'percentile',
    tolerance: number,
  ): {
    violations: number;
    transitions: number;
    examples: string[];
    normId: string | null;
    dominantDirection: MonotonicDirection | null;
    confidence: number;
  } => {
    let violations = 0;
    let transitions = 0;
    let directionConfidenceWeighted = 0;
    let directionTransitions = 0;
    let maxAbsDelta = 0;
    const examples: string[] = [];
    let firstNormId: string | null = null;
    const directionCounts: Record<MonotonicDirection, number> = { increasing: 0, decreasing: 0 };

    Array.from(grouped.values()).forEach((group) => {
      const points = group
        .map((entry) => ({ entry, metricValue: entry[metric] }))
        .filter((item): item is { entry: typeof group[number]; metricValue: number } => item.metricValue !== null);

      if (points.length < 3) return;
      const directionInfo = inferMonotonicDirection(
        points.map((point) => ({ order: point.entry.order, metric: point.metricValue })),
        tolerance,
      );
      if (!directionInfo.direction) return;

      directionCounts[directionInfo.direction] += 1;

      for (let i = 1; i < points.length; i += 1) {
        const prev = points[i - 1];
        const curr = points[i];
        const delta = curr.metricValue - prev.metricValue;
        transitions += 1;
        directionConfidenceWeighted += directionInfo.confidence;
        directionTransitions += 1;

        const violates = directionInfo.direction === 'increasing'
          ? delta < -tolerance
          : delta > tolerance;
        if (!violates) continue;

        violations += 1;
        maxAbsDelta = Math.max(maxAbsDelta, Math.abs(delta));
        if (!firstNormId) firstNormId = curr.entry.row.normId || null;
        if (examples.length < 3) {
          examples.push(`${prev.metricValue} -> ${curr.metricValue} (raw ${prev.entry.order} -> ${curr.entry.order})`);
        }
      }
    });

    const dominantDirection: MonotonicDirection | null = (
      directionCounts.increasing === 0 && directionCounts.decreasing === 0
    )
      ? null
      : directionCounts.increasing >= directionCounts.decreasing
        ? 'increasing'
        : 'decreasing';

    const avgDirectionConfidence = directionTransitions > 0
      ? directionConfidenceWeighted / directionTransitions
      : 0;

    const confidence = Number(
      clamp(
        0.72
        + (avgDirectionConfidence * 0.18)
        + Math.min(0.08, maxAbsDelta / Math.max(1, tolerance * 10)),
        0.7,
        0.96,
      ).toFixed(2),
    );

    return {
      violations,
      transitions,
      examples,
      normId: firstNormId,
      dominantDirection,
      confidence,
    };
  };

  const standardMonotonic = collectMonotonicDiagnostics('standard', 0.5);
  if (standardMonotonic.violations > 0 && standardMonotonic.transitions > 0) {
    const expectedTrend = standardMonotonic.dominantDirection === 'decreasing' ? 'decroissante' : 'croissante';
    const inverseHint = standardMonotonic.dominantDirection === 'decreasing'
      ? ' (souvent normal si le brut represente un nombre d erreurs)'
      : '';
    const examples = standardMonotonic.examples.length > 0
      ? ` Ex: ${standardMonotonic.examples.join(' ; ')}.`
      : '';
    issues.push({
      id: makeIssueId('FIT_LOOKUP_NON_MONOTONIC', standardMonotonic.normId, standardMonotonic.violations),
      code: 'FIT_LOOKUP_NON_MONOTONIC',
      severity: 'warning',
      message:
        `Score non monotone: ${standardMonotonic.violations} rupture(s) sur ${standardMonotonic.transitions}`
        + ` transition(s) (tendance ${expectedTrend}${inverseHint}).${examples}`,
      confidence: standardMonotonic.confidence,
      normId: standardMonotonic.normId,
    });
  }

  const percentileMonotonic = collectMonotonicDiagnostics('percentile', 1);
  if (percentileMonotonic.violations > 0 && percentileMonotonic.transitions > 0) {
    const expectedTrend = percentileMonotonic.dominantDirection === 'decreasing' ? 'decroissante' : 'croissante';
    const inverseHint = percentileMonotonic.dominantDirection === 'decreasing'
      ? ' (souvent normal si le brut represente un nombre d erreurs)'
      : '';
    const examples = percentileMonotonic.examples.length > 0
      ? ` Ex: ${percentileMonotonic.examples.join(' ; ')}.`
      : '';
    issues.push({
      id: makeIssueId('FIT_LOOKUP_NON_MONOTONIC', percentileMonotonic.normId, percentileMonotonic.violations + 1000),
      code: 'FIT_LOOKUP_NON_MONOTONIC',
      severity: 'warning',
      message:
        `Percentile non monotone: ${percentileMonotonic.violations} rupture(s) sur ${percentileMonotonic.transitions}`
        + ` transition(s) (tendance ${expectedTrend}${inverseHint}).${examples}`,
      confidence: Number(Math.max(0.7, percentileMonotonic.confidence - 0.02).toFixed(2)),
      normId: percentileMonotonic.normId,
    });
  }

  const stepSamples = Array.from(grouped.values())
    .flatMap((group) => group
      .map((entry, index) => ({ entry, index }))
      .slice(1)        // skip first entry (no previous to compare)
      // Exclude boundary transitions on both ends of each series.
      // Standard score LOOKUP tables exhibit a "ramp-up" acceleration zone in
      // approximately the top and bottom 20% of raw scores: the mapping becomes
      // steep near the extremes because very few subjects score at those levels,
      // compressing many percentile points into a single raw-score step.
      // Excluding the outermost ~20% (minimum 2) on each side prevents false-
      // positive step outlier flags on well-formed tables while still catching
      // genuine mid-table extraction errors (e.g. a transposed digit).
      .filter(({ index }) => {
        const boundary = Math.max(2, Math.round(group.length * 0.20));
        return index > boundary && index < group.length - boundary;
      })
      .map(({ entry, index }) => {
        const prev = group[index - 1];
        const deltaRaw = entry.order - prev.order;
        if (deltaRaw <= 0 || prev.standard === null || entry.standard === null) return null;
        const deltaValue = entry.standard - prev.standard;
        return {
          normId: entry.row.normId || null,
          deltaRaw,
          deltaValue,
          normalized: Math.abs(deltaValue) / Math.max(1, deltaRaw),
        };
      }))
    .filter((sample): sample is { normId: string | null; deltaRaw: number; deltaValue: number; normalized: number } => sample !== null);

  if (stepSamples.length >= 5) {
    const normalized = stepSamples.map((sample) => sample.normalized);
    const med = median(normalized);
    const mad = medianAbsoluteDeviation(normalized);
    const threshold = med + Math.max(4, mad * 3);
    const outlier = stepSamples
      .filter((sample) => sample.normalized >= threshold && Math.abs(sample.deltaValue) >= 8)
      .sort((a, b) => b.normalized - a.normalized)[0];

    if (outlier) {
      issues.push({
        id: makeIssueId('FIT_LOOKUP_STEP_OUTLIER', outlier.normId, 1),
        code: 'FIT_LOOKUP_STEP_OUTLIER',
        severity: 'warning',
        message: `Saut atypique detecte (delta=${outlier.deltaValue.toFixed(1)} pour delta brut=${outlier.deltaRaw.toFixed(1)}).`,
        confidence: 0.9,
        normId: outlier.normId,
      });
    }
  }

  if (scaleForConsistency && scaleForConsistency !== 'percentile' && scaleForConsistency !== 'none') {
    const target = FIT_SCALE_TARGETS[scaleForConsistency as FitScaleType];
    const outOfRange = ordered.filter((entry) => (
      entry.standard !== null && (entry.standard < 0 || entry.standard > 200)
    ));
    if (outOfRange.length > 0) {
      const first = outOfRange[0];
      issues.push({
        id: makeIssueId('FIT_LOOKUP_VALUE_OUT_OF_RANGE', first.row.normId, outOfRange.length),
        code: 'FIT_LOOKUP_VALUE_OUT_OF_RANGE',
        severity: 'blocking',
        message: `${outOfRange.length} valeur(s) hors plage plausible detectee(s). Ex: ${first.standard}.`,
        confidence: 1,
        normId: first.row.normId || null,
      });
    }

    const inconsistent = ordered
      .filter((entry) => entry.standard !== null && entry.percentile !== null)
      .map((entry) => ({
        entry,
        expectedPercentile: zScoreToPercentile((entry.standard as number - target.mean) / target.sd),
      }))
      .filter((item) => Math.abs(item.expectedPercentile - (item.entry.percentile as number)) >= 10);

    if (inconsistent.length > 0) {
      const first = inconsistent[0];
      issues.push({
        id: makeIssueId('FIT_LOOKUP_VALUE_INCONSISTENT', first.entry.row.normId, inconsistent.length),
        code: 'FIT_LOOKUP_VALUE_INCONSISTENT',
        severity: 'warning',
        message:
          `Incoherence score/percentile sur ${inconsistent.length} ligne(s) (${scaleForConsistency}). `
          + `Ex: score ${first.entry.standard} => pct attendu ~${first.expectedPercentile}, recu ${first.entry.percentile}.`,
        confidence: 0.95,
        normId: first.entry.row.normId || null,
      });
    }

    const nonInteger = ordered.filter((entry) => (
      entry.standard !== null && !Number.isInteger(entry.standard)
    ));
    if (nonInteger.length > 0) {
      issues.push({
        id: makeIssueId('FIT_LOOKUP_NON_INTEGER_SCORE', nonInteger[0].row.normId, nonInteger.length),
        code: 'FIT_LOOKUP_NON_INTEGER_SCORE',
        severity: 'warning',
        message: `${nonInteger.length} valeur(s) non entiere(s) detectee(s) pour un score de type ${scaleForConsistency}.`,
        confidence: 0.9,
        normId: nonInteger[0].row.normId || null,
      });
    }
  }

  return issues;
};

const buildParametricIssues = (
  rows: FittingRow[],
  suggestedScoreType: FittingScoreType | null,
): FittingIssue[] => {
  if (!suggestedScoreType || suggestedScoreType === 'percentile' || suggestedScoreType === 'none') return [];
  const target = FIT_SCALE_TARGETS[suggestedScoreType as FitScaleType];
  const drifted = rows.filter((row) => {
    if (typeof row.mean !== 'number' || !Number.isFinite(row.mean) || typeof row.sd !== 'number' || !Number.isFinite(row.sd)) {
      return false;
    }
    const meanDrift = Math.abs(row.mean - target.mean) / Math.max(1, target.sd);
    const sdDrift = Math.abs(row.sd - target.sd) / Math.max(1, target.sd);
    return meanDrift > 2.5 || sdDrift > 2;
  });

  if (drifted.length === 0) return [];

  const observedMeans = drifted
    .map((row) => row.mean)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const observedSds = drifted
    .map((row) => row.sd)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const observedMeanMedian = observedMeans.length > 0 ? median(observedMeans).toFixed(1) : 'n/a';
  const observedSdMedian = observedSds.length > 0 ? median(observedSds).toFixed(1) : 'n/a';

  return [{
    id: makeIssueId('FIT_PARAMETRIC_MEAN_SD_DRIFT', drifted[0].normId, drifted.length),
    code: 'FIT_PARAMETRIC_MEAN_SD_DRIFT',
    severity: 'warning',
    message:
      `${drifted.length} ligne(s) parametriques eloignees des parametres attendus (${suggestedScoreType}). `
      + `Cible mean~${target.mean}, sd~${target.sd}; median observee mean~${observedMeanMedian}, sd~${observedSdMedian}.`,
    confidence: 0.88,
    normId: drifted[0].normId || null,
  }];
};

const scoreIssuesRisk = (issues: FittingIssue[]): number => {
  const score = issues.reduce((sum, issue) => {
    if (issue.severity === 'blocking') return sum + 22;
    if (issue.severity === 'warning') return sum + 12;
    return sum + 5;
  }, 0);
  return Math.round(Math.min(100, score));
};

export const buildValueFixSuggestions = (
  params: {
    rows: FittingRow[];
    structure: FittingStructure;
    currentScoreType: FittingScoreType;
    suggestedScoreType: FittingScoreType | null;
    confidence: number;
    confidenceThreshold?: number;
  },
): FittingSuggestion[] => {
  const confidenceThreshold = params.confidenceThreshold ?? 0.9;
  const suggestions: FittingSuggestion[] = [];

  if (params.suggestedScoreType && params.suggestedScoreType !== params.currentScoreType) {
    suggestions.push({
      id: makeSuggestionId('score_type', null, params.suggestedScoreType),
      kind: 'score_type',
      confidence: params.confidence,
      reason: `Type suggere: ${params.suggestedScoreType} (actuel: ${params.currentScoreType}).`,
      scoreType: params.suggestedScoreType,
    });
  }

  if (
    !params.suggestedScoreType
    || params.suggestedScoreType === 'none'
    || params.confidence < confidenceThreshold
  ) {
    return suggestions;
  }

  if (params.structure === 'PARAMETRIC') {
    if (params.suggestedScoreType === 'percentile') return suggestions;
    const target = FIT_SCALE_TARGETS[params.suggestedScoreType as FitScaleType];
    params.rows.forEach((row) => {
      if (!row.normId) return;
      if (typeof row.mean === 'number' && Number.isFinite(row.mean)) {
        const meanDrift = Math.abs(row.mean - target.mean) / Math.max(1, target.sd);
        if (meanDrift > 2.5) {
          suggestions.push({
            id: makeSuggestionId('value_fix', row.normId, 'mean'),
            kind: 'value_fix',
            confidence: Number(Math.max(0.9, params.confidence - 0.02).toFixed(2)),
            reason: `Mean attendu proche de ${target.mean} pour ${params.suggestedScoreType} (observe ${row.mean}).`,
            normId: row.normId,
            field: 'mean',
            value: target.mean,
          });
        }
      }
      if (typeof row.sd === 'number' && Number.isFinite(row.sd)) {
        const sdDrift = Math.abs(row.sd - target.sd) / Math.max(1, target.sd);
        if (sdDrift > 2) {
          suggestions.push({
            id: makeSuggestionId('value_fix', row.normId, 'sd'),
            kind: 'value_fix',
            confidence: Number(Math.max(0.9, params.confidence - 0.02).toFixed(2)),
            reason: `SD attendu proche de ${target.sd} pour ${params.suggestedScoreType} (observe ${row.sd}).`,
            normId: row.normId,
            field: 'sd',
            value: target.sd,
          });
        }
      }
    });
    return suggestions;
  }

  if (params.suggestedScoreType === 'percentile') {
    params.rows.forEach((row) => {
      if (row.normId == null) return;
      if (row.percentile != null || row.standardScore == null) return;
      const mapped = mapDerivedStandardToPercentile(row.standardScore);
      if (mapped == null) return;
      suggestions.push({
        id: makeSuggestionId('value_fix', row.normId, 'percentile'),
        kind: 'value_fix',
        confidence: 0.92,
        reason: `Percentile manquant derive depuis score ${row.standardScore}.`,
        normId: row.normId,
        field: 'percentile',
        value: mapped,
      });
    });
    return suggestions;
  }

  const target = FIT_SCALE_TARGETS[params.suggestedScoreType as FitScaleType];
  params.rows.forEach((row) => {
    if (row.normId == null) return;
    if (row.standardScore != null) {
      const expectedPercentile = zScoreToPercentile((row.standardScore - target.mean) / target.sd);
      if (row.percentile == null || Math.abs(expectedPercentile - row.percentile) >= 10) {
        suggestions.push({
          id: makeSuggestionId('value_fix', row.normId, 'percentile'),
          kind: 'value_fix',
          confidence: 0.93,
          reason: `Percentile attendu ~${expectedPercentile} pour score ${row.standardScore} (${params.suggestedScoreType}).`,
          normId: row.normId,
          field: 'percentile',
          value: expectedPercentile,
        });
      }
      return;
    }

    if (row.percentile != null) {
      const z = percentileToZScore(row.percentile);
      const expectedStandard = Math.round(z * target.sd + target.mean);
      suggestions.push({
        id: makeSuggestionId('value_fix', row.normId, 'standard_score'),
        kind: 'value_fix',
        confidence: 0.91,
        reason: `Score manquant derive depuis percentile ${row.percentile} (${params.suggestedScoreType}).`,
        normId: row.normId,
        field: 'standard_score',
        value: expectedStandard,
      });
    }
  });

  return suggestions;
};
export const analyzeFitting = (input: AnalyzeFittingInput): FittingResult => {
  const currentScoreType = normalizeScoreTypeToken(input.currentScoreType) || 'none';
  const fallbackConfidenceForFixes = input.confidenceForValueFixes ?? 0.9;

  let suggestedScoreType: FittingScoreType | null = null;
  let inferenceBestScore = Number.POSITIVE_INFINITY;
  let inferenceGap = 0;
  let confidenceOverride: number | null = null;
  let issues: FittingIssue[] = [];

  if (input.structure === 'LOOKUP') {
    const inferred = inferScoreTypeForLookup(input.rows);
    suggestedScoreType = inferred.scoreType;
    inferenceBestScore = inferred.meta.bestScore;
    inferenceGap = inferred.meta.gap;
    issues = buildLookupIssues(input.rows, suggestedScoreType || currentScoreType);
  } else {
    const inferred = inferScoreTypeForParametric(input.rows);
    suggestedScoreType = inferred.scoreType;
    inferenceBestScore = inferred.meta.bestScore;
    inferenceGap = inferred.meta.gap;

    if (!suggestedScoreType) {
      // For PARAMETRIC subtests, mean/sd store raw-score population norms —
      // values inherently outside standardized scale ranges (e.g. mean=27, sd=5
      // for Barrage des H). If the subtest already carries an explicit
      // standardized score_type, do NOT infer 'none': compute_score will
      // z-score against these raw-domain values and convert to the target scale
      // at runtime. Only run the none-fallback when score_type is not yet set.
      const skipNoneFallback = isStandardizedScoreType(currentScoreType as FittingScoreType);
      if (!skipNoneFallback) {
        const noneFallback = inferNoneForParametricRows(input.rows, currentScoreType, inferenceBestScore);
        if (noneFallback) {
          suggestedScoreType = 'none';
          confidenceOverride = noneFallback.confidence;
        }
      }
    }

    // Only run the drift check when the inference engine positively identified a
    // matching scale. If suggestedScoreType is null it means the observed mean/sd
    // are raw-domain population statistics (e.g. mean=28 for Barrage des H) —
    // comparing them against a standardized scale target (mean=100 for 'standard')
    // would always produce a false-positive drift issue.
    issues = buildParametricIssues(input.rows, suggestedScoreType);
  }

  const confidence = confidenceOverride ?? (
    suggestedScoreType
      ? estimateInferenceConfidence(inferenceBestScore, inferenceGap)
      : 0
  );

  // --- score_type = 'none' but numerical norms exist → blocking ---
  if (currentScoreType === 'none') {
    const hasNumericData = input.rows.some((r) =>
      (typeof r.standardScore === 'number' && Number.isFinite(r.standardScore)) ||
      (typeof r.mean === 'number' && Number.isFinite(r.mean)),
    );
    if (hasNumericData) {
      issues.unshift({
        id: makeIssueId('FIT_SCORE_TYPE_NONE_WITH_DATA', null, 0),
        code: 'FIT_SCORE_TYPE_NONE_WITH_DATA',
        severity: 'blocking',
        message: suggestedScoreType && suggestedScoreType !== 'none'
          ? `score_type est "none" mais des normes numériques existent. Type suggéré : ${suggestedScoreType}.`
          : `score_type est "none" mais des normes numériques existent. Vérifier le type de score.`,
        confidence: suggestedScoreType && suggestedScoreType !== 'none' ? confidence : 0.85,
        normId: null,
      });
    }
  }

  // --- mismatch detection (works for ALL currentScoreTypes now, including 'none') ---
  if (suggestedScoreType && suggestedScoreType !== 'none' && suggestedScoreType !== currentScoreType) {
    issues.unshift({
      id: makeIssueId('FIT_SCORE_TYPE_MISMATCH', null, 0),
      code: 'FIT_SCORE_TYPE_MISMATCH',
      severity: confidence >= 0.75 ? 'blocking' : 'warning',
      message: `Score type probable: ${suggestedScoreType} (actuel: ${currentScoreType}).`,
      confidence,
      normId: null,
    });
  }

  if (suggestedScoreType && confidence < 0.55) {
    issues.push({
      id: makeIssueId('FIT_LOW_CONFIDENCE', null, 0),
      code: 'FIT_LOW_CONFIDENCE',
      severity: 'info',
      message: 'Décision de fitting peu confiante: revue manuelle recommandée.',
      confidence,
      normId: null,
    });
  }

  const riskScore = scoreIssuesRisk(issues);
  const suggestions = buildValueFixSuggestions({
    rows: input.rows,
    structure: input.structure,
    currentScoreType,
    suggestedScoreType,
    confidence,
    confidenceThreshold: fallbackConfidenceForFixes,
  });

  return {
    structure: input.structure,
    currentScoreType,
    suggestedScoreType,
    confidence,
    riskScore,
    issues,
    suggestions,
  };
};
