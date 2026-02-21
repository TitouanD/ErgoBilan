import type {
  ExtractedRow,
  ReviewFixField,
  ReviewFlag,
  ReviewFlagCode,
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

const toFiniteNumber = (value: string): number | null => {
  if (!value) return null;
  const cleaned = value.replace(',', '.').replace(/[^0-9.+-]/g, '');
  if (!cleaned || cleaned === '-' || cleaned === '+' || cleaned === '.' || cleaned === '+.' || cleaned === '-.') {
    return null;
  }
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
};

const isIntervalLike = (value: string): boolean => /\d+\s*[-–—]\s*\d+/.test(value);
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

const hasLookupValue = (row: ExtractedRow): boolean => {
  return [row.raw, row.standard, row.percentile, row.zScore].some((value) => cleanText(value).length > 0);
};

const hasParametricValue = (row: ExtractedRow): boolean => {
  return [row.label || '', row.mean || '', row.sd || ''].some((value) => cleanText(value).length > 0);
};

type IntervalSuggestion = {
  min: number;
  max: number;
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
  return { min: best.left, max: best.right, value: best.split, confidence };
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

export const analyzePageRows = ({ pageId, rows, structure }: AnalyzePageInput): ReviewFlag[] => {
  if (!rows || rows.length === 0) return [];
  const makeFlag = makeFlagFactory(pageId);
  const flags: ReviewFlag[] = [];

  const shouldCheckAges = (row: ExtractedRow): boolean => {
    if (structure === 'LOOKUP') return hasLookupValue(row);
    if (structure === 'PARAMETRIC') return hasParametricValue(row);
    return hasLookupValue(row) || hasParametricValue(row);
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
        message: `Âge invalide ou manquant pour "${row.subtest}" (${cleanGroupLabel(row)}).`,
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
          message: `Ligne paramétrique incomplète (Moyenne/SD) pour "${row.subtest}" (${cleanGroupLabel(row)}).`,
          subtest: row.subtest,
          groupLabel: cleanGroupLabel(row),
          rowId: row.id,
          confidence: 1,
        }));
      }
    });
    return sortFlags(flags);
  }

  const collapsedFlagRowIds = new Set<string>();
  const collapsedSuggestionKey = new Set<string>();
  const percentileBuckets = new Map<string, ExtractedRow[]>();

  rows.forEach((row) => {
    const key = `${subtestBucketKey(row)}::${cleanGroupLabel(row)}`;
    if (!percentileBuckets.has(key)) percentileBuckets.set(key, []);
    percentileBuckets.get(key)!.push(row);
  });

  for (const bucketRows of percentileBuckets.values()) {
    const percentValues = bucketRows
      .map((row) => cleanText(row.percentile))
      .filter((value) => value.length > 0);
    if (percentValues.length < 3) continue;

    const intervalCount = percentValues.filter((value) => isIntervalLike(value)).length;
    const collapsedCount = percentValues.filter((value) => inferIntervalFromCollapsed(value)).length;
    const expectsIntervals = intervalCount / percentValues.length >= 0.5 || collapsedCount / percentValues.length >= 0.4;

    bucketRows.forEach((row) => {
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
        message: `Intervalle probablement fusionné "${current}" pour "${row.subtest}" (${cleanGroupLabel(row)}).`,
        subtest: row.subtest,
        groupLabel: cleanGroupLabel(row),
        rowId: row.id,
        suggestedFix: {
          rowId: row.id,
          field: 'percentile',
          value: suggestion.value,
          reason: `Correction automatique proposée: ${current} → ${suggestion.value}`,
        },
        confidence: suggestion.confidence,
      }));
    });
  }

  rows.forEach((row) => {
    if (!hasLookupValue(row)) return;
    const rawValue = cleanText(row.raw);
    const standardValue = cleanText(row.standard);
    if (!rawValue || !standardValue) {
      flags.push(makeFlag({
        code: 'LOOKUP_REQUIRED_FIELD_MISSING',
        severity: 'blocking',
        message: `Ligne LOOKUP incomplète (Brut et NS requis) pour "${row.subtest}" (${cleanGroupLabel(row)}).`,
        subtest: row.subtest,
        groupLabel: cleanGroupLabel(row),
        rowId: row.id,
        confidence: 1,
      }));
    }

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

    const zValue = toFiniteNumber(cleanText(row.zScore));
    const percentileValue = toFiniteNumber(percentileRaw);
    if (zValue !== null && percentileValue !== null && !isIntervalLike(percentileRaw) && !collapsedFlagRowIds.has(row.id)) {
      const expectedPercentile = zScoreToPercentile(zValue);
      if (Math.abs(expectedPercentile - percentileValue) >= 5) {
        flags.push(makeFlag({
          code: 'LOOKUP_Z_PERCENTILE_INCONSISTENT',
          severity: 'warning',
          message: `Incohérence Z/% pour "${row.subtest}" (${cleanGroupLabel(row)}): attendu ~${expectedPercentile}, reçu ${percentileRaw}.`,
          subtest: row.subtest,
          groupLabel: cleanGroupLabel(row),
          rowId: row.id,
          confidence: 1,
        }));
      }
    }
  });

  const groupCounts = new Map<string, Map<string, { subtest: string; count: number }>>();
  rows.forEach((row) => {
    if (!hasLookupValue(row)) return;
    const groupLabel = cleanGroupLabel(row);
    if (!groupCounts.has(groupLabel)) {
      groupCounts.set(groupLabel, new Map<string, { subtest: string; count: number }>());
    }
    const perSubtest = groupCounts.get(groupLabel)!;
    const key = subtestBucketKey(row);
    const current = perSubtest.get(key);
    if (current) {
      current.count += 1;
    } else {
      perSubtest.set(key, { subtest: row.subtest, count: 1 });
    }
  });

  for (const [groupLabel, perSubtest] of groupCounts.entries()) {
    if (perSubtest.size < 2) continue;
    const entries = Array.from(perSubtest.values());
    const expected = expectedCountForGroup(entries);
    const mismatch = entries.filter((entry) => entry.count !== expected);
    mismatch.forEach((entry) => {
      flags.push(makeFlag({
        code: 'GROUP_ROW_COUNT_MISMATCH',
        severity: 'blocking',
        message: `Nombre de lignes incohérent pour "${entry.subtest}" dans "${groupLabel}" (${entry.count} au lieu de ${expected}).`,
        subtest: entry.subtest,
        groupLabel,
        confidence: 1,
      }));
    });
  }

  const plateauBuckets = new Map<string, number[]>();
  rows.forEach((row) => {
    const zValue = toFiniteNumber(cleanText(row.zScore));
    if (zValue === null) return;
    const key = `${subtestBucketKey(row)}::${cleanGroupLabel(row)}`;
    if (!plateauBuckets.has(key)) plateauBuckets.set(key, []);
    plateauBuckets.get(key)!.push(zValue);
  });
  for (const [key, zValues] of plateauBuckets.entries()) {
    if (zValues.length < 4) continue;
    const zeroCount = zValues.filter((value) => Math.abs(value) <= 0.01).length;
    if (zeroCount / zValues.length < 0.75) continue;
    const [subtest, groupLabel] = key.split('::');
    flags.push(makeFlag({
      code: 'LOOKUP_ZERO_Z_PLATEAU',
      severity: 'info',
      message: `Plateau massif de Z=0 détecté pour "${subtest}" (${groupLabel}).`,
      subtest,
      groupLabel,
      confidence: 0.9,
    }));
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
