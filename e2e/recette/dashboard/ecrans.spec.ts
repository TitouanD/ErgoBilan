/** Tableau de bord and patient record, visual references (scenario `dashboard`: one patient per status). */

import { expect, test } from '../fixtures';

test.describe('Tableau de bord : écrans', { tag: ['@dashboard', '@visuel'] }, () => {
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
