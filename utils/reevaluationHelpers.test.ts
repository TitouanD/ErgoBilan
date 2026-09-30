import { describe, expect, it } from 'vitest';
import type { TestData } from '../types';
import { canRemoveReevaluationSubtest, reevaluationSubtestIds, removeReevaluationSubtest } from './reevaluationHelpers';

const previous: TestData = { bhk: { bhk__quality: { value: '-1.2', unit: 'ET' }, bhk__speed: {} } };
const fresh: TestData = { bhk: { bhk__quality: {}, bhk__speed: {} } };

describe('réévaluation : retrait d’un sous-test ajouté par erreur (#48)', () => {
  it('seul un sous-test sans score précédent est retirable', () => {
    expect(canRemoveReevaluationSubtest(previous.bhk, 'bhk__quality')).toBe(false);
    expect(canRemoveReevaluationSubtest(previous.bhk, 'bhk__speed')).toBe(true);
  });

  it('le retrait l’enlève des deux côtés, les listes restent identiques', () => {
    expect(reevaluationSubtestIds(previous.bhk, fresh.bhk)).toEqual(['bhk__quality', 'bhk__speed']);
    const after = removeReevaluationSubtest(fresh, previous, 'bhk', 'bhk__speed');
    expect(after.bhk).toEqual({ bhk__quality: {} });
    expect(reevaluationSubtestIds(previous.bhk, after.bhk)).toEqual(['bhk__quality']);
  });

  it('un sous-test avec score précédent reste, même absent des nouveaux scores', () => {
    expect(removeReevaluationSubtest(fresh, previous, 'bhk', 'bhk__quality')).toBe(fresh);
    expect(reevaluationSubtestIds(previous.bhk, {})).toEqual(['bhk__quality']);
  });
});

describe('réévaluation : sous-test ajouté depuis le catalogue (#62)', () => {
  it('un sous-test absent de la référence s’affiche après ceux de la référence, et se retire', () => {
    const withAdded: TestData = { bhk: { bhk__quality: {}, bhk__speed: {}, bhk__extra: {} } };
    expect(reevaluationSubtestIds(previous.bhk, withAdded.bhk)).toEqual(['bhk__quality', 'bhk__speed', 'bhk__extra']);
    expect(removeReevaluationSubtest(withAdded, previous, 'bhk', 'bhk__extra').bhk).toEqual({ bhk__quality: {}, bhk__speed: {} });
  });

  it('un test entier absent de la référence : tous ses sous-tests, retirables', () => {
    expect(reevaluationSubtestIds(undefined, { a: {}, b: {} })).toEqual(['a', 'b']);
    expect(canRemoveReevaluationSubtest(undefined, 'a')).toBe(true);
  });
});
