import { describe, expect, it } from 'vitest';
import { calculateAge, summarizePatientIdentity } from './patient';

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

describe('summarizePatientIdentity (#116)', () => {
  it('gives the name, the age in years and months and the class', () => {
    expect(
      summarizePatientIdentity({ firstName: 'Léo', lastName: 'FICTIF', dob: '2018-03-20', classLevel: 'CE2' }, new Date(2026, 9, 1)),
    ).toEqual({ fullName: 'Léo FICTIF', age: '8 ans 6 mois', classLevel: 'CE2' });
  });

  it('uses the text typed for an « Autre » class', () => {
    expect(summarizePatientIdentity({ firstName: 'Léo', classLevel: 'Autre', classLevelOther: 'ULIS' }).classLevel).toBe('ULIS');
    expect(summarizePatientIdentity({ firstName: 'Léo', classLevel: 'Autre' }).classLevel).toBe('');
  });

  it('falls back on the stored age and leaves missing fields empty', () => {
    expect(summarizePatientIdentity({ firstName: '', lastName: 'FICTIF', age: '7 ans' })).toEqual({
      fullName: 'FICTIF',
      age: '7 ans',
      classLevel: '',
    });
  });
});
