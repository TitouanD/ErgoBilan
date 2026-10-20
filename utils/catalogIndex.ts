/**
 * catalogIndex.ts — O(1) lookups into the test catalogue.
 *
 * The catalogue is a tree (category → test → subtest). Screens used to rebuild
 * name maps or call `catalog.flatMap(c => c.tests).find(...)` inside render
 * loops; everything now goes through one memoized index built by
 * `CatalogContext` (`useCatalog().index`).
 */

import type { CategoryDef, ScoreType, SubtestDef, TestDef } from '../data/testCatalog';
import type { ScoreResult } from '../types';
import { resolveScaleType } from './scoring';

/** Pseudo-test holding free-text observations ("Observation libre"). Never in the catalogue. */
export const CUSTOM_OBSERVATIONS_TEST_ID = 'custom_observations';

export interface CatalogIndex {
  testById: Map<string, TestDef>;
  categoryByTestId: Map<string, CategoryDef>;
  /** Keyed by `${testId}:${subtestId}`. */
  subtestByKey: Map<string, SubtestDef>;
  /** Subtest ids are globally unique; used to regroup flat `results` of old assessments. */
  testIdBySubtestId: Map<string, string>;
}

export const EMPTY_CATALOG_INDEX: CatalogIndex = {
  testById: new Map(),
  categoryByTestId: new Map(),
  subtestByKey: new Map(),
  testIdBySubtestId: new Map(),
};

export const buildCatalogIndex = (catalog: CategoryDef[]): CatalogIndex => {
  const index: CatalogIndex = {
    testById: new Map(),
    categoryByTestId: new Map(),
    subtestByKey: new Map(),
    testIdBySubtestId: new Map(),
  };
  for (const category of catalog) {
    for (const test of category.tests) {
      index.testById.set(test.id, test);
      index.categoryByTestId.set(test.id, category);
      for (const subtest of test.subtests) {
        index.subtestByKey.set(`${test.id}:${subtest.id}`, subtest);
        index.testIdBySubtestId.set(subtest.id, test.id);
      }
    }
  }
  return index;
};

export const getSubtestDef = (index: CatalogIndex, testId: string, subtestId: string): SubtestDef | undefined =>
  index.subtestByKey.get(`${testId}:${subtestId}`);

/** Display name of a test, with sensible fallbacks for private/custom tests missing from the catalogue. */
export const getTestName = (index: CatalogIndex, testId: string): string => {
  const test = index.testById.get(testId);
  if (test) return test.name;
  if (testId === CUSTOM_OBSERVATIONS_TEST_ID) return 'Observation libre';
  return 'Test personnalisé';
};

/** Display name of a subtest; `customLabel` (free observations) wins, then catalogue, then a cleaned id. */
export const getSubtestName = (index: CatalogIndex, testId: string, subtestId: string, customLabel?: string): string => {
  if (customLabel?.trim()) return customLabel.trim();
  const def = getSubtestDef(index, testId, subtestId);
  if (def) return def.name;
  if (subtestId.startsWith('custom_')) return 'Observation libre';
  // Removed subtest: official ids are `<testId>__<slug>`, keep the readable slug.
  const slug = subtestId.startsWith(`${testId}__`) ? subtestId.slice(testId.length + 2) : subtestId;
  const name = slug
    .replace(/_[a-f0-9]{8}$/i, '')
    .replace(/[_-]+/g, ' ')
    .trim();
  return name.charAt(0).toUpperCase() + name.slice(1);
};

/** Scale type of a subtest ('none' when unknown — see `resolveScaleType`). */
export const getScaleType = (index: CatalogIndex, testId: string, subtestId: string): ScoreType =>
  resolveScaleType(getSubtestDef(index, testId, subtestId)?.scoreType);

/**
 * Definition used to render stored scores: the catalogue entry, completed with
 * fallback subtests for the ids it does not know (free observations, deleted
 * private tests or subtests), so no stored score is silently hidden. A stored
 * qualitative value keeps a qualitative fallback whose only option is that value.
 */
export const resolveTestDef = (index: CatalogIndex, testId: string, scores: Record<string, ScoreResult | undefined>): TestDef => {
  const known = index.testById.get(testId);
  const knownIds = new Set(known?.subtests.map((st) => st.id));
  const extra = Object.keys(scores)
    .filter((id) => !knownIds.has(id))
    .map((id): SubtestDef => {
      const base = { id, name: getSubtestName(index, testId, id), unit: '', scoreType: 'none' as const };
      if (id.startsWith('custom_') || testId === CUSTOM_OBSERVATIONS_TEST_ID) return { ...base, inputModel: 'custom_text' };
      const score = scores[id];
      if (score?.unit === 'qualitative' && score.value) {
        const option = { code: score.value, label: score.qualitativeLabel || score.value, order: 1 };
        return { ...base, inputModel: 'qualitative_category', inputConfig: { options: [option] } };
      }
      return { ...base, inputModel: 'numeric_4mode' };
    });
  if (known && extra.length === 0) return known;
  return { id: testId, name: known?.name ?? getTestName(index, testId), subtests: [...(known?.subtests ?? []), ...extra] };
};
