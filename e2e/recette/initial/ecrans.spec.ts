/**
 * Bilan initial, visual references of the five steps (scenario `initial`, Léo).
 * A difference is either accepted (`npm run recette:cible -- --grep @initial
 * --update-snapshots`) or a regression: docs/VERIFICATION.md § Recette.
 */

import { expect, test } from '../fixtures';

const STEPS = [
  [1, 'dossier'],
  [2, 'scores'],
  [3, 'diagnostic'],
  [4, 'validation'],
  [5, 'visualisation'],
] as const;

test.describe('Bilan initial : écrans', { tag: ['@initial', '@visuel'] }, () => {
  for (const [step, name] of STEPS) {
    test(`étape ${step} : ${name}`, async ({ app, page }) => {
      await app.open(`scenario=initial&etape=${step}`);
      await expect(page).toHaveScreenshot(`${step}-${name}.png`, { fullPage: true });
    });
  }
});
