import { describe, expect, it } from 'vitest';
import { DEMO_CATALOG } from '../data/demoCatalog';

/** Subtests found invented by the check against the published protocols (docs/catalogue/verification-2026-09-30.md, #50). */
const INVENTED = [
  'test-cloches__omissions-gauche',
  'test-cloches__omissions-droite',
  'nepsy-2__discrimination-digitale',
  'nepsy-2__precision-motrice',
  'alouette__indice-d-efficience-ctl',
  'tihm__shift',
  'tihm__rotation',
];

const subtests = () => DEMO_CATALOG.flatMap((c) => c.tests.flatMap((t) => t.subtests));

describe('catalogue de démo', () => {
  it('ne contient aucun sous-test inventé (#50)', () => {
    const ids = subtests().map((s) => s.id);
    expect(ids.filter((id) => INVENTED.includes(id))).toEqual([]);
  });

  it('note la note totale MABC-2 en NS (m=10, σ=3), comme la base (#50)', () => {
    expect(subtests().find((s) => s.id === 'mabc-2__total-score')?.scoreType).toBe('scaled');
  });

  it('laisse la BHK sans échelle : ses résultats sont des écarts-types, pas une note m=100 (#90)', () => {
    expect(
      subtests()
        .filter((s) => s.id.startsWith('bhk__'))
        .map((s) => s.scoreType),
    ).toEqual(['none', 'none']);
  });
});
