import { describe, expect, it } from 'vitest';
import { getNormStatusMessage, inferAutoDirection, resolveEffectiveDirection } from './scoreDirection';

describe('scoreDirection', () => {
  it('infers lower_better for time/error related labels', () => {
    expect(inferAutoDirection('Inhibition - Dénomination (Temps)')).toBe('lower_better');
    expect(inferAutoDirection('Nombre d erreurs')).toBe('lower_better');
  });

  it('infers higher_better by default', () => {
    expect(inferAutoDirection('Cubes')).toBe('higher_better');
  });

  it('resolves explicit raw direction first', () => {
    expect(resolveEffectiveDirection('higher_better', 'Temps')).toBe('higher_better');
    expect(resolveEffectiveDirection('lower_better', 'Cubes')).toBe('lower_better');
  });

  it('resolves pending override first', () => {
    expect(resolveEffectiveDirection('higher_better', 'Cubes', 'lower_better')).toBe('lower_better');
  });

  it('returns message for known norm statuses', () => {
    expect(getNormStatusMessage('no_norms')).toContain('Aucune norme');
    expect(getNormStatusMessage('no_applicable_age_gender')).toContain('non applicables');
    expect(getNormStatusMessage('onboarding_required')).toContain('Onboarding');
    expect(getNormStatusMessage('access_restricted')).toContain('Accès restreint');
    expect(getNormStatusMessage('ok')).toBeNull();
  });
});

