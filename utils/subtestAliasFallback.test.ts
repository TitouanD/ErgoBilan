import { describe, expect, it } from 'vitest';
import { resolveSubtestAlias } from '../data/subtestAliases';

describe('resolveSubtestAlias NEPSY 2 fallback', () => {
  it('prefers lookup-table abbreviation fallbacks when canonical loading is unavailable', () => {
    expect(resolveSubtestAlias('Nepsy 2', 'Mémoire de Faces - C', { abbreviation: 'MFC' })).toBe('Mémoire Faciale Couleurs');
    expect(resolveSubtestAlias('Nepsy 2', 'Mémoire de Figures - D', { abbreviation: 'MFDC' })).toBe('Mémoire Dénomination Couleurs');
    expect(resolveSubtestAlias('Nepsy 2', 'Prosodie Mélodique', { abbreviation: 'PMS' })).toBe('Phonologie et Morphologie Syntaxe');
    expect(resolveSubtestAlias('Nepsy 2', 'Vitesse de Traitement Visuo-Moteur', { abbreviation: 'PV' })).toBe('Précision visuomotrice');
  });
});
