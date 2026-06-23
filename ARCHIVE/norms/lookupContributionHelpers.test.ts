import { describe, expect, it } from 'vitest';
import type { ExtractedRow } from '../types';
import {
  buildLookupDisplayRows,
  filterRowsByDisplayMode,
  getDominantLookupAgeRange,
  normalizeLookupRowsToDominantAgeRange,
  sortLookupRowsForDisplay,
} from './lookupContributionHelpers';

const makeLookupRow = (
  id: string,
  raw: string,
  standard: string,
  ageMin: number,
  ageMax: number,
): ExtractedRow => ({
  id,
  subtest: 'Inhibition - Dénomination (Temps)',
  label: '5;0 – 5;6',
  raw,
  standard,
  zScore: '',
  percentile: '',
  hidden_age_min: ageMin,
  hidden_age_max: ageMax,
});

describe('lookupContributionHelpers', () => {
  it('sorts lookup rows in deterministic NS order', () => {
    const rows = [
      makeLookupRow('late', '0-59', '19', 60, 65),
      makeLookupRow('mid', '80-86', '12', 60, 65),
      makeLookupRow('early', '≥ 168', '1', 60, 65),
    ];

    const sorted = sortLookupRowsForDisplay(rows);
    expect(sorted.map((row) => row.standard)).toEqual(['1', '12', '19']);
  });

  it('reconstructs sparse scaled lookup rows with display-only placeholders', () => {
    const rows = Array.from({ length: 13 }, (_, index) =>
      makeLookupRow(`aa-${index + 1}`, String(index), String(index + 3), 60, 65),
    );

    const displayRows = buildLookupDisplayRows(rows);

    expect(displayRows).toHaveLength(19);
    expect(displayRows.filter((row) => row.isPlaceholder)).toHaveLength(6);
    expect(displayRows.slice(0, 2).every((row) => row.isPlaceholder)).toBe(true);
    expect(displayRows.slice(-4).every((row) => row.isPlaceholder)).toBe(true);
    expect(displayRows[2].row?.standard).toBe('3');
  });

  it('filters rows according to display mode', () => {
    const rows = [
      makeLookupRow('keep', '0-59', '19', 60, 65),
      makeLookupRow('hide', '80-86', '12', 60, 65),
    ];
    rows[0].subtest = 'Flagged';
    rows[1].subtest = 'Safe';

    expect(filterRowsByDisplayMode(rows, [{ subtest: 'Flagged' }], 'all')).toHaveLength(2);
    expect(filterRowsByDisplayMode(rows, [{ subtest: 'Flagged' }], 'flagged').map((row) => row.id)).toEqual(['keep']);
  });

  it('computes the dominant lookup age range', () => {
    const dominant = getDominantLookupAgeRange([
      makeLookupRow('a', '0', '1', 60, 65),
      makeLookupRow('b', '1', '2', 60, 65),
      makeLookupRow('c', '2', '3', 60, 66),
    ]);

    expect(dominant?.min).toBe(60);
    expect(dominant?.max).toBe(65);
    expect(dominant?.count).toBe(2);
  });

  it('normalizes nearby age drifts to the dominant page age', () => {
    const input = [
      makeLookupRow('a', '0', '1', 60, 65),
      makeLookupRow('b', '1', '2', 60, 65),
      makeLookupRow('c', '2', '3', 60, 66),
    ];

    const normalized = normalizeLookupRowsToDominantAgeRange(input);

    expect(normalized.applied).toBe(true);
    expect(normalized.rows.every((row) => row.hidden_age_min === 60 && row.hidden_age_max === 65)).toBe(true);
    expect(normalized.rows.every((row) => row.label === '5;0 – 5;5')).toBe(true);
  });

  it('does not normalize when age buckets diverge too much', () => {
    const input = [
      makeLookupRow('a', '0', '1', 60, 65),
      makeLookupRow('b', '1', '2', 60, 65),
      makeLookupRow('c', '2', '3', 72, 83),
    ];

    const normalized = normalizeLookupRowsToDominantAgeRange(input);
    expect(normalized.applied).toBe(false);
  });
});
