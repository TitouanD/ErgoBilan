/** Réévaluation, visual references of the four steps (scenario `reeval`, Lina). */

import { expect, test } from '../fixtures';

const STEPS = [
  [1, 'scores'],
  [2, 'evolution'],
  [3, 'validation'],
  [4, 'export'],
] as const;

test.describe('Réévaluation : écrans', { tag: ['@reeval', '@visuel'] }, () => {
  for (const [step, name] of STEPS) {
    test(`étape ${step} : ${name}`, async ({ app, page }) => {
      await app.open(`scenario=reeval&etape=${step}`);
      await expect(page).toHaveScreenshot(`${step}-${name}.png`, { fullPage: true });
    });
  }
});
