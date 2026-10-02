/**
 * liveEdge.ts — what the live end-to-end run needs to call the production edge
 * function `generate` from Node, without a manual login:
 *
 * - a fresh session of the dedicated test account for every run
 *   (e2e/testSession.mjs; keys in `.env.e2e.local` of the main checkout, never
 *   committed, shared by every worktree). A lock file keeps two live runs from
 *   spending credits at the same time;
 * - a `fetch` wrapper that counts the HTTP requests sent to `generate` and
 *   refuses any beyond the cap (retries of `services/aiProxy.ts` included), sets
 *   the Origin the edge expects, and keeps each raw answer for the trace.
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Session } from '@supabase/supabase-js';
import { mintTestSession } from './testSession.mjs';

/** Root of the main checkout (the parent of the shared `.git`), from any worktree. */
const mainCheckout = (): string => {
  try {
    const gitDir = execSync('git rev-parse --path-format=absolute --git-common-dir', { encoding: 'utf8' }).trim();
    return dirname(gitDir);
  } catch {
    return process.cwd();
  }
};

export const ENV_FILE = resolve(mainCheckout(), '.env.e2e.local');
const LOCK_FILE = `${ENV_FILE}.lock`;
/** Allowed by the edge (AI_ALLOWED_ORIGINS) but served by no site: marks the e2e runs in Sentry. */
const DEFAULT_ORIGIN = 'https://test.ergobilan.com';

const readEnvFile = (): Map<string, string> => {
  const values = new Map<string, string>();
  if (!existsSync(ENV_FILE)) return values;
  for (const line of readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match) values.set(match[1], match[2].replace(/^["']|["']$/g, ''));
  }
  return values;
};

export interface EdgeExchange {
  status: number;
  body: string;
}

/**
 * Wrap the global fetch for the run. Returns the raw exchanges with `generate`,
 * in order, and a restore function.
 */
export const installEdgeFetch = (maxEdgeCalls: number) => {
  const origin = readEnvFile().get('E2E_ORIGIN') || DEFAULT_ORIGIN;
  const realFetch = globalThis.fetch;
  const exchanges: EdgeExchange[] = [];

  globalThis.fetch = async (...[input, init]: Parameters<typeof fetch>) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.includes('/functions/v1/generate')) return realFetch(input, init);
    if (exchanges.length >= maxEdgeCalls) {
      throw new Error(`E2E_CAP_REACHED: ${maxEdgeCalls} appel(s) à generate au plus pour cette exécution`);
    }
    const headers = new Headers(init?.headers);
    headers.set('Origin', origin);
    const exchange: EdgeExchange = { status: 0, body: '' };
    exchanges.push(exchange);
    const response = await realFetch(input, { ...init, headers });
    exchange.status = response.status;
    exchange.body = await response.clone().text();
    return response;
  };

  return { exchanges, restore: () => (globalThis.fetch = realFetch) };
};

/**
 * Restore the test account session in the app's Supabase client
 * (`services/db.ts`), so the real transport `callAIProxyTask` works unchanged.
 */
export const signInTestAccount = async () => {
  const env = readEnvFile();
  if (!env.get('E2E_SECRET') || !env.get('E2E_EMAIL')) {
    throw new Error(`E2E_SECRET et E2E_EMAIL absents de ${ENV_FILE} : voir docs/AI_PIPELINE.md §9 (compte de test).`);
  }
  try {
    writeFileSync(LOCK_FILE, String(process.pid), { flag: 'wx' });
  } catch {
    throw new Error(`Une autre exécution réelle tourne (${LOCK_FILE}). Sinon, supprimer ce fichier resté après un arrêt brutal.`);
  }
  const unlock = () => rmSync(LOCK_FILE, { force: true });
  const { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } = await import('../services/db');
  let session: Session;
  try {
    const minted = await mintTestSession({
      url: SUPABASE_URL,
      publishableKey: SUPABASE_ANON_KEY,
      secretKey: env.get('E2E_SECRET'),
      email: env.get('E2E_EMAIL'),
    });
    const result = await supabase.auth.setSession({ access_token: minted.access_token, refresh_token: minted.refresh_token });
    if (result.error || !result.data.session) throw new Error(result.error?.message ?? 'pas de session');
    session = result.data.session;
  } catch (e) {
    unlock();
    throw e;
  }

  const readAccount = async () => {
    const { data: row, error: readError } = await supabase
      .from('practitioners')
      .select('credits, ai_style_preferences, is_admin')
      .eq('id', session.user.id)
      .single();
    if (readError || !row) throw new Error(`Lecture du compte de test impossible (${readError?.message})`);
    return row;
  };

  return {
    email: session.user.email ?? '',
    readAccount,
    close: async () => {
      await supabase.auth.stopAutoRefresh();
      unlock();
    },
  };
};
