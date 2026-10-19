import { describe, expect, it } from 'vitest';
import { buildObservationsText, buildQuestionnaireText } from './aiPayload';
import { buildCatalogIndex, CUSTOM_OBSERVATIONS_TEST_ID } from './catalogIndex';
import type { Observations, Patient, TestData } from '../types';

describe('buildQuestionnaireText', () => {
  it('envoie le suivi par la PCO et sa date à l’IA (#36)', () => {
    const text = buildQuestionnaireText({ id: 'p1', pcoFollowup: 'oui', pcoFollowupDate: '2026-03-01' } as Patient);
    expect(text).toContain('Suivi par la PCO: oui, depuis le 2026-03-01');
  });

  it('omet la ligne PCO quand rien n’est renseigné', () => {
    expect(buildQuestionnaireText({ id: 'p1' } as Patient)).not.toContain('PCO');
  });

  it('envoie les champs ajoutés au questionnaire parents (#94, #97, #99)', () => {
    const text = buildQuestionnaireText({
      id: 'p1',
      schoolRepeatYear: 'oui',
      schoolRepeatClass: 'CE1',
      motorDevelopmentTags: 'developpement_tardif',
      extracurricularSport: 'Judo',
      learningNotes: 'Lecture difficile',
      schoolMemory: 'Oublie ses leçons',
      homeworkHabits: 'Long',
    } as Patient);
    expect(text).toContain('Redoublement: oui, classe : CE1');
    expect(text).toContain('Déroulé du développement moteur: developpement_tardif');
    expect(text).toContain('Activité sportive extra-scolaire: Judo');
    expect(text).toContain('--- APPRENTISSAGES ---\nApprentissages: Lecture difficile\nMémorisation: Oublie ses leçons\nDevoirs: Long');
  });
});

describe('buildObservationsText', () => {
  const index = buildCatalogIndex([]);
  const withObservation = (customLabel?: string) =>
    buildObservationsText(
      { id: 'p1' } as Patient,
      {} as Observations,
      { [CUSTOM_OBSERVATIONS_TEST_ID]: { custom_1: { observation: 'Bonne coopération', customLabel } } } as unknown as TestData,
      index,
    );

  it('nomme une observation libre comme l’app, sans doublon (#105)', () => {
    expect(withObservation()).toContain('[Observation libre] Bonne coopération');
    expect(withObservation()).not.toContain('Observations libres');
  });

  it('garde le titre saisi devant le nom du bloc (#105)', () => {
    expect(withObservation('Comportement')).toContain('[Comportement — Observation libre] Bonne coopération');
  });
});
