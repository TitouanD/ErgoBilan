import { describe, expect, it, vi } from 'vitest';
import { canGenerate, confirmGenerationCredits } from './generationCredits';

const profile = (credits: number, isAdmin = false) => ({ credits, isAdmin });

describe('crédits avant une génération (#112)', () => {
  it("l'admin génère sans crédit, les autres avec au moins un crédit", () => {
    expect(canGenerate(profile(0, true))).toBe(true);
    expect(canGenerate(profile(1))).toBe(true);
    expect(canGenerate(profile(0))).toBe(false);
  });

  it('avec des crédits en mémoire, ne relit pas le profil', async () => {
    const refresh = vi.fn();
    expect(await confirmGenerationCredits(profile(3), refresh)).toBe(true);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('solde en mémoire périmé (renouvellement, achat dans un autre onglet) : relit le profil avant le mur', async () => {
    const refresh = vi.fn().mockResolvedValue(profile(30));
    expect(await confirmGenerationCredits(profile(0), refresh)).toBe(true);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('sans crédit après relecture, ou si la relecture échoue : le mur', async () => {
    expect(await confirmGenerationCredits(profile(0), async () => profile(0))).toBe(false);
    expect(await confirmGenerationCredits(profile(0), async () => null)).toBe(false);
  });
});
