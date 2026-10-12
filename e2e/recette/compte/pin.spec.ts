/** Lock screen: wrong PIN, lockout after five attempts, lock again after 15 minutes idle. */

import { readTestAccount, typePin } from '../../testAccount.mjs';
import { expect, test } from '../fixtures';

const { pin } = readTestAccount();
const wrongPin = pin === '000000' ? '111111' : '000000';
const lockScreen = 'Entrez votre code PIN pour déverrouiller vos dossiers.';

test.describe('Code PIN', { tag: '@pin' }, () => {
  test('un code faux est refusé, le bon déverrouille', async ({ app, page }) => {
    await app.open('', { pin: false });
    await typePin(page, wrongPin);
    await expect(page.getByText('Code PIN incorrect (4 tentatives restantes)')).toBeVisible();
    await typePin(page, pin);
    await expect(page.getByRole('heading', { name: 'Patients suivis' })).toBeVisible();
  });

  test('cinq codes faux verrouillent le compte', async ({ app, page }) => {
    await app.open('', { pin: false });
    for (let attempt = 1; attempt <= 4; attempt++) {
      await typePin(page, wrongPin);
      await expect(page.getByText(`Code PIN incorrect (${5 - attempt} tentative`)).toBeVisible();
    }
    await typePin(page, wrongPin);
    await expect(page.getByText('Compte verrouillé')).toBeVisible();
    await expect(page.getByText('Trop de tentatives. Réessayez dans 0:30')).toBeVisible();
    await expect(page.locator('input[type="password"][inputmode="numeric"]')).toBeDisabled();
  });

  test('l’application se verrouille après 15 minutes sans activité', async ({ app, page }) => {
    await app.open();
    await expect(page.getByRole('heading', { name: 'Patients suivis' })).toBeVisible();
    await page.clock.fastForward('14:00');
    await expect(page.getByRole('heading', { name: 'Patients suivis' })).toBeVisible();
    await page.clock.fastForward('01:30');
    await expect(page.getByText(lockScreen)).toBeVisible();
    await typePin(page, pin);
    await expect(page.getByRole('heading', { name: 'Patients suivis' })).toBeVisible();
  });
});
