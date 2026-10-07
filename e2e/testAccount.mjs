/**
 * testAccount.mjs — the dedicated test account, shared by `npm run capture`
 * (capture.mjs) and the recette (e2e/recette/). See docs/VERIFICATION.md.
 *
 * - Keys and PIN come from `.env.e2e.local` of the main checkout (never
 *   committed), also read by `npm run e2e:ai` (liveEdge.ts).
 * - One run at a time: the lock file `.env.e2e.local.lock` is shared with e2e:ai.
 * - In the browser, the session is put in localStorage before the first load and
 *   the PIN is typed on the lock screen: every page load starts locked.
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export const AUTH_KEY = 'ergobilan.auth';

const mainCheckout = () => {
  try {
    return dirname(execSync('git rev-parse --path-format=absolute --git-common-dir', { encoding: 'utf8' }).trim());
  } catch {
    return process.cwd();
  }
};
export const ENV_FILE = resolve(mainCheckout(), '.env.e2e.local');
const LOCK_FILE = `${ENV_FILE}.lock`;

/** E2E_SECRET, E2E_EMAIL and E2E_PIN of `.env.e2e.local`; throws when one is missing. */
export const readTestAccount = () => {
  const values = new Map();
  if (existsSync(ENV_FILE)) {
    for (const line of readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m) values.set(m[1], m[2].replace(/^["']|["']$/g, ''));
    }
  }
  const account = { secretKey: values.get('E2E_SECRET'), email: values.get('E2E_EMAIL'), pin: values.get('E2E_PIN') };
  if (!account.secretKey || !account.email || !account.pin) {
    throw new Error(`E2E_SECRET, E2E_EMAIL et E2E_PIN requis dans ${ENV_FILE} (docs/VERIFICATION.md).`);
  }
  return account;
};

/** Dev Supabase project of services/db.ts (the app uses the same in `npm run dev`). */
export const supabaseConfig = (root = process.cwd()) => {
  const source = readFileSync(resolve(root, 'services/db.ts'), 'utf8');
  const url = process.env.VITE_SUPABASE_URL || source.match(/DEV_SUPABASE_URL = '([^']+)'/)?.[1];
  const key = process.env.VITE_SUPABASE_ANON_KEY || source.match(/DEV_SUPABASE_PUBLISHABLE_KEY = '([^']+)'/)?.[1];
  if (!url || !key) throw new Error('Configuration Supabase introuvable dans services/db.ts');
  return { url, key };
};

/** Takes the lock of the test account; throws when another run holds it. */
export const lockTestAccount = () => {
  try {
    writeFileSync(LOCK_FILE, String(process.pid), { flag: 'wx' });
  } catch {
    throw new Error(
      `Une autre exécution utilise le compte de test (${LOCK_FILE}). Sinon, supprimer ce fichier resté après un arrêt brutal.`,
    );
  }
};
export const unlockTestAccount = () => rmSync(LOCK_FILE, { force: true });

/**
 * Init script of a browser context: the session on the first load only (later
 * loads keep the session the app has refreshed since), no backup reminder.
 * @param {import('@supabase/supabase-js').Session} session
 */
export const sessionInitScript = (session) => ({
  script: ({ key, value }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, value);
    sessionStorage.setItem('ergo_backup_reminder_shown', '1');
  },
  arg: { key: AUTH_KEY, value: JSON.stringify(session) },
});

/**
 * Types the PIN on the lock screen.
 * @param {import('playwright-core').Page} page
 * @param {string} pin
 */
export const typePin = async (page, pin) => {
  const pinInput = page.locator('input[type="password"][inputmode="numeric"]');
  await pinInput.waitFor({ timeout: 60_000 });
  await pinInput.focus();
  await page.keyboard.type(pin);
};
