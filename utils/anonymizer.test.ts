import { describe, expect, it } from 'vitest';
import type { Patient } from '../types';
import { anonymizeDeep, anonymizeText, hydrateReport } from './anonymizer';

const patient = {
  firstName: 'Ali',
  lastName: 'Martin',
  dob: '2018-03-20',
  parent1Name: 'Sophie Martin',
  parent2Name: 'Karim Benali',
  siblings: [{ firstName: 'Inès', age: '5', relation: 'soeur', livesWithChild: true }],
  school: 'École Jean Moulin',
  prescribingDoctor: 'Dr Dupont',
  medicalTracking: [{ id: '1', type: 'kiné', name: 'Paul Legrand', frequency: '', since: '', contact: '', reason: '' }],
} as unknown as Patient;

describe('anonymizeText', () => {
  it('replaces whole words only (no corruption of longer words)', () => {
    const out = anonymizeText('Ali montre une qualité de réalisation correcte.', patient);
    expect(out).toBe('{{PATIENT_PRENOM}} montre une qualité de réalisation correcte.');
  });

  it('is case-insensitive for full values', () => {
    expect(anonymizeText('ALI et ali', patient)).toBe('{{PATIENT_PRENOM}} et {{PATIENT_PRENOM}}');
  });

  it('covers parents, siblings, school, doctors and professionals', () => {
    const out = anonymizeText(
      'Karim Benali accompagne Inès. Suivi par Paul Legrand à École Jean Moulin, adressé par Dr Dupont. Karim est présent.',
      patient,
    );
    expect(out).not.toMatch(/Karim|Benali|Inès|Paul|Legrand|Jean Moulin|Dupont/);
    expect(out).toContain('{{PARENT_2}}');
    expect(out).toContain('{{FRATRIE_1}}');
    expect(out).toContain('{{PROFESSIONNEL_1}}');
  });

  it('does not treat civilities as identifying tokens', () => {
    const p = { ...patient, parentNames: 'Mme Durand' } as Patient;
    expect(anonymizeText('Mme Leroy, enseignante.', p)).toBe('Mme Leroy, enseignante.');
  });
});

describe('anonymizeDeep', () => {
  it('walks nested objects and arrays', () => {
    const out = anonymizeDeep({ a: 'Ali', b: [{ c: 'Martin' }], n: 3 }, patient);
    expect(out).toEqual({ a: '{{PATIENT_PRENOM}}', b: [{ c: '{{PATIENT_NOM}}' }], n: 3 });
  });
});

describe('hydrateReport', () => {
  it('restores values and neutralizes unknown placeholders', () => {
    expect(hydrateReport('{{PATIENT_PRENOM}} va à {{ECOLE}}. {{INCONNU}}', patient)).toBe('Ali va à École Jean Moulin. ');
  });

  it('escapes values injected into HTML', () => {
    const p = { ...patient, firstName: '<img src=x onerror=alert(1)>' } as Patient;
    expect(hydrateReport('<p>{{PATIENT_PRENOM}}</p>', p, { asHtml: true })).toBe('<p>&lt;img src=x onerror=alert(1)&gt;</p>');
  });

  it('round-trips', () => {
    const text = 'Ali et Sophie Martin sont venus.';
    expect(hydrateReport(anonymizeText(text, patient), patient)).toBe(text);
  });
});
