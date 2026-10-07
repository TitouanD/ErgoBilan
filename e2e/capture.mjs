/**
 * capture.mjs — screenshots of dev scenarios (dev/scenarios.ts), signed in with
 * the dedicated test account. See docs/VERIFICATION.md.
 *
 *   npm run capture -- "scenario=initial&etape=2" dashboard initial-scores
 *   npm run capture -- "scenario=reeval&etape=2" --tablette --plein --clic "text=Ajouter un test"
 *
 * Options: --tablette (1024×768, else 1440×900), --plein (whole page),
 * --clic <selector> (repeatable, clicked in order before the screenshot),
 * --pdf (after the screenshot, clicks « Télécharger PDF » and saves the PDF
 * next to it: the scenario must be on the export step),
 * --out <dir> (default .captures/<date>), --port <n> (default 3100).
 *
 * - Starts its own Vite on the current checkout (a worktree is captured as is).
 * - Session: a fresh one for every run (e2e/testSession.mjs, keys in
 *   `.env.e2e.local` of the main checkout, shared with `npm run e2e:ai`,
 *   docs/AI_PIPELINE.md §9), put in the browser; the PIN (`E2E_PIN`) is typed
 *   on the lock screen. Nothing is written back.
 * - The browser has its own profile, emptied on every run: the fictitious
 *   patients never reach the practitioner's browser.
 * - Microsoft Edge (installed with Windows) is driven by playwright-core: no
 *   browser download.
 */

import { execSync, spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { lockTestAccount, readTestAccount, sessionInitScript, supabaseConfig, typePin, unlockTestAccount } from './testAccount.mjs';
import { mintTestSession } from './testSession.mjs';

// ─── Arguments ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const targets = [];
const clicks = [];
const opts = { tablet: false, full: false, pdf: false, out: '', port: 3100 };
for (let i = 0; i < args.length; i += 1) {
  const a = args[i];
  if (a === '--tablette') opts.tablet = true;
  else if (a === '--plein') opts.full = true;
  else if (a === '--pdf') opts.pdf = true;
  else if (a === '--clic') clicks.push(args[(i += 1)]);
  else if (a === '--out') opts.out = args[(i += 1)];
  else if (a === '--port') opts.port = Number(args[(i += 1)]);
  else {
    const query = a.replace(/^[/?]+/, '');
    // A bare name is a scenario: `initial-scores` = `scenario=initial-scores`.
    targets.push(query.includes('=') ? query : `scenario=${query}`);
  }
}
if (targets.length === 0) {
  console.error(
    'Usage : npm run capture -- "scenario=initial&etape=2" [--tablette] [--plein] [--clic <sélecteur>] [--pdf] [--out <dossier>]',
  );
  process.exit(1);
}

// ─── Vite ───────────────────────────────────────────────────────────────────
const startVite = async (port) => {
  const viteBin = join(dirname(createRequire(import.meta.url).resolve('vite/package.json')), 'bin', 'vite.js');
  const child = spawn(process.execPath, [viteBin, '--port', String(port), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (d) => (output += d));
  child.stderr.on('data', (d) => (output += d));
  const base = `http://localhost:${port}`;
  for (let i = 0; i < 120; i += 1) {
    if (child.exitCode !== null) throw new Error(`Vite s'est arrêté :\n${output}`);
    try {
      if ((await fetch(base)).ok) return { base, stop: () => killTree(child) };
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  killTree(child);
  throw new Error(`Vite ne répond pas sur ${base} :\n${output}`);
};
const killTree = (child) => {
  if (child.exitCode !== null) return;
  if (process.platform === 'win32') execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: 'ignore' });
  else child.kill('SIGTERM');
};

// ─── Run ────────────────────────────────────────────────────────────────────
let account;
try {
  account = readTestAccount();
  lockTestAccount();
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}
const { pin } = account;

const outDir = resolve(opts.out || join('.captures', new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)));
mkdirSync(outDir, { recursive: true });

let vite;
let browser;
let page;
let failures = 0;
try {
  const { url, key } = supabaseConfig();
  const session = await mintTestSession({ url, publishableKey: key, secretKey: account.secretKey, email: account.email });

  vite = await startVite(opts.port);
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({
    acceptDownloads: true,
    viewport: opts.tablet ? { width: 1024, height: 768 } : { width: 1440, height: 900 },
    locale: 'fr-FR',
  });
  const init = sessionInitScript(session);
  await context.addInitScript(init.script, init.arg);
  page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && pageErrors.push(m.text()));

  for (const [n, target] of targets.entries()) {
    pageErrors.length = 0;
    const url = `${vite.base}/?${target}`;
    await page.goto(url);
    // Every page load starts locked: the PIN key only lives in memory.
    await typePin(page, pin);
    if (target.includes('scenario=')) {
      await page.waitForSelector('html[data-scenario="ready"], html[data-scenario="error"]', { timeout: 90_000 });
      const status = await page.evaluate(() => [document.documentElement.dataset.scenario, document.documentElement.dataset.scenarioError]);
      if (status[0] === 'error') {
        failures += 1;
        console.error(`✗ ${target} : ${status[1]}`);
      }
    } else {
      await page.waitForLoadState('networkidle');
    }
    for (const selector of clicks) {
      try {
        await page.click(selector, { timeout: 10_000 });
        await page.waitForTimeout(400);
      } catch {
        // Captured anyway: the screenshot shows why the element was not found.
        failures += 1;
        console.error(`✗ ${target} : clic impossible sur ${selector}`);
      }
    }
    await page.addStyleTag({ content: '[data-devtools]{display:none!important}' });
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(600);
    const name = `${String(n + 1).padStart(2, '0')}-${target.replace(/[^a-z0-9=-]+/gi, '_').replace(/scenario=/, '')}.png`;
    const file = join(outDir, name);
    await page.screenshot({ path: file, fullPage: opts.full });
    console.log(`✓ ${file}`);
    if (opts.pdf) {
      try {
        const [download] = await Promise.all([
          page.waitForEvent('download', { timeout: 60_000 }),
          page.click('button:has-text("Télécharger PDF")', { timeout: 10_000 }),
        ]);
        const pdfFile = file.replace(/\.png$/, '.pdf');
        await download.saveAs(pdfFile);
        console.log(`✓ ${pdfFile}`);
      } catch {
        failures += 1;
        console.error(`✗ ${target} : PDF non téléchargé (le scénario doit être sur l'étape d'export)`);
      }
    }
    if (pageErrors.length > 0) console.log(`  erreurs de la page :\n  - ${[...new Set(pageErrors)].join('\n  - ')}`);
  }
} catch (e) {
  failures += 1;
  console.error(e instanceof Error ? e.message : e);
} finally {
  await browser?.close();
  vite?.stop();
  unlockTestAccount();
}
process.exit(failures > 0 ? 1 : 0);
