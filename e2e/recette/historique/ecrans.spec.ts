/** Bilan historique, visual references of the three steps (scenario `historique`, Inès). */

import { expect, test } from '../fixtures';

const STEPS = [
  [1, 'dossier'],
  [2, 'scores'],
  [3, 'rapport'],
] as const;

test.describe('Bilan historique : écrans', { tag: ['@historique', '@visuel'] }, () => {
  for (const [step, name] of STEPS) {
    test(`étape ${step} : ${name}`, async ({ app, page }) => {
      await app.open(`scenario=historique&etape=${step}`);
      await expect(page).toHaveScreenshot(`${step}-${name}.png`, { fullPage: true });
    });
  }
});
