import { describe, expect, it } from 'vitest';
import { buildQuestionnaireText } from './aiPayload';
import type { Patient } from '../types';

describe('buildQuestionnaireText', () => {
  it('envoie le suivi par la PCO et sa date à l’IA (#36)', () => {
    const text = buildQuestionnaireText({ id: 'p1', pcoFollowup: 'oui', pcoFollowupDate: '2026-03-01' } as Patient);
    expect(text).toContain('Suivi par la PCO: oui, date : 2026-03-01');
  });

  it('omet la ligne PCO quand rien n’est renseigné', () => {
    expect(buildQuestionnaireText({ id: 'p1' } as Patient)).not.toContain('PCO');
  });
});
