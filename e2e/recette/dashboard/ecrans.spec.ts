/** Tableau de bord and patient record, visual references (scenario `dashboard`: one patient per status). */

import { expect, test } from '../fixtures';

test.describe('Tableau de bord : écrans', { tag: ['@dashboard', '@visuel'] }, () => {
  // The banner above the dashboard follows the test account's plan (trial days, credits left):
  // a fixed active plan keeps the reference stable.
  test.beforeEach(async ({ app }) => {
    await app.mock(/\/rest\/v1\/subscriptions\b/, (route) =>
      route.fulfill({
        json: { plan_id: 'solo', status: 'active', trial_ends_at: null, current_period_end: null, billing_source: 'offerte' },
      }),
    );
  });

  test('un patient par statut', async ({ app, page }) => {
    await app.open('scenario=dashboard');
    await expect(page).toHaveScreenshot('dashboard.png', { fullPage: true });
  });

  test('fiche patient avec un bilan et son rappel', async ({ app, page }) => {
    await app.open('scenario=dashboard');
    await page.getByRole('heading', { name: 'Léo FICTIF' }).click();
    await expect(page.getByRole('heading', { name: 'Historique des bilans' })).toBeVisible();
    await expect(page).toHaveScreenshot('fiche-patient.png', { fullPage: true });
  });
});
