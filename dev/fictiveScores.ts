/**
 * fictiveScores.ts — scores of the fictitious patients, built from the catalogue
 * actually loaded (real or demo), so a scenario shows the real subtests.
 * Development only.
 *
 * Values follow a fixed pattern around the profile level, so that a scenario
 * always shows the same scores, spread over every zone (deficit, fragile,
 * normal), and are entered the way a practitioner would: NS for a parametric
 * scale, % for a percentile scale, alternately ET and % for an unscaled one.
 */

import type { SubtestDef } from '../data/testCatalog';
import type { ScoreResult, TestData } from '../types';
import { CUSTOM_OBSERVATIONS_TEST_ID, type CatalogIndex } from '../utils/catalogIndex';
import { SCALE_PARAMS, normalCDF, resolveScaleType } from '../utils/scoring';
import { compareSubtestsForDisplay } from '../utils/subtestOrdering';
import type { FictiveTest } from './fictivePatients';

/** 'zones': filled scores; 'vide': the tests are added but every score is empty. */
export type ScoreFill = 'zones' | 'vide';

/** Offsets added to the profile level, subtest after subtest. */
const Z_PATTERN = [0.4, -0.9, 1.2, -1.8, 0, -0.5, 0.9, -1.3];
/** Credible bounds of a z-score. */
const Z_MIN = -2.7;
const Z_MAX = 2;

export const FREE_OBSERVATION = {
  customLabel: 'Observation libre',
  observation: 'Bonne coopération, attention fluctuante en fin de séance. A demandé une pause au bout de 40 minutes.',
};

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

const percentileOf = (z: number) => String(clamp(Math.round(normalCDF(z) * 100), 1, 99));

/** The score of one subtest for a given z. */
export const fictiveScore = (def: SubtestDef, z: number, position: number): ScoreResult => {
  if (def.inputModel === 'qualitative_category') {
    const options = [...(def.inputConfig?.options ?? [])].sort((a, b) => a.order - b.order);
    const option = options[position % Math.max(options.length, 1)];
    return option ? { value: option.code, unit: 'qualitative', qualitativeLabel: option.label } : {};
  }
  if (def.inputModel === 'custom_text') return { ...FREE_OBSERVATION };

  const scale = resolveScaleType(def.scoreType);
  const params = SCALE_PARAMS[scale];
  if (params) {
    const value = clamp(Math.round(z * params.sd + params.mean), scale === 'scaled' ? 1 : 0, Math.round(params.mean + 3.5 * params.sd));
    return { value: String(value), unit: 'NS' };
  }
  if (scale === 'percentile' || position % 2 === 1) return { value: percentileOf(z), unit: '%' };
  return { value: z.toFixed(1), unit: 'ET' };
};

export interface FictiveTestsResult {
  tests: TestData;
  /** Tests or subtests of the profile absent from the loaded catalogue. */
  missing: string[];
}

/**
 * Scores of the given tests. `shift` moves every z (a re-evaluation shows
 * progress with a positive shift).
 */
export const buildFictiveTests = (
  index: CatalogIndex,
  wanted: FictiveTest[],
  options: { level: number; fill: ScoreFill; shift?: number },
): FictiveTestsResult => {
  const tests: TestData = {};
  const missing: string[] = [];
  let position = 0;

  for (const { testId, subtests } of wanted) {
    if (testId === CUSTOM_OBSERVATIONS_TEST_ID) {
      tests[testId] = {
        custom_fictif_1: options.fill === 'vide' ? { customLabel: FREE_OBSERVATION.customLabel } : { ...FREE_OBSERVATION },
      };
      continue;
    }
    const def = index.testById.get(testId);
    if (!def) {
      missing.push(testId);
      continue;
    }
    // Whole test: the catalogue display order, as the test picker shows it (the base returns rows unordered).
    const ids = subtests ?? [...def.subtests].sort(compareSubtestsForDisplay).map((s) => s.id);
    const scores: Record<string, ScoreResult> = {};
    for (const id of ids) {
      const subtest = def.subtests.find((s) => s.id === id);
      if (!subtest) {
        missing.push(`${testId}:${id}`);
        continue;
      }
      const z = clamp(options.level + Z_PATTERN[position % Z_PATTERN.length] + (options.shift ?? 0), Z_MIN, Z_MAX);
      scores[id] = options.fill === 'vide' ? {} : fictiveScore(subtest, z, position);
      position += 1;
    }
    if (Object.keys(scores).length > 0) tests[testId] = scores;
  }
  return { tests, missing };
};

/** Every test of the catalogue with all its subtests (`tests=tout`). */
export const allCatalogTests = (index: CatalogIndex): FictiveTest[] => [...index.testById.keys()].map((testId) => ({ testId }));

/** Parse `tests=bhk,mabc-2` (or `tout`) into the tests to fill. */
export const parseTestsParam = (value: string | null, index: CatalogIndex): FictiveTest[] | null => {
  if (!value) return null;
  if (value.trim() === 'tout') return allCatalogTests(index);
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((testId) => ({ testId }));
};
