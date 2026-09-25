import { describe, expect, it } from 'vitest';
import { calculateAge } from './patient';

describe('calculateAge', () => {
  it('counts completed months, not calendar months', () => {
    expect(calculateAge('2018-03-20', new Date(2024, 8, 10))).toBe('6 ans 5 mois');
    expect(calculateAge('2018-03-20', new Date(2024, 8, 20))).toBe('6 ans 6 mois');
  });

  it('handles the birthday month before the birthday', () => {
    expect(calculateAge('2018-03-20', new Date(2024, 2, 10))).toBe('5 ans 11 mois');
  });

  it('uses the reference date (assessment date)', () => {
    expect(calculateAge('2015-01-01', '2020-06-15')).toBe('5 ans 5 mois');
  });

  it('returns an empty string for invalid or future dates', () => {
    expect(calculateAge('', new Date())).toBe('');
    expect(calculateAge('not a date')).toBe('');
    expect(calculateAge('2030-01-01', new Date(2024, 0, 1))).toBe('');
  });
});
