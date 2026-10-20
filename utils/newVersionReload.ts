/**
 * newVersionReload.ts — after a deployment, an open tab still asks for the
 * chunks of the previous build, which no longer exist (#124). Instead of the
 * error screen, the page reloads once to pick up the new version.
 *
 * Guarded by a timestamp in sessionStorage: a chunk still missing right after
 * the reload (real network failure) shows the error screen, no reload loop.
 */

const STORAGE_KEY = 'ergobilan:new-version-reload';
/** A second chunk error within this delay after a reload is not a new version. */
const RETRY_WINDOW_MS = 30_000;
/** This page already asked for a reload (Vite event, then the error boundary for the same chunk). */
let reloadIssued = false;

/** Chrome/Edge, Firefox, Safari messages for a dynamic import that failed, and Vite's CSS preload. */
const CHUNK_ERROR =
  /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS/i;

export const isChunkLoadError = (error: unknown): boolean =>
  error instanceof Error ? CHUNK_ERROR.test(error.message) : typeof error === 'string' && CHUNK_ERROR.test(error);

interface ReloadDeps {
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
  reload?: () => void;
  now?: number;
}

/** Reloads the page unless it was already reloaded for this reason a moment ago. Returns whether it reloads. */
export const reloadForNewVersion = ({
  storage = window.sessionStorage,
  reload = () => window.location.reload(),
  now = Date.now(),
}: ReloadDeps = {}): boolean => {
  if (reloadIssued) return true;
  const last = Number(storage.getItem(STORAGE_KEY) ?? 0);
  if (now - last < RETRY_WINDOW_MS) return false;
  storage.setItem(STORAGE_KEY, String(now));
  reloadIssued = true;
  reload();
  return true;
};

/** Tests only: forget the reload asked by this page. */
export const resetNewVersionReload = () => {
  reloadIssued = false;
};

/** Vite emits `vite:preloadError` when a lazy chunk (or its CSS) fails to load, also outside React (e.g. the PDF export). */
export const installNewVersionReload = () => {
  window.addEventListener('vite:preloadError', () => {
    reloadForNewVersion();
  });
};
