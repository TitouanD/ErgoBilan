/**
 * fixtures.ts — what every recette test gets (docs/VERIFICATION.md § Recette).
 *
 * - The session of the test account opened by globalSetup, put in the browser; `app.open`
 *   loads a URL, types the PIN and waits for the scenario, if any.
 * - Supabase is read for real (auth, PIN, catalogue). Any other write is blocked
 *   and fails the test: the recette never writes to the production database.
 *   A test that needs a write simulates it with `app.mock`.
 * - The edge function `generate` answers with the demo report (data/demoReport.ts):
 *   no AI call, no credit. Each request is kept in `app.aiRequests`, to check
 *   what would have been sent.
 * - A page exception, an error in the console or a failed request fails the test.
 * - The page's clock starts at RECETTE_DATE, then runs: dates and ages shown
 *   (report date, « 8 ans 6 mois ») do not change from one day to the next.
 */

import { readFileSync } from 'node:fs';
import { test as base, expect, type Page, type Route } from '@playwright/test';
import type { Session } from '@supabase/supabase-js';
import { createDemoTransport } from '../../data/demoReport';
import { readTestAccount, sessionInitScript, supabaseConfig, typePin } from '../testAccount.mjs';
import { SESSION_FILE } from './globalSetup';

/**
 * POSTs that change nothing for the test account: token refresh, logout, RPCs that
 * only read, and the organisation bootstrap of every unlock (idempotent: the
 * account already has its organisation).
 */
const ALLOWED_WRITES = [
  /\/auth\/v1\/token\b/,
  /\/auth\/v1\/logout\b/,
  /\/rest\/v1\/rpc\/admin_check\b/,
  /\/rest\/v1\/rpc\/bootstrap_org_for_user\b/,
];

/** Console errors that say nothing about the app; failed loads are reported with their URL instead. */
const IGNORED_CONSOLE = [/Download the React DevTools/, /^Failed to load resource/];
/** Scripts only served on Vercel (analytics, speed insights). */
const IGNORED_FAILED_URLS = [/\/_vercel\//, /favicon\.ico/];

export interface AIRequestSeen {
  task: string;
  payload: unknown;
}

export interface App {
  /** Loads `/?<query>`, types the PIN and, for a scenario, waits until it is ready. */
  open: (query?: string) => Promise<void>;
  /** Answers a Supabase request the app writes (portal, branding…) instead of the database. */
  mock: (url: RegExp, answer: (route: Route) => Promise<void>) => Promise<void>;
  aiRequests: AIRequestSeen[];
  /** Console errors expected by the test (e.g. a validation it provokes). */
  expectConsoleError: (pattern: RegExp) => void;
}

/** Before the session is opened (its expiry is checked against this clock), never after. */
export const RECETTE_DATE = new Date('2026-10-01T09:00:00+02:00');

const { url: SUPABASE_URL } = supabaseConfig();
const demoAnswer = createDemoTransport(0);

export const test = base.extend<{ app: App }, { session: Session }>({
  session: [
    async ({}, use) => {
      await use(JSON.parse(readFileSync(SESSION_FILE, 'utf8')) as Session);
    },
    { scope: 'worker' },
  ],

  app: async ({ page, session }, use, testInfo) => {
    const { pin } = readTestAccount();
    const init = sessionInitScript(session);
    await page.context().addInitScript(init.script, init.arg);
    await page.clock.install({ time: RECETTE_DATE });

    const problems: string[] = [];
    const expectedConsole: RegExp[] = [];
    // Whole console and navigations, attached when the test fails.
    const journal: string[] = [];
    page.on('framenavigated', (f) => f === page.mainFrame() && journal.push(`[navigation] ${f.url()}`));
    page.on('pageerror', (e) => problems.push(`Exception dans la page : ${e.message}`));
    page.on('response', (r) => {
      if (r.status() >= 400 && !IGNORED_FAILED_URLS.some((p) => p.test(r.url()))) {
        problems.push(`Réponse ${r.status()} : ${r.request().method()} ${r.url().replace(SUPABASE_URL, '<supabase>')}`);
      }
    });
    page.on('console', (m) => {
      journal.push(`[${m.type()}] ${m.text()}`);
      if (m.type() !== 'error') return;
      const text = m.text();
      if ([...IGNORED_CONSOLE, ...expectedConsole].some((p) => p.test(text))) return;
      problems.push(`Erreur console : ${text}`);
    });

    const aiRequests: AIRequestSeen[] = [];
    const mocks: Array<{ url: RegExp; answer: (route: Route) => Promise<void> }> = [];

    await page.route(`${SUPABASE_URL}/**`, async (route) => {
      const request = route.request();
      const target = request.url();
      const mock = mocks.find((m) => m.url.test(target));
      if (mock) return mock.answer(route);
      if (target.includes('/functions/v1/generate')) {
        const body = request.postDataJSON() as { task: AIRequestSeen['task']; payload: unknown };
        aiRequests.push({ task: body.task, payload: body.payload });
        const answer = await demoAnswer({ task: body.task as never, payload: body.payload as never });
        return route.fulfill({ json: { text: answer.text, generationId: 'recette' } });
      }
      const method = request.method();
      if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS' || ALLOWED_WRITES.some((p) => p.test(target))) {
        return route.continue();
      }
      problems.push(`Écriture vers Supabase bloquée : ${method} ${target.replace(SUPABASE_URL, '')}`);
      return route.fulfill({ status: 403, json: { message: 'Bloqué par la recette (aucune écriture en production)' } });
    });

    const app: App = {
      aiRequests,
      expectConsoleError: (pattern) => expectedConsole.push(pattern),
      mock: async (url, answer) => {
        mocks.push({ url, answer });
      },
      open: async (query = '') => {
        await page.goto(query ? `/?${query}` : '/');
        await typePin(page, pin);
        if (!query.includes('scenario=')) return;
        const html = page.locator('html');
        await expect(html).toHaveAttribute('data-scenario', /ready|error/, { timeout: 90_000 });
        const error = await html.getAttribute('data-scenario-error');
        expect(error, `Scénario ${query} en échec`).toBeNull();
        // The dev button is not part of the screen.
        await page.addStyleTag({ content: '[data-devtools]{display:none!important}' });
      },
    };

    await use(app);

    if (testInfo.status !== testInfo.expectedStatus || problems.length > 0) {
      await testInfo.attach('console', { body: journal.join('\n'), contentType: 'text/plain' });
    }
    if (problems.length > 0) {
      await testInfo.attach('problemes', { body: problems.join('\n'), contentType: 'text/plain' });
    }
    expect([...new Set(problems)], 'Erreurs de la page ou écritures vers Supabase').toEqual([]);
  },
});

export { expect };
export type { Page };
