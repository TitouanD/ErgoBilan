import { describe, expect, it } from 'vitest';
import { DEMO_CATALOG } from '../data/demoCatalog';
import { RETIRED_SUBTEST_NAMES } from '../data/retiredCatalog';
import { buildCatalogIndex, getScaleType, getSubtestName, getTestName, resolveTestDef } from './catalogIndex';

const index = buildCatalogIndex(DEMO_CATALOG);

describe('sous-tests retirés du catalogue officiel (#90)', () => {
  it('affiche une valeur dont le sous-test a disparu sous son ancien nom, sans échelle', () => {
    const def = resolveTestDef(index, 'jebsen-taylor', { 'jebsen-taylor__writing': { value: '42', unit: 'NS' } });
    expect(def.subtests).toEqual([
      expect.objectContaining({ id: 'jebsen-taylor__writing', name: 'Écriture (main non précisée)', scoreType: 'none' }),
    ]);
    expect(getScaleType(index, 'bot-2', 'bot-2__beads')).toBe('none');
  });

  it('garde les sous-tests connus du catalogue et ajoute le retiré à la suite', () => {
    const def = resolveTestDef(index, 'test-cloches', {
      'test-cloches__cibles': { value: '30', unit: 'NS' },
      'test-cloches__omissions-gauche': { value: '2', unit: 'NS' },
    });
    expect(def.name).toBe(index.testById.get('test-cloches')?.name);
    expect(def.subtests.at(-1)).toMatchObject({ id: 'test-cloches__omissions-gauche', name: 'Omissions hémichamp gauche' });
  });

  it('nomme un test officiel retiré au lieu de « Test personnalisé »', () => {
    expect(getTestName(index, 'ozeretzki')).toBe("Découpage d'Ozeretzki");
    expect(getSubtestName(index, 'ozeretzki', 'ozeretzki__decoupage-qualite')).toBe('Qualité de découpage');
    expect(getTestName(index, 'test-prive-inconnu')).toBe('Test personnalisé');
  });

  it('se rabat toujours sur un nom tiré de l’identifiant pour un sous-test inconnu', () => {
    expect(getSubtestName(index, 'x', 'x__autre-chose')).toBe('Autre chose');
    expect(getSubtestName(index, 'x', 'constructor')).toBe('Constructor');
  });

  it('ne nomme comme retiré aucun sous-test encore présent dans le catalogue de démo', () => {
    const ids = DEMO_CATALOG.flatMap((c) => c.tests.flatMap((t) => t.subtests.map((s) => s.id)));
    expect(ids.filter((id) => id in RETIRED_SUBTEST_NAMES)).toEqual([]);
  });
});
