import { describe, expect, it } from 'vitest';
import { isEmailAllowed, parseAccessList } from './testAccess';

describe('accès à la version de test', () => {
  it('lit une liste séparée par des virgules, espaces ou points-virgules, sans casse', () => {
    expect(parseAccessList(' A@x.fr, b@Y.fr ;c@z.fr\n')).toEqual(['a@x.fr', 'b@y.fr', 'c@z.fr']);
    expect(parseAccessList(undefined)).toEqual([]);
    expect(parseAccessList('  ')).toEqual([]);
  });

  it('liste vide : tout le monde passe (production, local)', () => {
    expect(isEmailAllowed('qui@que.fr', [])).toBe(true);
    expect(isEmailAllowed(null, [])).toBe(true);
  });

  it('liste renseignée : seuls les comptes listés passent, sans tenir compte de la casse', () => {
    const list = parseAccessList('titouan@x.fr,testeuse@y.fr');
    expect(isEmailAllowed('Titouan@X.fr ', list)).toBe(true);
    expect(isEmailAllowed('autre@x.fr', list)).toBe(false);
    expect(isEmailAllowed('', list)).toBe(false);
    expect(isEmailAllowed(null, list)).toBe(false);
  });
});
