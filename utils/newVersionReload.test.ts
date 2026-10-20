import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isChunkLoadError, reloadForNewVersion, resetNewVersionReload } from './newVersionReload';

const memoryStorage = () => {
  const values = new Map<string, string>();
  return { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => void values.set(k, v) };
};

describe('rechargement après une mise à jour (#124)', () => {
  beforeEach(() => resetNewVersionReload());

  it('reconnaît un module de l’ancienne version introuvable, quel que soit le navigateur', () => {
    expect(
      isChunkLoadError(
        new TypeError('Failed to fetch dynamically imported module: https://dev.ergobilan.com/assets/ExportPage-CXEWCkKs.js'),
      ),
    ).toBe(true);
    expect(isChunkLoadError(new TypeError('error loading dynamically imported module'))).toBe(true);
    expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true);
    expect(isChunkLoadError(new Error('Cannot read properties of undefined'))).toBe(false);
  });

  it('recharge une fois, puis laisse l’écran d’erreur si le module manque encore juste après', () => {
    const storage = memoryStorage();
    const reload = vi.fn();
    expect(reloadForNewVersion({ storage, reload, now: 1_000_000 })).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);

    // New page (after the reload), the chunk still fails 5 s later: no loop.
    resetNewVersionReload();
    expect(reloadForNewVersion({ storage, reload, now: 1_005_000 })).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);

    // A later deployment, much later: reloads again.
    expect(reloadForNewVersion({ storage, reload, now: 2_000_000 })).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('ne recharge qu’une fois par page, même signalé deux fois (Vite puis l’écran d’erreur)', () => {
    const storage = memoryStorage();
    const reload = vi.fn();
    expect(reloadForNewVersion({ storage, reload, now: 1_000_000 })).toBe(true);
    expect(reloadForNewVersion({ storage, reload, now: 1_000_100 })).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
