import { describe, expect, it } from 'vitest';
import type { Patient } from '../types';
import { createAnonymization } from './anonymizer';

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

/** Anonymization and re-hydration through the only public entry point. */
const anonymizeText = (text: string, p: Patient) => createAnonymization(p).deep(text);
const hydrateReport = (text: string, p: Patient, options?: { asHtml?: boolean }) => createAnonymization(p).hydrate(text, options);

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

describe('deep', () => {
  it('walks nested objects and arrays', () => {
    const out = createAnonymization(patient).deep({ a: 'Ali', b: [{ c: 'Martin' }], n: 3 });
    expect(out).toEqual({ a: '{{PATIENT_PRENOM}}', b: [{ c: '{{PATIENT_NOM}}' }], n: 3 });
  });
});

describe('hydrateReport', () => {
  it('restores values and neutralizes unknown placeholders', () => {
    expect(hydrateReport('{{PATIENT_PRENOM}} va à {{ECOLE}}. {{INCONNU}}', patient)).toBe('Ali va à École Jean Moulin. ');
  });

  it('does not repeat the kind of school already in its name (#82)', () => {
    const tilleuls = { ...patient, school: 'École des Tilleuls' } as Patient;
    expect(hydrateReport("Scolarisée en CE1 à l'école {{ECOLE}}.", tilleuls)).toBe("Scolarisée en CE1 à l'École des Tilleuls.");
    expect(hydrateReport("<p>à l'école élémentaire {{ECOLE}}</p>", tilleuls, { asHtml: true })).toBe("<p>à l'École des Tilleuls</p>");
    expect(hydrateReport('au collège {{ECOLE}}', { ...patient, school: 'Collège Victor Hugo' } as Patient)).toBe('au Collège Victor Hugo');
    expect(hydrateReport('au collège {{ECOLE}}', { ...patient, school: 'Mescoat' } as Patient)).toBe('au collège Mescoat');
    expect(hydrateReport("l'école de {{PATIENT_PRENOM}}, l'école {{ENSEIGNANT}}", tilleuls)).toBe("l'école de Ali, l'école l'enseignant(e)");
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

describe('createAnonymization', () => {
  const now = new Date(2026, 8, 29);

  it('masks precise dates with their distance, keeps years and scores', () => {
    const deep = (text: string) => createAnonymization(patient, now).deep(text);
    expect(deep('Suivi le 12/01/2025, le 2026-02-10, en 03/2026, le 1er mars 2024, en août 2022, en 2021, score 12/15.')).toBe(
      'Suivi le {{DATE_1}} (il y a 1 an et 8 mois), le {{DATE_2}} (il y a 7 mois), en {{DATE_3}} (il y a 6 mois), le {{DATE_4}} (il y a 2 ans et 6 mois), en {{DATE_5}} (il y a 4 ans et 1 mois), en 2021, score 12/15.',
    );
    expect(deep('Prochain bilan en 11/2026, ce mois : 09/2026. Pas une date : 13/2026.')).toBe(
      'Prochain bilan en {{DATE_1}} (dans 2 mois), ce mois : {{DATE_2}} (ce mois-ci). Pas une date : 13/2026.',
    );
  });

  it('numbers the same date once and re-hydrates it, with or without the distance', () => {
    const a = createAnonymization(patient, now);
    expect(a.deep({ x: 'Le 12/01/2025.', y: ['Depuis le 12/01/2025'] })).toEqual({
      x: 'Le {{DATE_1}} (il y a 1 an et 8 mois).',
      y: ['Depuis le {{DATE_1}} (il y a 1 an et 8 mois)'],
    });
    expect(a.hydrate('{{PATIENT_PRENOM}} : {{DATE_1}} (il y a 1 an et 8 mois), puis {{DATE_1}}. {{DATE_9}} (il y a 3 mois)')).toBe(
      'Ali : 12/01/2025, puis 12/01/2025. ',
    );
  });

  it('masks the words chosen by the practitioner', () => {
    const a = createAnonymization({ ...patient, aiMaskedTerms: ['Titi'] } as Patient, now);
    expect(a.deep('titi et Titi')).toBe('{{PERSONNE_1}} et {{PERSONNE_1}}');
    expect(a.hydrate('{{PERSONNE_1}} et {{PERSONNE_2}}')).toBe('Titi et cette personne');
  });

  it('writes ISO dates of the date fields back the French way, and ignores 3.2024', () => {
    const a = createAnonymization(patient, now);
    expect(a.deep('PCO le 2025-08-12, suivi depuis 2025-08, score 3.2024.')).toBe(
      'PCO le {{DATE_1}} (il y a 1 an et 1 mois), suivi depuis {{DATE_2}} (il y a 1 an et 1 mois), score 3.2024.',
    );
    expect(a.hydrate('{{DATE_1}} et {{DATE_2}}')).toBe('12/08/2025 et 08/2025');
  });
});
