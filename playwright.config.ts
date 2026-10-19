/**
 * Recette (docs/VERIFICATION.md § Recette): interface tests, functional and
 * visual, driven in Microsoft Edge with the dedicated test account.
 *
 * - `npm run recette` runs everything on a clean checkout of `dev` and posts
 *   the GitHub status `recette` (e2e/recette/run.mjs).
 * - `npm run recette:cible -- --grep @initial` runs part of it on the current
 *   checkout (vérification ciblée).
 *
 * Both test the production build, with the dev scenarios kept by
 * `VITE_SCENARIOS=1`. Not the Vite dev server: with several browsers at once, it
 * takes tens of seconds per module and the scenarios time out.
 */

import { defineConfig } from '@playwright/test';
import { supabaseConfig } from './e2e/testAccount.mjs';

const PORT = 3200;
const OUT = process.env.RECETTE_OUT || '.recette/derniere';
const { url, key } = supabaseConfig();

export default defineConfig({
  testDir: 'e2e/recette',
  testMatch: '**/*.spec.ts',
  outputDir: `${OUT}/resultats`,
  snapshotPathTemplate: 'e2e/recette/references/{testFilePath}/{arg}{ext}',
  globalSetup: './e2e/recette/globalSetup.ts',
  fullyParallel: true,
  workers: 4,
  retries: 0,
  timeout: 120_000,
  expect: {
    timeout: 15_000,
    // A changed word is a few hundred pixels: a relative tolerance on a whole page
    // (0.2 % ≈ 5,000 px) let it through. Anti-aliasing is absorbed per pixel (threshold).
    toHaveScreenshot: { maxDiffPixels: 30, animations: 'disabled', caret: 'hide' },
  },
  reporter: [['list'], ['html', { outputFolder: `${OUT}/rapport`, open: 'never' }], ['json', { outputFile: `${OUT}/resultats.json` }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    channel: 'msedge',
    headless: true,
    viewport: { width: 1440, height: 900 },
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    acceptDownloads: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: `npx vite build --outDir .recette/dist --emptyOutDir && npx vite preview --outDir .recette/dist --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 300_000,
    env: { VITE_SCENARIOS: '1', VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: key },
  },
});
