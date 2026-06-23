import type { DisplayFilterMode, DisplayLookupRow, ExtractedRow, ReviewFlag } from '../types';

type LookupDisplayDirection = 'increasing' | 'decreasing' | 'ambiguous';

type LookupDisplaySortEntry = {
  row: ExtractedRow;
  originalIndex: number;
  standardValue: number | null;
  percentileValue: number | null;
  zValue: number | null;
  rawBounds: { min: number; max: number } | null;
};

export type DominantLookupAgeRange = {
  min: number;
  max: number;
  count: number;
  ratio: number;
};

const parseSingleNumericCell = (value?: string | null): number | null => {
  if (!value) return null;
  const normalized = value.replace(',', '.').trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

const parseLookupRawBoundsForDisplay = (row: ExtractedRow): { min: number; max: number } | null => {
  const normalized = String(row.raw || '')
    .replace(/[\u2012\u2013\u2014\u2212]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized || normalized === '-') return null;

  const extractNumbers = (value: string): number[] => (
    Array.from(value.matchAll(/-?\d+(?:[.,]\d+)?/g))
      .map((match) => Number(match[0].replace(',', '.')))
      .filter((candidate) => Number.isFinite(candidate))
  );

  if (/^\s*(?:>=|>|≥)\s*/.test(normalized)) {
    const values = extractNumbers(normalized);
    if (values.length === 0) return null;
    return { min: values[0], max: values[0] };
  }

  if (/^\s*(?:<=|<|≤)\s*/.test(normalized)) {
    const values = extractNumbers(normalized);
    if (values.length === 0) return null;
    return { min: values[0], max: values[0] };
  }

  const rangeMatch = normalized.match(/(-?\d+(?:[.,]\d+)?)\s*-\s*(-?\d+(?:[.,]\d+)?)/);
  if (rangeMatch) {
    const left = Number(rangeMatch[1].replace(',', '.'));
    const right = Number(rangeMatch[2].replace(',', '.'));
    if (!Number.isFinite(left) || !Number.isFinite(right)) return null;
    return left <= right ? { min: left, max: right } : { min: right, max: left };
  }

  const singleValue = parseSingleNumericCell(normalized);
  if (singleValue === null) return null;
  return { min: singleValue, max: singleValue };
};

const inferLookupDisplayDirection = (entries: LookupDisplaySortEntry[]): LookupDisplayDirection => {
  let increases = 0;
  let decreases = 0;

  for (let index = 1; index < entries.length; index += 1) {
    const previous = entries[index - 1];
    const current = entries[index];
    if (!previous.rawBounds || !current.rawBounds) continue;
    if (current.rawBounds.min < previous.rawBounds.min) continue;
    if (previous.standardValue === null || current.standardValue === null) continue;
    if (current.standardValue > previous.standardValue) increases += 1;
    else if (current.standardValue < previous.standardValue) decreases += 1;
  }

  if (increases === 0 && decreases === 0) return 'ambiguous';
  if (decreases > increases) return 'decreasing';
  if (increases > decreases) return 'increasing';
  return 'ambiguous';
};

export const sortLookupRowsForDisplay = (rows: ExtractedRow[]): ExtractedRow[] => {
  const entries: LookupDisplaySortEntry[] = rows.map((row, originalIndex) => ({
    row,
    originalIndex,
    standardValue: parseSingleNumericCell(row.standard),
    percentileValue: parseSingleNumericCell(row.percentile),
    zValue: parseSingleNumericCell(row.zScore),
    rawBounds: parseLookupRawBoundsForDisplay(row),
  }));

  const direction = inferLookupDisplayDirection(entries);
  const rawSortValue = (entry: LookupDisplaySortEntry): number | null => {
    if (!entry.rawBounds) return null;
    return direction === 'decreasing' ? -entry.rawBounds.max : entry.rawBounds.min;
  };

  const getPrimarySortKey = (entry: LookupDisplaySortEntry): { tier: number; value: number } => {
    if (entry.standardValue !== null) return { tier: 0, value: entry.standardValue };
    if (entry.percentileValue !== null) return { tier: 1, value: entry.percentileValue };
    if (entry.zValue !== null) return { tier: 2, value: entry.zValue };
    const rawValue = rawSortValue(entry);
    if (rawValue !== null) return { tier: 3, value: rawValue };
    return { tier: 4, value: entry.originalIndex };
  };

  return [...entries]
    .sort((left, right) => {
      const leftKey = getPrimarySortKey(left);
      const rightKey = getPrimarySortKey(right);

      if (leftKey.tier !== rightKey.tier) return leftKey.tier - rightKey.tier;
      if (leftKey.value !== rightKey.value) return leftKey.value - rightKey.value;

      const leftRaw = rawSortValue(left);
      const rightRaw = rawSortValue(right);
      if (leftRaw !== null && rightRaw !== null && leftRaw !== rightRaw) {
        return leftRaw - rightRaw;
      }

      return left.originalIndex - right.originalIndex;
    })
    .map((entry) => entry.row);
};

const parseScaledStandardValue = (row: ExtractedRow): number | null => {
  const parsed = parseSingleNumericCell(row.standard);
  if (parsed === null || !Number.isInteger(parsed)) return null;
  if (parsed < 1 || parsed > 19) return null;
  return parsed;
};

const inferExpectedScaledStandards = (rows: ExtractedRow[]): number[] | null => {
  const scaledValues = rows
    .map(parseScaledStandardValue)
    .filter((value): value is number => value !== null);

  if (scaledValues.length < 3) return null;

  const unique = Array.from(new Set(scaledValues)).sort((left, right) => left - right);
  if (unique.length < 3) return null;

  const isContiguous = unique.every((value, index) => index === 0 || value === unique[index - 1] + 1);
  if (!isContiguous) return null;

  return Array.from({ length: 19 }, (_, index) => index + 1);
};

export const buildLookupDisplayRows = (rows: ExtractedRow[]): DisplayLookupRow[] => {
  const sortedRows = sortLookupRowsForDisplay(rows);
  const expectedStandards = inferExpectedScaledStandards(sortedRows);
  if (!expectedStandards) {
    return sortedRows.map((row) => ({
      id: row.id,
      row,
      isPlaceholder: false,
      displayRaw: row.raw,
      displayStandard: row.standard,
      displayZScore: row.zScore,
      displayPercentile: row.percentile,
    }));
  }

  const rowsByStandard = new Map<number, ExtractedRow[]>();
  const leftovers: ExtractedRow[] = [];
  sortedRows.forEach((row) => {
    const standardValue = parseScaledStandardValue(row);
    if (standardValue === null) {
      leftovers.push(row);
      return;
    }
    const current = rowsByStandard.get(standardValue) || [];
    current.push(row);
    rowsByStandard.set(standardValue, current);
  });

  const displayRows: DisplayLookupRow[] = [];
  expectedStandards.forEach((standardValue) => {
    const matchingRows = rowsByStandard.get(standardValue) || [];
    if (matchingRows.length === 0) {
      displayRows.push({
        id: `placeholder-ns-${standardValue}`,
        isPlaceholder: true,
        displayRaw: '',
        displayStandard: String(standardValue),
        displayZScore: '',
        displayPercentile: '',
      });
      return;
    }

    matchingRows.forEach((row) => {
      displayRows.push({
        id: row.id,
        row,
        isPlaceholder: false,
        displayRaw: row.raw,
        displayStandard: row.standard,
        displayZScore: row.zScore,
        displayPercentile: row.percentile,
      });
    });
  });

  leftovers.forEach((row) => {
    displayRows.push({
      id: row.id,
      row,
      isPlaceholder: false,
      displayRaw: row.raw,
      displayStandard: row.standard,
      displayZScore: row.zScore,
      displayPercentile: row.percentile,
    });
  });

  return displayRows;
};

export const filterRowsByDisplayMode = (
  rows: ExtractedRow[],
  flags: Pick<ReviewFlag, 'rowId' | 'subtest'>[],
  mode: DisplayFilterMode,
): ExtractedRow[] => {
  if (mode === 'all' || flags.length === 0) return rows;

  const flaggedSubtests = new Set(
    flags
      .map((flag) => flag.subtest)
      .filter((subtest): subtest is string => typeof subtest === 'string' && subtest.trim().length > 0),
  );
  const flaggedRowIds = new Set(
    flags
      .map((flag) => flag.rowId)
      .filter((rowId): rowId is string => typeof rowId === 'string' && rowId.trim().length > 0),
  );

  return rows.filter((row) => flaggedRowIds.has(row.id) || flaggedSubtests.has(row.subtest));
};

const isFiniteMonth = (value: unknown): value is number => Number.isFinite(Number(value));

const buildAgeKey = (min: number, max: number): string => `${min}:${max}`;

const formatAgeRangeLabel = (min: number, max: number): string => {
  const toAgeToken = (months: number) => `${Math.floor(months / 12)};${months % 12}`;
  return min === max ? toAgeToken(min) : `${toAgeToken(min)} – ${toAgeToken(max)}`;
};

const isNearbyAgeRange = (left: { min: number; max: number }, right: { min: number; max: number }): boolean => (
  Math.abs(left.min - right.min) <= 1 && Math.abs(left.max - right.max) <= 1
);

export const getDominantLookupAgeRange = (rows: ExtractedRow[]): DominantLookupAgeRange | null => {
  const buckets = new Map<string, DominantLookupAgeRange>();
  let countedRows = 0;

  rows.forEach((row) => {
    if (!isFiniteMonth(row.hidden_age_min) || !isFiniteMonth(row.hidden_age_max)) return;
    const min = Number(row.hidden_age_min);
    const max = Number(row.hidden_age_max);
    const key = buildAgeKey(min, max);
    countedRows += 1;
    const existing = buckets.get(key);
    if (existing) {
      existing.count += 1;
      return;
    }
    buckets.set(key, { min, max, count: 1, ratio: 0 });
  });

  if (countedRows === 0 || buckets.size === 0) return null;
  const dominant = [...buckets.values()].sort((left, right) => right.count - left.count)[0];
  dominant.ratio = dominant.count / countedRows;
  return dominant;
};

export const normalizeLookupRowsToDominantAgeRange = (
  rows: ExtractedRow[],
): { rows: ExtractedRow[]; applied: boolean; dominantAge: DominantLookupAgeRange | null } => {
  const dominantAge = getDominantLookupAgeRange(rows);
  if (!dominantAge) return { rows, applied: false, dominantAge: null };

  const distinctKnownAges = new Set(
    rows
      .filter((row) => isFiniteMonth(row.hidden_age_min) && isFiniteMonth(row.hidden_age_max))
      .map((row) => buildAgeKey(Number(row.hidden_age_min), Number(row.hidden_age_max))),
  );

  if (distinctKnownAges.size <= 1) {
    return { rows, applied: false, dominantAge };
  }

  const canNormalizeSafely = dominantAge.ratio >= 0.6 && [...distinctKnownAges].every((key) => {
    const [minRaw, maxRaw] = key.split(':');
    const range = { min: Number(minRaw), max: Number(maxRaw) };
    return isNearbyAgeRange(range, dominantAge);
  });

  if (!canNormalizeSafely) {
    return { rows, applied: false, dominantAge };
  }

  const normalizedRows = rows.map((row) => {
    const nextRow: ExtractedRow = {
      ...row,
      hidden_age_min: dominantAge.min,
      hidden_age_max: dominantAge.max,
    };

    if (!row.hidden_group_label) {
      nextRow.label = formatAgeRangeLabel(dominantAge.min, dominantAge.max);
    }

    return nextRow;
  });

  return {
    rows: normalizedRows,
    applied: true,
    dominantAge,
  };
};
