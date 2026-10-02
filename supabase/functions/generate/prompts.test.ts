import { describe, expect, it } from 'vitest';
import { AI_TASKS, buildTask, isAfterReevaluation, sessionKind } from './prompts.ts';

describe('sessionKind (generation_log.kind, #60)', () => {
  it('tags the sessions opened by report_bio and report_reevaluation with their task', () => {
    expect(sessionKind('report_bio')).toBe('report_bio');
    expect(sessionKind('report_reevaluation')).toBe('report_reevaluation');
  });

  it('is null for the tasks that open no session', () => {
    expect(sessionKind('report_diagnostic')).toBeNull();
    expect(sessionKind('extract_style_feedback')).toBeNull();
  });

  it('covers every task', () => {
    expect(AI_TASKS.map(sessionKind)).toEqual(['report_bio', null, null, 'report_reevaluation']);
  });
});

describe('report_reevaluation prompt: reference report (#85)', () => {
  const payload = (childContext: string) => ({
    childContext,
    previousReportContext: '[Conclusion]\nProgression notable.',
    previousScoresSummary: 'BHK : ET -1',
    newScoresSummary: 'BHK : ET 0',
    evolutionSummary: 'BHK : +1',
  });

  // Context written by utils/aiPayload.ts (buildReevaluationPayload).
  const afterInitial = 'Enfant de 8 ans. | Bilan initial réalisé : 01/2026 | Réévaluation réalisée : 06/2026';
  const afterReevaluation = 'Enfant de 8 ans. | Réévaluation précédente réalisée : 06/2026 | Réévaluation réalisée : 10/2026';

  it('detects a previous re-evaluation from the client context', () => {
    expect(isAfterReevaluation(afterReevaluation)).toBe(true);
    expect(isAfterReevaluation('Reevaluation precedente realisee : 06/2026')).toBe(true);
    expect(isAfterReevaluation(afterInitial)).toBe(false);
    expect(isAfterReevaluation('')).toBe(false);
  });

  it('names the reference report generically, never "BILAN INITIAL"', () => {
    for (const ctx of [afterInitial, afterReevaluation]) {
      const { contents } = buildTask('report_reevaluation', payload(ctx));
      expect(contents).toContain('CONTENU DU BILAN DE REFERENCE (bilan initial ou reevaluation precedente');
      expect(contents).toContain('SCORES BILAN DE REFERENCE');
      expect(contents).not.toContain('CONTENU DU BILAN INITIAL');
      expect(contents).not.toContain('SCORES BILAN INITIAL');
    }
  });

  it('after a previous re-evaluation, summarizes it as such', () => {
    const { contents } = buildTask('report_reevaluation', payload(afterReevaluation));
    expect(contents).toContain('Lors de la derniere reevaluation, le');
    expect(contents).toContain('<th>Reevaluation precedente (DATE_REFERENCE)</th>');
    expect(contents).not.toContain("Phrase d'introduction situant le bilan initial");
  });

  it('after an initial assessment (client of main), keeps the initial-assessment summary', () => {
    const { contents } = buildTask('report_reevaluation', payload(afterInitial));
    expect(contents).toContain("Phrase d'introduction situant le bilan initial");
    expect(contents).toContain('<th>Bilan initial (DATE_REFERENCE)</th>');
    expect(contents).not.toContain('Lors de la derniere reevaluation');
  });
});
