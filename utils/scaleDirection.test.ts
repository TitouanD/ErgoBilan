/**
 * Échelles où une note haute signale une difficulté (#122) : BRIEF-2 et SPM
 * (notes T), Internalisé et Externalisé de la Vineland-3 (notes v).
 */
import { describe, expect, it } from 'vitest';
import type { CategoryDef } from '../data/testCatalog';
import { fictiveScore } from '../dev/fictiveScores';
import { buildScoresEvidence } from './aiPayload';
import { buildCatalogIndex } from './catalogIndex';
import { buildDeltaEntries } from './reevaluationHelpers';
import { computeDotChart, readingGuide } from './reportData';
import { describeScore, resolveScores } from './resolvedScore';
import { isHigherWorse, resolveScaleType } from './scoring';

const SPM_TOUCH = {
  id: 'spm__touch',
  name: 'Toucher (Touch)',
  unit: '',
  scoreType: 't-score-inverse',
  inputModel: 'numeric_4mode',
} as const;
const catalog: CategoryDef[] = [
  {
    id: 'sensoriel',
    name: 'Sensoriel',
    iconKey: 'Brain',
    sortOrder: 1,
    tests: [
      { id: 'spm', name: 'SPM', subtests: [SPM_TOUCH] },
      {
        id: 'vineland-3',
        name: 'Vineland-3',
        subtests: [
          { id: 'vineland-3__internalizing', name: 'Internalisé', unit: '', scoreType: 'v-scale-inverse', inputModel: 'numeric_4mode' },
          { id: 'vineland-3__receptive', name: 'Réceptif', unit: '', scoreType: 'v-scale', inputModel: 'numeric_4mode' },
        ],
      },
    ],
  },
];
const index = buildCatalogIndex(catalog);
const spm = (value: string, unit: 'NS' | 'ET' | '%' = 'NS') => describeScore(index, 'spm', 'spm__touch', { value, unit });

describe('échelles inversées : lecture', () => {
  it('reconnaît les deux échelles et leur sens', () => {
    expect(resolveScaleType('t-score-inverse')).toBe('t-score-inverse');
    expect(resolveScaleType('v-scale-inverse')).toBe('v-scale-inverse');
    expect(isHigherWorse('t-score-inverse')).toBe(true);
    expect(isHigherWorse('v-scale-inverse')).toBe(true);
    expect(isHigherWorse('t-score')).toBe(false);
  });

  it('une note T haute est une difficulté, une note T moyenne reste dans la moyenne', () => {
    expect(spm('72').zone).toBe('deficit');
    expect(spm('63').zone).toBe('fragile');
    expect(spm('45').zone).toBe('normal');
    // Même une note très basse (peu de difficultés) reste « dans la moyenne ».
    expect(spm('30').zone).toBe('normal');
  });

  it('affiche la valeur dans le sens du manuel, le z est orienté (négatif = difficulté)', () => {
    const r = spm('72');
    expect(r.higherIsWorse).toBe(true);
    expect(r.display()).toBe('72 NS');
    expect(r.display('ET')).toBe('+2.2 ET');
    expect(r.display('%')).toBe('99 %');
    expect(r.z).toBeCloseTo(-2.2, 5);
    expect(r.pct).toBe(1);
  });

  it('une saisie en ET ou en % se lit aussi dans le sens du manuel', () => {
    expect(spm('2.2', 'ET').zone).toBe('deficit');
    expect(spm('98', '%').zone).toBe('deficit');
    expect(spm('-0.5', 'ET').zone).toBe('normal');
  });

  it('Vineland-3 : une note v de 21 à Internalisé est une difficulté', () => {
    expect(describeScore(index, 'vineland-3', 'vineland-3__internalizing', { value: '21', unit: 'NS' }).zone).toBe('deficit');
    expect(describeScore(index, 'vineland-3', 'vineland-3__receptive', { value: '21', unit: 'NS' }).zone).toBe('normal');
  });

  it('la moyenne du test combine les sous-tests dans le même sens', () => {
    const [vineland] = resolveScores(
      {
        'vineland-3': {
          'vineland-3__internalizing': { value: '21', unit: 'NS' },
          'vineland-3__receptive': { value: '9', unit: 'NS' },
        },
      },
      index,
    );
    expect(vineland.meanZ).toBeCloseTo(-2, 5);
  });
});

describe('échelles inversées : rapport, évolution, IA', () => {
  const tests = { spm: { spm__touch: { value: '72', unit: 'NS' as const } } };

  it('le graphique place la difficulté à gauche et signale l’inversion', () => {
    const chart = computeDotChart('z', tests, index);
    expect(chart.items[0].zone).toBe('deficit');
    expect(chart.items[0].position).toBeLessThan(0.25);
    expect(chart.items[0].label).toBe('Toucher (Touch) *');
    expect(chart.inverted).toBe(true);
    expect(readingGuide('z', chart.inverted).note).toMatch(/note élevée signale une difficulté/);
    expect(readingGuide('z').note).toBeNull();
    expect(computeDotChart('percentile', tests, index).items[0].position).toBeLessThan(0.05);
  });

  it('une note T qui baisse est un progrès', () => {
    const [entry] = buildDeltaEntries(tests, { spm: { spm__touch: { value: '58', unit: 'NS' } } }, index);
    expect(entry.delta).toBe(-14);
    expect(entry.trend).toBe('improved');
  });

  it('la charge IA donne le z orienté et le sens de lecture', () => {
    const [evidence] = buildScoresEvidence(tests, index);
    expect(evidence.zScore).toBe(-2.2);
    expect(evidence.percentile).toBe(1);
    expect(evidence.lecture).toMatch(/note élevée = difficulté/);
    const [usual] = buildScoresEvidence({ 'vineland-3': { 'vineland-3__receptive': { value: '9', unit: 'NS' } } }, index);
    expect(usual).not.toHaveProperty('lecture');
  });

  it('un patient fictif en difficulté reçoit une note T haute', () => {
    expect(fictiveScore(SPM_TOUCH, -2, 0)).toEqual({ value: '70', unit: 'NS' });
    expect(fictiveScore(SPM_TOUCH, 0.5, 0)).toEqual({ value: '45', unit: 'NS' });
  });
});
