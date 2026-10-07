/**
 * run.mjs — `npm run recette`: the whole recette on the last commit of `dev`
 * pushed to GitHub, then the GitHub status `recette` on that commit (required
 * to merge into `main`). See docs/VERIFICATION.md § Recette.
 *
 *   npm run recette                     origin/dev, status posted
 *   npm run recette -- --sur <ref>      another commit (e.g. a branch), status posted on it
 *   npm run recette -- --sans-statut    no GitHub status
 *
 * - The commit is checked out in its own worktree, ../ErgoBilan-recette-run
 *   (detached, reset at every run): what is tested is exactly what is merged,
 *   never a working tree with local changes.
 * - Reports go to .recette/<date>-<sha>/ of the checkout that runs the command:
 *   rapport/ (Playwright HTML report: steps, screenshots, diffs, traces),
 *   resume.md (failures by parcours, for the weekly PR).
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { stripVTControlCharacters } from 'node:util';

const args = process.argv.slice(2);
const refArg = args.includes('--sur') ? args[args.indexOf('--sur') + 1] : 'origin/dev';
const postStatus = !args.includes('--sans-statut');

const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim();
const here = process.cwd();
const mainCheckout = dirname(git(here, 'rev-parse', '--path-format=absolute', '--git-common-dir'));
const runDir = resolve(mainCheckout, '..', 'ErgoBilan-recette-run');

// ─── Commit under test ──────────────────────────────────────────────────────
git(here, 'fetch', '--quiet', 'origin');
const sha = git(here, 'rev-parse', `${refArg}^{commit}`);
const short = sha.slice(0, 7);
const subject = git(here, 'log', '-1', '--format=%s', sha);
try {
  const localDev = git(here, 'rev-parse', 'dev');
  if (refArg === 'origin/dev' && localDev !== sha) {
    console.warn(`⚠ La branche locale dev (${localDev.slice(0, 7)}) diffère d'origin/dev (${short}) : la recette porte sur origin/dev.`);
  }
} catch {
  /* no local dev branch */
}
console.log(`Recette de ${short} « ${subject} »`);

const status = (state, description) => {
  if (!postStatus) return;
  execFileSync(
    'gh',
    [
      'api',
      '--silent',
      `repos/{owner}/{repo}/statuses/${sha}`,
      '-f',
      `state=${state}`,
      '-f',
      'context=recette',
      '-f',
      `description=${description.slice(0, 140)}`,
    ],
    { cwd: here, stdio: 'inherit' },
  );
};

// ─── Checkout ───────────────────────────────────────────────────────────────
if (!existsSync(runDir)) git(mainCheckout, 'worktree', 'add', '--detach', runDir, sha);
else {
  git(runDir, 'checkout', '--quiet', '--detach', '--force', sha);
  git(runDir, 'clean', '-fdq', '-e', 'node_modules', '-e', '.recette');
}
// npm ci only when the lock file changed since the last run.
const lock = readFileSync(join(runDir, 'package-lock.json'), 'utf8');
const lockStamp = join(runDir, 'node_modules', '.recette-lock');
if (!existsSync(lockStamp) || readFileSync(lockStamp, 'utf8') !== lock) {
  console.log('npm ci…');
  const ci = spawnSync('npm', ['ci', '--no-audit', '--no-fund'], { cwd: runDir, stdio: 'inherit', shell: true });
  if (ci.status !== 0) {
    status('error', 'npm ci en échec');
    process.exit(1);
  }
  writeFileSync(lockStamp, lock);
}

// ─── Run ────────────────────────────────────────────────────────────────────
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const out = resolve(here, '.recette', `${stamp}-${short}`);
mkdirSync(out, { recursive: true });
status('pending', 'Recette en cours');
const started = Date.now();
const run = spawnSync('node', ['--use-system-ca', 'node_modules/@playwright/test/cli.js', 'test'], {
  cwd: runDir,
  stdio: 'inherit',
  env: { ...process.env, RECETTE_OUT: out },
});
const minutes = ((Date.now() - started) / 60_000).toFixed(1);

// ─── Summary ────────────────────────────────────────────────────────────────
const resultsFile = join(out, 'resultats.json');
if (!existsSync(resultsFile)) {
  status('error', `La recette n'a pas pu tourner (code ${run.status})`);
  console.error(`Pas de résultats dans ${out}.`);
  process.exit(1);
}
const results = JSON.parse(readFileSync(resultsFile, 'utf8'));
const tests = [];
const walk = (suite, titles) => {
  for (const s of suite.suites ?? []) walk(s, [...titles, s.title]);
  for (const spec of suite.specs ?? []) {
    for (const t of spec.tests) {
      const last = t.results.at(-1);
      tests.push({
        file: spec.file,
        title: [...titles.slice(1), spec.title].filter(Boolean).join(' › '),
        tags: spec.tags,
        status: t.status, // expected | unexpected | flaky | skipped
        errors: (last?.errors ?? []).map((e) =>
          stripVTControlCharacters(e.message ?? '')
            .split('\n')
            .slice(0, 12)
            .join('\n'),
        ),
        attachments: (last?.attachments ?? []).filter((a) => a.path).map((a) => `${a.name} : ${a.path}`),
        problems: (last?.attachments ?? [])
          .filter((a) => a.name === 'problemes' && a.body)
          .map((a) => Buffer.from(a.body, 'base64').toString()),
      });
    }
  }
};
walk(results, []);
const failed = tests.filter((t) => t.status === 'unexpected');
const flaky = tests.filter((t) => t.status === 'flaky');
const passed = tests.filter((t) => t.status === 'expected');
const visualOnly = (t) => t.errors.length > 0 && t.errors.every((e) => e.includes('toHaveScreenshot'));

const lines = [
  `## Recette de \`${short}\` (${subject})`,
  '',
  `${passed.length} réussis, ${failed.length} en échec, ${flaky.length} instables, en ${minutes} min.`,
  `Rapport complet : \`${join(out, 'rapport', 'index.html')}\` (\`npx playwright show-report "${join(out, 'rapport')}"\`).`,
  '',
];
const byParcours = new Map();
for (const t of [...failed, ...flaky]) {
  const key = t.tags.find((tag) => tag !== '@visuel') ?? t.file;
  if (!byParcours.has(key)) byParcours.set(key, []);
  byParcours.get(key).push(t);
}
for (const [parcours, list] of byParcours) {
  lines.push(`### ${parcours}`, '');
  for (const t of list) {
    const kind = t.status === 'flaky' ? 'instable' : visualOnly(t) ? 'différence visuelle' : 'échec fonctionnel';
    lines.push(`- **${t.title}** (${kind}, \`${t.file}\`)`);
    for (const e of t.errors) lines.push('', '  ```', ...e.split('\n').map((l) => `  ${l}`), '  ```');
    for (const p of t.problems) lines.push('', ...p.split('\n').map((l) => `  - ${l}`));
    if (t.attachments.length > 0) lines.push('', ...t.attachments.map((a) => `  - ${a}`));
    lines.push('');
  }
}
const summary = lines.join('\n');
writeFileSync(join(out, 'resume.md'), summary);
console.log(`\n${summary}`);

const ok = failed.length === 0 && run.status === 0;
status(
  ok ? 'success' : 'failure',
  ok ? `${passed.length} tests réussis (${minutes} min)` : `${failed.length} en échec sur ${tests.length}`,
);
process.exit(ok ? 0 : 1);
