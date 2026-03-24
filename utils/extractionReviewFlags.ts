import type {
  ExtractedRow,
  ReviewFixField,
  ReviewFlag,
  ReviewFlagCounts,
  ReviewSeverity,
} from '../types';
import { zScoreToPercentile } from './scoring';

type TableStructure = 'PARAMETRIC' | 'LOOKUP' | 'UNKNOWN';

type AnalyzePageInput = {
  pageId: string;
  rows: ExtractedRow[];
  structure: TableStructure;
};

type RawBounds = { min: number; max: number };

type OrderedLookupEntry = {
  row: ExtractedRow;
  originalIndex: number;
  rawBounds: RawBounds | null;
  hasRaw: boolean;
  hasScore: boolean;
  standardValue: number | null;
  percentileValue: number | null;
  zValue: number | null;
};

type LookupBucket = {
  bucketKey: string;
  subtest: string;
  groupLabel: string;
  rows: ExtractedRow[];
};

type LookupBucketQuality = {
  scoredCount: number;
  standardCount: number;
  maxStandard: number | null;
  rawOverlapCount: number;
  standardViolationRatio: number;
  percentileViolationRatio: number;
};

type NumericStep = {
  prev: OrderedLookupEntry;
  curr: OrderedLookupEntry;
  deltaRaw: number;
  deltaValue: number;
  normalized: number;
};

type NumericStepOutlier = {
  sample: NumericStep;
  threshold: number;
};

// Versioned thresholds for low-false-positive behavior.
const LOOKUP_MIN_SCORED_ROWS_FOR_CORE = 3;
const LOOKUP_INTERNAL_GAP_BLOCKING_MIN_COUNT = 4;
const LOOKUP_INTERNAL_GAP_BLOCKING_RATIO = 0.20;
const LOOKUP_BOUNDARY_UNSCORED_MIN_COUNT = 2;
const LOOKUP_STEP_MIN_SAMPLES = 5;
const LOOKUP_STANDARD_STEP_OUTLIER_MIN_DELTA = 6;
const LOOKUP_STANDARD_STEP_OUTLIER_FLOOR = 4;
const LOOKUP_PERCENTILE_STEP_OUTLIER_MIN_DELTA = 15;
const LOOKUP_PERCENTILE_STEP_OUTLIER_FLOOR = 8;
const LOOKUP_STEP_OUTLIER_MAD_MULTIPLIER = 3;
const LOOKUP_AGE_CAPTURE_BLOCKING_ROW_RATIO = 0.5;
const LOOKUP_AGE_CAPTURE_BLOCKING_MIN_ROWS = 8;

const toFiniteNumber = (value: string): number | null => {
  if (!value) return null;
  const cleaned = value
    .replace(/[\u2012\u2013\u2014\u2212]/g, '-')
    .replace(',', '.')
    .replace(/[^0-9.+-]/g, '');
  if (!cleaned || cleaned === '-' || cleaned === '+' || cleaned === '.' || cleaned === '+.' || cleaned === '-.') {
    return null;
  }
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
};

const isIntervalLike = (value: string): boolean => /\d+\s*[-\u2013\u2014]\s*\d+/.test(value);
const isCollapsedIntervalCandidate = (value: string): boolean => /^\d{3,4}$/.test(value);
const cleanText = (value?: string): string => (value || '').trim();

const cleanGroupLabel = (row: ExtractedRow): string => {
  const explicit = cleanText(row.label);
  if (explicit) return explicit;
  if (typeof row.hidden_age_min === 'number' && typeof row.hidden_age_max === 'number') {
    return `${row.hidden_age_min}-${row.hidden_age_max}`;
  }
  return 'Sans groupe';
};

const subtestBucketKey = (row: ExtractedRow): string => {
  const sourceKey = cleanText(row.source_column_key);
  if (!sourceKey) return row.subtest;
  return `${row.subtest}::${sourceKey}`;
};

const hasLookupRawValue = (row: ExtractedRow): boolean => cleanText(row.raw).length > 0;
const hasLookupScoreValue = (row: ExtractedRow): boolean => {
  return [row.standard, row.percentile, row.zScore].some((value) => cleanText(value).length > 0);
};

const hasLookupScoredRow = (row: ExtractedRow): boolean => {
  return hasLookupRawValue(row) && hasLookupScoreValue(row);
};

const parseRawBoundsFromText = (rawValue: string): RawBounds | null => {
  const trimmed = cleanText(rawValue);
  if (!trimmed) return null;

  const normalizedRange = trimmed.replace(/[\u2013\u2014]/g, '-');
  const rangeMatch = normalizedRange.match(/(-?\d+(?:[.,]\d+)?)\s*-\s*(-?\d+(?:[.,]\d+)?)/);
  if (rangeMatch) {
    const min = toFiniteNumber(rangeMatch[1]);
    const max = toFiniteNumber(rangeMatch[2]);
    if (min === null || max === null) return null;
    if (min > max) return { min: max, max: min };
    return { min, max };
  }

  const single = toFiniteNumber(trimmed);
  if (single === null) return null;
  return { min: single, max: single };
};

const getRawBounds = (row: ExtractedRow): RawBounds | null => {
  const hiddenMin = row.hidden_raw_min;
  const hiddenMax = row.hidden_raw_max;
  if (typeof hiddenMin === 'number' && typeof hiddenMax === 'number' && Number.isFinite(hiddenMin) && Number.isFinite(hiddenMax)) {
    return hiddenMin <= hiddenMax ? { min: hiddenMin, max: hiddenMax } : { min: hiddenMax, max: hiddenMin };
  }
  return parseRawBoundsFromText(row.raw);
};

const expectedZFromStandard = (standard: number): number => {
  if (standard > 20) return (standard - 100) / 15;
  return (standard - 10) / 3;
};

const hasParametricValue = (row: ExtractedRow): boolean => {
  return [row.label || '', row.mean || '', row.sd || ''].some((value) => cleanText(value).length > 0);
};

type IntervalSuggestion = {
  value: string;
  confidence: number;
};

const inferIntervalFromCollapsed = (value: string): IntervalSuggestion | null => {
  if (!isCollapsedIntervalCandidate(value)) return null;

  const candidates: Array<{ left: string; right: string }> = [];
  if (value.length === 3) {
    candidates.push({ left: value.slice(0, 1), right: value.slice(1) });
    candidates.push({ left: value.slice(0, 2), right: value.slice(2) });
  } else if (value.length === 4) {
    candidates.push({ left: value.slice(0, 2), right: value.slice(2) });
    candidates.push({ left: value.slice(0, 1), right: value.slice(1) });
    candidates.push({ left: value.slice(0, 3), right: value.slice(3) });
  }

  const valid = candidates
    .map(({ left, right }) => ({ left: Number(left), right: Number(right), split: `${left}-${right}` }))
    .filter(({ left, right }) => Number.isFinite(left) && Number.isFinite(right))
    .filter(({ left, right }) => left >= 0 && right >= 0 && left <= right && right <= 100);

  if (valid.length === 0) return null;

  const best = valid
    .sort((a, b) => {
      const aSpan = a.right - a.left;
      const bSpan = b.right - b.left;
      if (aSpan !== bSpan) return aSpan - bSpan;
      if (a.left !== b.left) return a.left - b.left;
      return a.right - b.right;
    })[0];

  const confidence = value.length === 4 ? 0.99 : 0.96;
  return { value: best.split, confidence };
};

const normalizeAgeToken = (value: unknown): string =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();

const AGE_QUALIFIER_AMBIGUOUS_PATTERNS = ['TEMPS', 'ITEM', 'ITEMS', 'ESSAI', 'ESSAIS', 'FOIS'];

const hasAmbiguousAgeQualifierContext = (token: string): boolean => (
  AGE_QUALIFIER_AMBIGUOUS_PATTERNS.some((pattern) => token.includes(pattern))
);

const isLikelyAgeQualifierToken = (value: unknown): boolean => {
  const token = normalizeAgeToken(value);
  if (!token) return false;

  const hasAmbiguousContext = hasAmbiguousAgeQualifierContext(token);

  if (((/\bAGES?\b|\bANS?\b|\bMOIS\b/.test(token) && /\d/.test(token)) || /\bTHROUGH\b/.test(token)) && !hasAmbiguousContext) {
    return true;
  }

  if (/\b(?:CP|CE1|CE2|CM1|CM2|6E|5E|4E|3E|2NDE|2DE|1ERE|1RE|TERMINALE|TLE)\b/.test(token)) {
    return true;
  }

  if ((/\d+\s*[;:.]\s*\d+/.test(token) || /\d+\s*[-\u2013\u2014]\s*\d+/.test(token)) && !hasAmbiguousContext) {
    return true;
  }

  return false;
};

const isLikelyStatToken = (value: unknown): boolean => {
  const token = normalizeAgeToken(value);
  if (!token) return false;

  // 1. Exact matches for common short headers
  if (/^(?:N|M|SD|NS|ET|SIGMA|MEAN|SD|\d+)$/.test(token)) return true;

  // 2. French statistical terminology
  if (/\b(?:MOYENNE|ECART|TYPE|EFFECTIF|NOMBRE|SUJETS?|RESULTATS?|PERCENTILES?|FREQUENCES?|QUARTILES?)\b/.test(token)) {
    return true;
  }

  return false;
};

const isSubtestAgeHeaderCaptured = (subtest: string): boolean => {
  const trimmed = cleanText(subtest);
  if (!trimmed) return false;
  if (isLikelyAgeQualifierToken(trimmed)) return true;

  const parenthesized = Array.from(trimmed.matchAll(/\(([^)]+)\)/g))
    .map((match) => cleanText(match[1]))
    .filter((value) => value.length > 0);

  return parenthesized.some((value) => isLikelyAgeQualifierToken(value));
};

const median = (values: number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
};

const mad = (values: number[], med: number): number => {
  if (values.length === 0) return 0;
  const deviations = values.map((value) => Math.abs(value - med));
  return median(deviations);
};

const computeExpectedMaxStandard = (valuesByBucket: Map<string, Set<number>>): number | null => {
  if (valuesByBucket.size < 3) return null;

  const maxStandardPerBucket: number[] = [];
  for (const values of valuesByBucket.values()) {
    if (values.size === 0) continue;
    maxStandardPerBucket.push(Math.max(...values));
  }

  if (maxStandardPerBucket.length < 3) return null;
  const sortedMax = [...maxStandardPerBucket].sort((a, b) => a - b);
  const expected = sortedMax[Math.floor(sortedMax.length * 0.75)];
  if (!Number.isFinite(expected) || expected < 10) return null;
  return expected;
};

const isSparseLookupLikely = (
  quality: LookupBucketQuality | undefined,
  standardSet: Set<number> | undefined,
  expectedMaxNS: number | null,
): boolean => {
  if (!quality || !standardSet || expectedMaxNS === null) return false;
  if (quality.scoredCount < 4 || standardSet.size < 4) return false;

  const missingLevels = expectedMaxNS - standardSet.size;
  if (missingLevels < 3) return false;

  const monotonicStable =
    quality.rawOverlapCount === 0 &&
    quality.standardViolationRatio <= 0.2 &&
    quality.percentileViolationRatio <= 0.25;
  if (!monotonicStable) return false;

  const reachesUpperBand = quality.maxStandard !== null && quality.maxStandard >= expectedMaxNS - 3;
  const verySparseButStructured = missingLevels >= Math.ceil(expectedMaxNS * 0.45);
  return reachesUpperBand || verySparseButStructured;
};

const detectNumericStepOutlier = (
  samples: NumericStep[],
  minAbsDelta: number,
  floor: number,
): NumericStepOutlier | null => {
  if (samples.length < LOOKUP_STEP_MIN_SAMPLES) return null;

  const normalized = samples.map((sample) => sample.normalized);
  const med = median(normalized);
  const spread = mad(normalized, med);
  const threshold = med + Math.max(floor, spread * LOOKUP_STEP_OUTLIER_MAD_MULTIPLIER);

  const candidates = samples.filter((sample) => {
    return sample.normalized >= threshold && Math.abs(sample.deltaValue) >= minAbsDelta;
  });

  if (candidates.length === 0) return null;

  const sample = candidates.sort((a, b) => b.normalized - a.normalized)[0];
  return { sample, threshold };
};

const formatRawBounds = (bounds: RawBounds): string => {
  if (bounds.min === bounds.max) return String(bounds.min);
  return `${bounds.min}-${bounds.max}`;
};

const severityToBlocking = (severity: ReviewSeverity): boolean => severity === 'blocking';

const makeFlagFactory = (pageId: string) => {
  let index = 0;
  return (payload: Omit<ReviewFlag, 'id' | 'pageId' | 'blocking'>): ReviewFlag => {
    index += 1;
    return {
      id: `${pageId}::${payload.code}::${payload.rowId || payload.subtest || 'global'}::${index}`,
      pageId,
      blocking: severityToBlocking(payload.severity),
      ...payload,
    };
  };
};

type CountEntry = { subtest: string; count: number };

const expectedCountForGroup = (entries: CountEntry[]): number => {
  const freq = new Map<number, number>();
  entries.forEach((entry) => {
    freq.set(entry.count, (freq.get(entry.count) || 0) + 1);
  });
  return Array.from(freq.entries())
    .sort((a, b) => {
      if (a[1] !== b[1]) return b[1] - a[1];
      return b[0] - a[0];
    })[0]?.[0] || 0;
};

const flagCodeSortOrder: Record<ReviewSeverity, number> = {
  blocking: 0,
  warning: 1,
  info: 2,
};

const sortFlags = (flags: ReviewFlag[]): ReviewFlag[] => {
  return [...flags].sort((a, b) => {
    const severityDelta = flagCodeSortOrder[a.severity] - flagCodeSortOrder[b.severity];
    if (severityDelta !== 0) return severityDelta;
    if (a.subtest !== b.subtest) return a.subtest.localeCompare(b.subtest);
    if (a.groupLabel !== b.groupLabel) return a.groupLabel.localeCompare(b.groupLabel);
    return a.code.localeCompare(b.code);
  });
};

/**
 * Detect the dominant monotonic direction of a lookup scale.
 * For error-count / time-based tests, standard scores DECREASE as raw increases (e.g. Trajet 3).
 * Returns 'decreasing' if the majority of numeric transitions go downward,
 * 'increasing' if upward, or 'ambiguous' when evenly split.
 */
const detectDominantScoreDirection = (
  entries: OrderedLookupEntry[],
  metric: 'standard' | 'percentile',
): 'increasing' | 'decreasing' | 'ambiguous' => {
  let increases = 0;
  let decreases = 0;
  for (let i = 1; i < entries.length; i += 1) {
    const prev = entries[i - 1];
    const curr = entries[i];
    if (!prev.rawBounds || !curr.rawBounds) continue;
    if (curr.rawBounds.min < prev.rawBounds.min) continue; // raw not increasing
    const prevVal = metric === 'standard' ? prev.standardValue : prev.percentileValue;
    const currVal = metric === 'standard' ? curr.standardValue : curr.percentileValue;
    if (prevVal === null || currVal === null) continue;
    if (currVal > prevVal + 0.5) increases += 1;
    else if (currVal < prevVal - 0.5) decreases += 1;
  }
  if (increases === 0 && decreases === 0) return 'ambiguous';
  // Require at least 60 % dominance to call a direction
  const total = increases + decreases;
  if (decreases / total >= 0.6) return 'decreasing';
  if (increases / total >= 0.6) return 'increasing';
  return 'ambiguous';
};

const buildOrderedLookupEntries = (bucketRows: ExtractedRow[]): OrderedLookupEntry[] => {
  const entries = bucketRows.map((row, index) => {
    const standardValue = toFiniteNumber(cleanText(row.standard));
    const percentileValue = toFiniteNumber(cleanText(row.percentile));
    const zValue = toFiniteNumber(cleanText(row.zScore));
    return {
      row,
      originalIndex: index,
      rawBounds: getRawBounds(row),
      hasRaw: hasLookupRawValue(row),
      hasScore: hasLookupScoreValue(row),
      standardValue,
      percentileValue,
      zValue,
    };
  });

  return entries.sort((a, b) => {
    if (a.rawBounds && b.rawBounds) {
      if (a.rawBounds.min !== b.rawBounds.min) return a.rawBounds.min - b.rawBounds.min;
      if (a.rawBounds.max !== b.rawBounds.max) return a.rawBounds.max - b.rawBounds.max;
      return a.originalIndex - b.originalIndex;
    }
    if (a.rawBounds && !b.rawBounds) return -1;
    if (!a.rawBounds && b.rawBounds) return 1;
    return a.originalIndex - b.originalIndex;
  });
};

const buildLookupBucketMap = (rows: ExtractedRow[]): Map<string, LookupBucket> => {
  const buckets = new Map<string, LookupBucket>();
  rows.forEach((row) => {
    if (!hasLookupRawValue(row) && !hasLookupScoreValue(row)) return;
    const groupLabel = cleanGroupLabel(row);
    const bucketKey = `${subtestBucketKey(row)}::${groupLabel}`;
    if (!buckets.has(bucketKey)) {
      buckets.set(bucketKey, {
        bucketKey,
        subtest: row.subtest,
        groupLabel,
        rows: [],
      });
    }
    buckets.get(bucketKey)!.rows.push(row);
  });
  return buckets;
};

export const analyzePageRows = ({ pageId, rows, structure }: AnalyzePageInput): ReviewFlag[] => {
  if (!rows || rows.length === 0) return [];
  const makeFlag = makeFlagFactory(pageId);
  const flags: ReviewFlag[] = [];

  const shouldCheckAges = (row: ExtractedRow): boolean => {
    if (structure === 'LOOKUP') return hasLookupScoredRow(row);
    if (structure === 'PARAMETRIC') return hasParametricValue(row);
    return hasLookupScoredRow(row) || hasParametricValue(row);
  };

  rows.forEach((row) => {
    if (!shouldCheckAges(row)) return;
    const a0 = row.hidden_age_min;
    const a1 = row.hidden_age_max;
    const invalid = typeof a0 !== 'number' || typeof a1 !== 'number' || Number.isNaN(a0) || Number.isNaN(a1) || a0 > a1;
    if (invalid) {
      flags.push(makeFlag({
        code: 'AGE_RANGE_MISSING_OR_INVALID',
        severity: 'blocking',
        message: `Age invalide ou manquant pour "${row.subtest}" (${cleanGroupLabel(row)}).`,
        subtest: row.subtest,
        groupLabel: cleanGroupLabel(row),
        rowId: row.id,
        confidence: 1,
      }));
    }
  });

  if (structure === 'PARAMETRIC') {
    rows.forEach((row) => {
      if (!hasParametricValue(row)) return;
      const meanVal = toFiniteNumber(cleanText(row.mean));
      const sdVal = toFiniteNumber(cleanText(row.sd));
      if (meanVal === null || sdVal === null) {
        flags.push(makeFlag({
          code: 'PARAMETRIC_REQUIRED_FIELD_MISSING',
          severity: 'blocking',
          message: `Ligne parametrique incomplete (Moyenne/SD) pour "${row.subtest}" (${cleanGroupLabel(row)}).`,
          subtest: row.subtest,
          groupLabel: cleanGroupLabel(row),
          rowId: row.id,
          confidence: 1,
        }));
      }
    });
    return sortFlags(flags);
  }

  // Detect subtest names that likely captured age headers.
  const rowsBySubtest = new Map<string, ExtractedRow[]>();
  rows.forEach((row) => {
    const key = cleanText(row.subtest);
    if (!key) return;
    const current = rowsBySubtest.get(key) || [];
    current.push(row);
    rowsBySubtest.set(key, current);
  });

  for (const [subtest, subtestRows] of rowsBySubtest.entries()) {
    if (!isSubtestAgeHeaderCaptured(subtest)) continue;
    const rowCount = subtestRows.length;
    const ratio = rowCount / rows.length;
    const severity: ReviewSeverity =
      rowCount >= LOOKUP_AGE_CAPTURE_BLOCKING_MIN_ROWS && ratio >= LOOKUP_AGE_CAPTURE_BLOCKING_ROW_RATIO
        ? 'blocking'
        : 'warning';

    flags.push(makeFlag({
      code: 'LOOKUP_SUBTEST_AGE_HEADER_CAPTURED',
      severity,
      message: `Nom de sous-test probablement age/entete capture: "${subtest}" (${rowCount} ligne(s)).`,
      subtest,
      groupLabel: cleanGroupLabel(subtestRows[0]),
      confidence: severity === 'blocking' ? 0.99 : 0.9,
    }));
  }

  // Detect subtest names that look like statistical headers (N, Moyenne, etc.)
  for (const [subtest, subtestRows] of rowsBySubtest.entries()) {
    if (!isLikelyStatToken(subtest)) continue;

    flags.push(makeFlag({
      code: 'LOOKUP_SUBTEST_STAT_HEADER_CAPTURED',
      severity: 'blocking',
      message: `Nom de sous-test correspond a une entete statistique probable: "${subtest}" (${subtestRows.length} ligne(s)).`,
      subtest,
      groupLabel: cleanGroupLabel(subtestRows[0]),
      confidence: 0.98,
    }));
  }

  const collapsedFlagRowIds = new Set<string>();
  const collapsedSuggestionKey = new Set<string>();
  const lookupBuckets = buildLookupBucketMap(rows);

  // Detect collapsed percentile intervals with high-confidence fix.
  for (const bucket of lookupBuckets.values()) {
    const percentValues = bucket.rows
      .map((row) => cleanText(row.percentile))
      .filter((value) => value.length > 0);
    if (percentValues.length < 3) continue;

    const intervalCount = percentValues.filter((value) => isIntervalLike(value)).length;
    const collapsedCount = percentValues.filter((value) => inferIntervalFromCollapsed(value)).length;
    const expectsIntervals = intervalCount / percentValues.length >= 0.5 || collapsedCount / percentValues.length >= 0.4;

    bucket.rows.forEach((row) => {
      const current = cleanText(row.percentile);
      if (!isCollapsedIntervalCandidate(current)) return;
      const suggestion = inferIntervalFromCollapsed(current);
      if (!suggestion) return;
      const rawNumeric = toFiniteNumber(current);
      const clearlyOutOfRange = rawNumeric !== null && rawNumeric > 100;
      if (!expectsIntervals && !clearlyOutOfRange) return;

      const dedupeKey = `${row.id}::percentile::${suggestion.value}`;
      if (collapsedSuggestionKey.has(dedupeKey)) return;
      collapsedSuggestionKey.add(dedupeKey);
      collapsedFlagRowIds.add(row.id);

      flags.push(makeFlag({
        code: 'LOOKUP_COLLAPSED_INTERVAL',
        severity: 'blocking',
        message: `Intervalle probablement fusionne "${current}" pour "${row.subtest}" (${cleanGroupLabel(row)}).`,
        subtest: row.subtest,
        groupLabel: cleanGroupLabel(row),
        rowId: row.id,
        suggestedFix: {
          rowId: row.id,
          field: 'percentile',
          value: suggestion.value,
          reason: `Correction automatique proposee: ${current} -> ${suggestion.value}`,
        },
        confidence: suggestion.confidence,
      }));
    });
  }

  // Row-level score consistency checks.
  rows.forEach((row) => {
    const percentileRaw = cleanText(row.percentile);

    if (percentileRaw && !collapsedFlagRowIds.has(row.id) && !isIntervalLike(percentileRaw)) {
      const percentileValue = toFiniteNumber(percentileRaw);
      if (percentileValue !== null && (percentileValue < 0 || percentileValue > 100)) {
        flags.push(makeFlag({
          code: 'LOOKUP_PERCENTILE_OUT_OF_BOUNDS',
          severity: 'blocking',
          message: `Percentile hors bornes (${percentileRaw}) pour "${row.subtest}" (${cleanGroupLabel(row)}).`,
          subtest: row.subtest,
          groupLabel: cleanGroupLabel(row),
          rowId: row.id,
          confidence: 1,
        }));
      }
    }

    const standardNumeric = toFiniteNumber(cleanText(row.standard));
    const zValue = toFiniteNumber(cleanText(row.zScore));
    const percentileValue = toFiniteNumber(percentileRaw);

    if (standardNumeric !== null && zValue !== null) {
      const expectedZ = expectedZFromStandard(standardNumeric);
      if (Math.abs(expectedZ - zValue) >= 0.5) {
        flags.push(makeFlag({
          code: 'LOOKUP_STANDARD_Z_INCONSISTENT',
          severity: 'warning',
          message: `Incoherence NS/Z pour "${row.subtest}" (${cleanGroupLabel(row)}): NS ${row.standard} -> Z attendu ~${expectedZ.toFixed(2)}, recu ${row.zScore}.`,
          subtest: row.subtest,
          groupLabel: cleanGroupLabel(row),
          rowId: row.id,
          confidence: 0.95,
        }));
      }
    }

    if (zValue !== null && percentileValue !== null && !isIntervalLike(percentileRaw) && !collapsedFlagRowIds.has(row.id)) {
      const expectedPercentile = zScoreToPercentile(zValue);
      if (Math.abs(expectedPercentile - percentileValue) >= 5) {
        flags.push(makeFlag({
          code: 'LOOKUP_Z_PERCENTILE_INCONSISTENT',
          severity: 'warning',
          message: `Incoherence Z/% pour "${row.subtest}" (${cleanGroupLabel(row)}): attendu ~${expectedPercentile}, recu ${percentileRaw}.`,
          subtest: row.subtest,
          groupLabel: cleanGroupLabel(row),
          rowId: row.id,
          confidence: 1,
        }));
      }
    }
  });

  const bucketQualityByKey = new Map<string, LookupBucketQuality>();

  // Bucket-level lookup diagnostics (missingness, monotonicity, outliers).
  for (const bucket of lookupBuckets.values()) {
    const ordered = buildOrderedLookupEntries(bucket.rows);

    ordered.forEach((entry) => {
      if (entry.hasScore && !entry.hasRaw) {
        flags.push(makeFlag({
          code: 'LOOKUP_SCORE_WITHOUT_RAW',
          severity: 'blocking',
          message: `Score present sans brut pour "${bucket.subtest}" (${bucket.groupLabel}).`,
          subtest: bucket.subtest,
          groupLabel: bucket.groupLabel,
          rowId: entry.row.id,
          confidence: 1,
        }));
      }
    });

    const scoredIndices = ordered
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => entry.hasScore)
      .map(({ index }) => index);

    if (scoredIndices.length >= LOOKUP_MIN_SCORED_ROWS_FOR_CORE) {
      const firstScored = scoredIndices[0];
      const lastScored = scoredIndices[scoredIndices.length - 1];
      const coreLength = Math.max(1, lastScored - firstScored + 1);

      const internalScoreGaps = ordered.filter((entry, index) => {
        if (index < firstScored || index > lastScored) return false;
        return entry.hasRaw && !entry.hasScore;
      });

      const boundaryUnscored = ordered.filter((entry, index) => {
        if (index >= firstScored && index <= lastScored) return false;
        return entry.hasRaw && !entry.hasScore;
      });

      if (internalScoreGaps.length > 0) {
        const ratio = internalScoreGaps.length / coreLength;
        const severity: ReviewSeverity =
          internalScoreGaps.length >= LOOKUP_INTERNAL_GAP_BLOCKING_MIN_COUNT && ratio >= LOOKUP_INTERNAL_GAP_BLOCKING_RATIO
            ? 'blocking'
            : 'warning';

        flags.push(makeFlag({
          code: 'LOOKUP_INTERNAL_SCORE_GAP',
          severity,
          message: `Trou interne brut/score pour "${bucket.subtest}" (${bucket.groupLabel}): ${internalScoreGaps.length} ligne(s) manquante(s) dans une fenetre scoree de ${coreLength} lignes.`,
          subtest: bucket.subtest,
          groupLabel: bucket.groupLabel,
          rowId: internalScoreGaps[0].row.id,
          confidence: severity === 'blocking' ? 0.97 : 0.9,
        }));
      }

      if (boundaryUnscored.length >= LOOKUP_BOUNDARY_UNSCORED_MIN_COUNT) {
        flags.push(makeFlag({
          code: 'LOOKUP_BOUNDARY_UNSCORED',
          severity: 'info',
          message: `Lignes brutes non scorees en bord detectees pour "${bucket.subtest}" (${bucket.groupLabel}): ${boundaryUnscored.length} ligne(s).`,
          subtest: bucket.subtest,
          groupLabel: bucket.groupLabel,
          confidence: 0.88,
        }));
      }
    }

    const orderedScored = ordered.filter((entry) => entry.rawBounds !== null && entry.hasScore);
    const orderedWithRaw = ordered.filter((entry) => entry.rawBounds !== null);
    const standardSteps: NumericStep[] = [];
    const percentileSteps: NumericStep[] = [];

    // Detect dominant direction BEFORE flagging monotonicity.
    // Error-count / time-based tests have decreasing NS as raw increases — this is correct.
    const standardDirection = detectDominantScoreDirection(orderedScored, 'standard');
    const percentileDirection = detectDominantScoreDirection(orderedScored, 'percentile');

    let standardViolationCount = 0;
    let totalStandardChecks = 0;
    let percentileViolationCount = 0;
    let totalPercentileChecks = 0;
    let rawOverlapCount = 0;

    for (let i = 1; i < orderedWithRaw.length; i += 1) {
      const prev = orderedWithRaw[i - 1];
      const curr = orderedWithRaw[i];
      if (!prev.rawBounds || !curr.rawBounds) continue;

      // Raw ranges are inclusive in lookup tables; touching bounds are suspicious too (e.g. 19-20 then 20).
      if (curr.rawBounds.min <= prev.rawBounds.max) {
        rawOverlapCount += 1;
        const sameBounds = curr.rawBounds.min === prev.rawBounds.min && curr.rawBounds.max === prev.rawBounds.max;
        const conflictingScore = (
          (prev.standardValue !== null && curr.standardValue !== null && Math.abs(prev.standardValue - curr.standardValue) > 0.5)
          || (prev.percentileValue !== null && curr.percentileValue !== null && Math.abs(prev.percentileValue - curr.percentileValue) > 1)
        );
        const partialScoreConflict = sameBounds && (
          (prev.standardValue === null) !== (curr.standardValue === null)
          || (prev.percentileValue === null) !== (curr.percentileValue === null)
          || (prev.zValue === null) !== (curr.zValue === null)
        );
        if (sameBounds && conflictingScore) {
          flags.push(makeFlag({
            code: 'LOOKUP_RAW_DUPLICATE_CONFLICT',
            severity: 'blocking',
            message: `Lignes brutes dupliquées avec scores contradictoires pour "${bucket.subtest}" (${bucket.groupLabel}): ${formatRawBounds(curr.rawBounds)}.` ,
            subtest: bucket.subtest,
            groupLabel: bucket.groupLabel,
            rowId: curr.row.id,
            confidence: 0.98,
          }));
        } else if (partialScoreConflict) {
          flags.push(makeFlag({
            code: 'LOOKUP_RAW_DUPLICATE_PARTIAL',
            severity: 'blocking',
            message: `Lignes brutes dupliquées avec métriques incomplètes pour "${bucket.subtest}" (${bucket.groupLabel}): ${formatRawBounds(curr.rawBounds)}.` ,
            subtest: bucket.subtest,
            groupLabel: bucket.groupLabel,
            rowId: curr.row.id,
            confidence: 0.96,
          }));
        }
        flags.push(makeFlag({
          code: 'LOOKUP_RAW_RANGE_OVERLAP',
          severity: sameBounds && (conflictingScore || partialScoreConflict) ? 'blocking' : 'warning',
          message: `Chevauchement de plages brutes pour "${bucket.subtest}" (${bucket.groupLabel}): ${formatRawBounds(prev.rawBounds)} puis ${formatRawBounds(curr.rawBounds)}.`,
          subtest: bucket.subtest,
          groupLabel: bucket.groupLabel,
          rowId: curr.row.id,
          confidence: sameBounds && (conflictingScore || partialScoreConflict) ? 0.97 : 0.92,
        }));
      }
    }

    for (let i = 1; i < orderedScored.length; i += 1) {
      const prev = orderedScored[i - 1];
      const curr = orderedScored[i];
      if (!prev.rawBounds || !curr.rawBounds) continue;

      if (prev.standardValue !== null && curr.standardValue !== null) {
        // For a decreasing-direction scale (higher raw = worse, e.g. error counts),
        // a decrease in NS is completely normal — only flag an unexpected INCREASE.
        // For an increasing-direction or ambiguous scale, flag unexpected decreases (original behaviour).
        const standardViolation = standardDirection === 'decreasing'
          ? curr.standardValue > prev.standardValue + 0.5    // unexpected increase on inverse scale
          : curr.standardValue + 0.5 < prev.standardValue;   // unexpected decrease on normal scale
        totalStandardChecks++;
        if (standardViolation) {
          standardViolationCount++;
          const dirHint = standardDirection === 'decreasing'
            ? ' (echelle inverse: le NS devrait diminuer quand le brut augmente)'
            : '';
          flags.push(makeFlag({
            code: 'LOOKUP_STANDARD_NON_MONOTONIC',
            severity: 'warning',
            message: `NS non monotone pour "${bucket.subtest}" (${bucket.groupLabel}): ${prev.standardValue} -> ${curr.standardValue} alors que le brut augmente.${dirHint}`,
            subtest: bucket.subtest,
            groupLabel: bucket.groupLabel,
            rowId: curr.row.id,
            confidence: 0.95,
          }));
        }
      }

      if (prev.percentileValue !== null && curr.percentileValue !== null) {
        const percentileViolation = percentileDirection === 'decreasing'
          ? curr.percentileValue > prev.percentileValue + 1
          : curr.percentileValue + 1 < prev.percentileValue;
        totalPercentileChecks++;
        if (percentileViolation) {
          percentileViolationCount++;
          flags.push(makeFlag({
            code: 'LOOKUP_PERCENTILE_NON_MONOTONIC',
            severity: 'warning',
            message: `Percentile non monotone pour "${bucket.subtest}" (${bucket.groupLabel}): ${prev.percentileValue} -> ${curr.percentileValue} alors que le brut augmente.`,
            subtest: bucket.subtest,
            groupLabel: bucket.groupLabel,
            rowId: curr.row.id,
            confidence: 0.93,
          }));
        }
      }

      const deltaRaw = curr.rawBounds.min - prev.rawBounds.min;
      if (deltaRaw <= 0) continue;

      if (prev.standardValue !== null && curr.standardValue !== null) {
        const deltaValue = curr.standardValue - prev.standardValue;
        standardSteps.push({
          prev,
          curr,
          deltaRaw,
          deltaValue,
          normalized: Math.abs(deltaValue) / Math.max(1, deltaRaw),
        });
      }

      if (prev.percentileValue !== null && curr.percentileValue !== null) {
        const deltaValue = curr.percentileValue - prev.percentileValue;
        percentileSteps.push({
          prev,
          curr,
          deltaRaw,
          deltaValue,
          normalized: Math.abs(deltaValue) / Math.max(1, deltaRaw),
        });
      }
    }

    // Elevate to blocking when > 25% of transitions violate monotonicity — indicates wholesale extraction failure
    const NON_MONOTONIC_BLOCKING_RATIO = 0.25;
    const NON_MONOTONIC_MIN_TRANSITIONS = 4;
    if (totalStandardChecks >= NON_MONOTONIC_MIN_TRANSITIONS &&
      standardViolationCount / totalStandardChecks > NON_MONOTONIC_BLOCKING_RATIO) {
      flags.push(makeFlag({
        code: 'LOOKUP_STANDARD_NON_MONOTONIC',
        severity: 'blocking',
        message: `NS massivement non monotone pour "${bucket.subtest}" (${bucket.groupLabel}): ${standardViolationCount}/${totalStandardChecks} transitions invalides (${Math.round(standardViolationCount / totalStandardChecks * 100)}%). Extraction probablement erronee.`,
        subtest: bucket.subtest,
        groupLabel: bucket.groupLabel,
        confidence: 0.97,
      }));
    }
    if (totalPercentileChecks >= NON_MONOTONIC_MIN_TRANSITIONS &&
      percentileViolationCount / totalPercentileChecks > NON_MONOTONIC_BLOCKING_RATIO) {
      flags.push(makeFlag({
        code: 'LOOKUP_PERCENTILE_NON_MONOTONIC',
        severity: 'blocking',
        message: `Percentile massivement non monotone pour "${bucket.subtest}" (${bucket.groupLabel}): ${percentileViolationCount}/${totalPercentileChecks} transitions invalides (${Math.round(percentileViolationCount / totalPercentileChecks * 100)}%). Extraction probablement erronee.`,
        subtest: bucket.subtest,
        groupLabel: bucket.groupLabel,
        confidence: 0.97,
      }));
    }

    // Check for non-integer scores on integer-based scales
    // If the median standard score is clearly on a scale like Scaled (10) or Standard (100) or T-Score (50)
    // then non-integers are suspicious.
    const allStandardValues = ordered.map(e => e.standardValue).filter((v): v is number => v !== null);
    if (allStandardValues.length >= 3) {
      const medVal = median(allStandardValues);
      const isIntegerScale = (medVal > 0 && medVal < 30) || (medVal > 30 && medVal < 70) || (medVal > 70 && medVal < 160);
      if (isIntegerScale) {
        ordered.forEach((entry) => {
          if (entry.standardValue !== null && !Number.isInteger(entry.standardValue)) {
            flags.push(makeFlag({
              code: 'LOOKUP_NON_INTEGER_SCORE',
              severity: 'warning',
              message: `Valeur non entiere (${entry.row.standard}) detectee pour un score standard sur "${bucket.subtest}".`,
              subtest: bucket.subtest,
              groupLabel: bucket.groupLabel,
              rowId: entry.row.id,
              confidence: 0.9,
            }));
          }
        });
      }
    }

    const standardOutlier = detectNumericStepOutlier(
      standardSteps,
      LOOKUP_STANDARD_STEP_OUTLIER_MIN_DELTA,
      LOOKUP_STANDARD_STEP_OUTLIER_FLOOR,
    );
    if (standardOutlier) {
      const { sample, threshold } = standardOutlier;
      flags.push(makeFlag({
        code: 'LOOKUP_STANDARD_STEP_OUTLIER',
        severity: 'warning',
        message: `Saut NS atypique pour "${bucket.subtest}" (${bucket.groupLabel}) entre brut ${formatRawBounds(sample.prev.rawBounds!)} et ${formatRawBounds(sample.curr.rawBounds!)}: ${sample.prev.standardValue} -> ${sample.curr.standardValue}.`,
        subtest: bucket.subtest,
        groupLabel: bucket.groupLabel,
        rowId: sample.curr.row.id,
        confidence: Math.min(0.99, 0.8 + Math.min(0.18, sample.normalized / Math.max(1, threshold) * 0.08)),
      }));
    }

    const percentileOutlier = detectNumericStepOutlier(
      percentileSteps,
      LOOKUP_PERCENTILE_STEP_OUTLIER_MIN_DELTA,
      LOOKUP_PERCENTILE_STEP_OUTLIER_FLOOR,
    );
    if (percentileOutlier) {
      const { sample, threshold } = percentileOutlier;
      flags.push(makeFlag({
        code: 'LOOKUP_PERCENTILE_STEP_OUTLIER',
        severity: 'warning',
        message: `Saut percentile atypique pour "${bucket.subtest}" (${bucket.groupLabel}) entre brut ${formatRawBounds(sample.prev.rawBounds!)} et ${formatRawBounds(sample.curr.rawBounds!)}: ${sample.prev.percentileValue} -> ${sample.curr.percentileValue}.`,
        subtest: bucket.subtest,
        groupLabel: bucket.groupLabel,
        rowId: sample.curr.row.id,
        confidence: Math.min(0.99, 0.8 + Math.min(0.18, sample.normalized / Math.max(1, threshold) * 0.08)),
      }));
    }

    const standardSet = new Set<number>();
    orderedScored.forEach((entry) => {
      if (entry.standardValue !== null) standardSet.add(entry.standardValue);
    });

    bucketQualityByKey.set(bucket.bucketKey, {
      scoredCount: bucket.rows.filter((row) => hasLookupScoredRow(row)).length,
      standardCount: standardSet.size,
      maxStandard: standardSet.size > 0 ? Math.max(...standardSet) : null,
      rawOverlapCount,
      standardViolationRatio: totalStandardChecks > 0 ? standardViolationCount / totalStandardChecks : 0,
      percentileViolationRatio: totalPercentileChecks > 0 ? percentileViolationCount / totalPercentileChecks : 0,
    });
  }

  // Collect cross-subtest completeness signals.
  const subtestRowCounts: { key: string; subtest: string; groupLabel: string; count: number }[] = [];
  const subtestMaxRaw: { key: string; subtest: string; groupLabel: string; maxRaw: number; maxStandard: number }[] = [];
  const subtestStandardValues = new Map<string, Set<number>>();
  const bucketMetaByKey = new Map<string, { subtest: string; groupLabel: string }>();

  for (const bucket of lookupBuckets.values()) {
    const scoredRows = bucket.rows.filter((row) => hasLookupScoredRow(row));
    subtestRowCounts.push({
      key: bucket.bucketKey,
      subtest: bucket.subtest,
      groupLabel: bucket.groupLabel,
      count: scoredRows.length,
    });
    bucketMetaByKey.set(bucket.bucketKey, { subtest: bucket.subtest, groupLabel: bucket.groupLabel });

    const standardSet = new Set<number>();
    let maxRaw = -Infinity;
    let maxStandard = -Infinity;

    for (const row of scoredRows) {
      const stdVal = toFiniteNumber(cleanText(row.standard));
      if (stdVal !== null) {
        standardSet.add(stdVal);
        if (stdVal > maxStandard) maxStandard = stdVal;
      }

      const rawBounds = getRawBounds(row);
      if (rawBounds) {
        const rawMax = rawBounds.max;
        if (rawMax > maxRaw) maxRaw = rawMax;
      }
    }

    subtestStandardValues.set(bucket.bucketKey, standardSet);

    if (Number.isFinite(maxRaw) && Number.isFinite(maxStandard)) {
      subtestMaxRaw.push({
        key: bucket.bucketKey,
        subtest: bucket.subtest,
        groupLabel: bucket.groupLabel,
        maxRaw,
        maxStandard,
      });
    }
  }

  const expectedMaxNS = computeExpectedMaxStandard(subtestStandardValues);
  const sparseLookupKeys = new Set<string>();
  if (expectedMaxNS !== null) {
    for (const [key, standardSet] of subtestStandardValues.entries()) {
      const quality = bucketQualityByKey.get(key);
      if (isSparseLookupLikely(quality, standardSet, expectedMaxNS)) {
        sparseLookupKeys.add(key);
      }
    }
  }

  const groupCounts = new Map<string, Map<string, { subtest: string; bucketKey: string; count: number }>>();
  rows.forEach((row) => {
    if (!hasLookupRawValue(row)) return;
    const groupLabel = cleanGroupLabel(row);
    if (!groupCounts.has(groupLabel)) {
      groupCounts.set(groupLabel, new Map<string, { subtest: string; bucketKey: string; count: number }>());
    }
    const perSubtest = groupCounts.get(groupLabel)!;
    const key = subtestBucketKey(row);
    const bucketKey = `${key}::${groupLabel}`;
    const current = perSubtest.get(key);
    if (current) {
      current.count += 1;
    } else {
      perSubtest.set(key, { subtest: row.subtest, bucketKey, count: 1 });
    }
  });

  for (const [groupLabel, perSubtest] of groupCounts.entries()) {
    if (perSubtest.size < 2) continue;
    const entries = Array.from(perSubtest.values());
    const expected = expectedCountForGroup(entries);
    const mismatch = entries.filter((entry) => entry.count !== expected);
    mismatch.forEach((entry) => {
      const missing = Math.max(0, expected - entry.count);
      const sparseLikely = sparseLookupKeys.has(entry.bucketKey);
      const severeLossThreshold = Math.max(10, Math.floor(expected * 0.7));
      const severity: ReviewSeverity = sparseLikely
        ? 'info'
        : (missing <= 2 ? 'info' : (missing > severeLossThreshold ? 'blocking' : 'warning'));
      flags.push(makeFlag({
        code: 'GROUP_ROW_COUNT_MISMATCH',
        severity,
        message: sparseLikely
          ? `Nombre de lignes plus faible pour "${entry.subtest}" dans "${groupLabel}" (${entry.count} au lieu de ${expected}) sur une colonne probablement clairsemée (valeurs '-' implicites).`
          : `Nombre de lignes incoherent pour "${entry.subtest}" dans "${groupLabel}" (${entry.count} au lieu de ${expected}).`,
        subtest: entry.subtest,
        groupLabel,
        confidence: severity === 'blocking' ? 0.97 : 0.85,
      }));
    });
  }

  for (const bucket of lookupBuckets.values()) {
    const zValues = bucket.rows
      .map((row) => toFiniteNumber(cleanText(row.zScore)))
      .filter((value): value is number => value !== null);

    if (zValues.length < 4) continue;
    const zeroCount = zValues.filter((value) => Math.abs(value) <= 0.01).length;
    if (zeroCount / zValues.length < 0.75) continue;

    flags.push(makeFlag({
      code: 'LOOKUP_ZERO_Z_PLATEAU',
      severity: 'info',
      message: `Plateau massif de Z=0 detecte pour "${bucket.subtest}" (${bucket.groupLabel}).`,
      subtest: bucket.subtest,
      groupLabel: bucket.groupLabel,
      confidence: 0.9,
    }));
  }

  // Cross-subtest duplicate content detection (detecting repetitive hallucination)
  const subtestSignatures = new Map<string, string>();
  for (const bucket of lookupBuckets.values()) {
    const signature = bucket.rows
      .map(r => `${r.raw}|${r.standard}|${r.zScore}|${r.percentile}`)
      .sort()
      .join(';');
    if (!signature || bucket.rows.length < 3) continue;

    if (subtestSignatures.has(signature)) {
      const otherSubtest = subtestSignatures.get(signature)!;
      if (otherSubtest !== bucket.subtest) {
        flags.push(makeFlag({
          code: 'SUBTEST_CONTENT_DUPLICATE',
          severity: 'blocking',
          message: `Contenu identique detecte pour "${bucket.subtest}" et "${otherSubtest}". Probable repetition AI ou erreur d'extraction.`,
          subtest: bucket.subtest,
          groupLabel: bucket.groupLabel,
          confidence: 0.98,
        }));
      }
    } else {
      subtestSignatures.set(signature, bucket.subtest);
    }
  }

  // ── Cross-subtest completeness checks for dense LOOKUP pages ──

  // LOOKUP_ROW_COUNT_SUSPICIOUSLY_LOW: flag subtests with row count < 50% of median
  if (subtestRowCounts.length >= 3) {
    const counts = subtestRowCounts.map((e) => e.count).sort((a, b) => a - b);
    const medianCount = counts[Math.floor(counts.length / 2)];
    if (medianCount >= 4) {
      for (const entry of subtestRowCounts) {
        if (entry.count > 0 && entry.count < medianCount * 0.5 && !sparseLookupKeys.has(entry.key)) {
          flags.push(makeFlag({
            code: 'LOOKUP_ROW_COUNT_SUSPICIOUSLY_LOW',
            severity: 'warning',
            message: `Nombre de lignes anormalement bas pour "${entry.subtest}" (${entry.count} vs médiane ${medianCount}). Extraction possiblement incomplète.`,
            subtest: entry.subtest,
            groupLabel: entry.groupLabel,
            confidence: 0.85,
          }));
        }
      }
    }
  }

  // LOOKUP_MAX_RAW_OUTLIER: flag subtests whose max raw is far below median max raw (same age group)
  if (subtestMaxRaw.length >= 3) {
    const maxRaws = subtestMaxRaw.map((e) => e.maxRaw).sort((a, b) => a - b);
    const medianMaxRaw = maxRaws[Math.floor(maxRaws.length / 2)];
    if (medianMaxRaw > 0) {
      for (const entry of subtestMaxRaw) {
        const sparseLikely = sparseLookupKeys.has(entry.key);
        const reachesExpectedStandard = expectedMaxNS !== null && entry.maxStandard >= expectedMaxNS - 1;
        if (entry.maxRaw < medianMaxRaw * 0.4 && entry.maxRaw > 0 && !sparseLikely && !reachesExpectedStandard) {
          flags.push(makeFlag({
            code: 'LOOKUP_MAX_RAW_OUTLIER',
            severity: 'warning',
            message: `Score brut maximum anormalement bas pour "${entry.subtest}" (max brut ${entry.maxRaw} vs médiane ${medianMaxRaw}). Colonne possiblement mal lue.`,
            subtest: entry.subtest,
            groupLabel: entry.groupLabel,
            confidence: 0.8,
          }));
        }
      }
    }
  }

  // LOOKUP_NS_RANGE_INCOMPLETE: for pages where most subtests cover NS 1-19, flag subtests missing the upper range
  if (expectedMaxNS !== null) {
    for (const [key, standardSet] of subtestStandardValues.entries()) {
      if (standardSet.size === 0) continue;
      const actualMax = Math.max(...standardSet);
      const missing = expectedMaxNS - actualMax;
      if (missing >= 3 && actualMax < expectedMaxNS * 0.8) {
        const meta = bucketMetaByKey.get(key);
        if (!meta) continue;
        const sparseLikely = sparseLookupKeys.has(key);
        flags.push(makeFlag({
          code: 'LOOKUP_NS_RANGE_INCOMPLETE',
          severity: sparseLikely ? 'info' : 'blocking',
          message: sparseLikely
            ? `Notes standard partiellement couvertes pour "${meta.subtest}": NS max ${actualMax} vs NS ${expectedMaxNS} sur la page, profil possiblement clairsemé.`
            : `Notes standard incomplètes pour "${meta.subtest}": NS max ${actualMax} alors que les autres sous-tests atteignent NS ${expectedMaxNS}. ${missing} niveaux manquants.`,
          subtest: meta.subtest,
          groupLabel: meta.groupLabel,
          confidence: sparseLikely ? 0.72 : 0.9,
        }));
      }
    }
  }

  return sortFlags(flags);
};

export const computeFlagCounts = (flags: ReviewFlag[]): ReviewFlagCounts => {
  return flags.reduce(
    (acc, flag) => {
      acc.total += 1;
      acc[flag.severity] += 1;
      if (flag.suggestedFix) acc.withFix += 1;
      return acc;
    },
    { blocking: 0, warning: 0, info: 0, total: 0, withFix: 0 } as ReviewFlagCounts,
  );
};

export const suggestFixes = (flags: ReviewFlag[], rows: ExtractedRow[]): ReviewFlag[] => {
  const rowIds = new Set(rows.map((row) => row.id));
  return flags.filter((flag) => {
    if (!flag.suggestedFix) return false;
    if (!rowIds.has(flag.suggestedFix.rowId)) return false;
    return true;
  });
};

const applyFix = (rows: ExtractedRow[], rowId: string, field: ReviewFixField, value: string): ExtractedRow[] => {
  return rows.map((row) => {
    if (row.id !== rowId) return row;
    return { ...row, [field]: value };
  });
};

export const applySuggestedFix = (flag: ReviewFlag, rows: ExtractedRow[]): ExtractedRow[] => {
  if (!flag.suggestedFix) return rows;
  return applyFix(rows, flag.suggestedFix.rowId, flag.suggestedFix.field, flag.suggestedFix.value);
};

export const applyAllSuggestedFixes = (flags: ReviewFlag[], rows: ExtractedRow[]): ExtractedRow[] => {
  const fixes = suggestFixes(flags, rows)
    .map((flag) => flag.suggestedFix)
    .filter((fix): fix is NonNullable<ReviewFlag['suggestedFix']> => !!fix)
    .sort((a, b) => a.rowId.localeCompare(b.rowId));

  const appliedKeys = new Set<string>();
  return fixes.reduce((nextRows, fix) => {
    const key = `${fix.rowId}::${fix.field}`;
    if (appliedKeys.has(key)) return nextRows;
    appliedKeys.add(key);
    return applyFix(nextRows, fix.rowId, fix.field, fix.value);
  }, rows);
};

export type { AnalyzePageInput };
