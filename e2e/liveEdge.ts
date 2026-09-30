/**
 * liveEdge.ts — what the live end-to-end run needs to call the production edge
 * function `generate` from Node, without a manual login:
 *
 * - the session of the dedicated test account, restored from its refresh token
 *   (`.env.e2e.local`, never committed). Refreshing skips Turnstile, which only
 *   guards the password sign-in. Supabase rotates the token on every refresh, so
 *   the new one is written back at once;
 * - a `fetch` wrapper that counts the HTTP requests sent to `generate` and
 *   refuses any beyond the cap (retries of `services/aiProxy.ts` included), sets
 *   the Origin the edge expects, and keeps each raw answer for the trace.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const ENV_FILE = resolve(process.cwd(), '.env.e2e.local');
const DEFAULT_ORIGIN = 'https://dev.ergobilan.com';

const readEnvFile = (): Map<string, string> => {
  const values = new Map<string, string>();
  if (!existsSync(ENV_FILE)) return values;
  for (const line of readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match) values.set(match[1], match[2].replace(/^["']|["']$/g, ''));
  }
  return values;
};

const writeRefreshToken = (token: string) => {
  const lines = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, 'utf8').split(/\r?\n/) : [];
  const kept = lines.filter((line) => line.trim() && !/^\s*E2E_REFRESH_TOKEN\s*=/.test(line));
  writeFileSync(ENV_FILE, [...kept, `E2E_REFRESH_TOKEN=${token}`, ''].join('\n'), 'utf8');
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
  const refreshToken = readEnvFile().get('E2E_REFRESH_TOKEN');
  if (!refreshToken) {
    throw new Error(`E2E_REFRESH_TOKEN absent de ${ENV_FILE} : voir docs/AI_PIPELINE.md §9 (connexion du compte de test).`);
  }
  const { supabase } = await import('../services/db');
  const { data, error } = await supabase.auth.refreshSession({ refresh_token: refreshToken });
  if (error || !data.session) {
    throw new Error(`Session du compte de test non restaurée (${error?.message ?? 'pas de session'}) : refaire la connexion, §9.`);
  }
  writeRefreshToken(data.session.refresh_token);
  const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
    if (session?.refresh_token) writeRefreshToken(session.refresh_token);
  });

  const readAccount = async () => {
    const { data: row, error: readError } = await supabase
      .from('practitioners')
      .select('credits, ai_style_preferences, is_admin')
      .eq('id', data.session!.user.id)
      .single();
    if (readError || !row) throw new Error(`Lecture du compte de test impossible (${readError?.message})`);
    return row;
  };

  return {
    email: data.session.user.email ?? '',
    readAccount,
    close: async () => {
      listener.subscription.unsubscribe();
      await supabase.auth.stopAutoRefresh();
    },
  };
};
