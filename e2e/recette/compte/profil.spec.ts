/**
 * Profile, report design and subscription. The writes to `practitioners` (profile,
 * branding, writing preferences) are simulated and checked: the account is not changed.
 */

import { expect, test, type App } from '../fixtures';

/** Answers the PATCH to `practitioners` and keeps their bodies; the reads go to Supabase. */
const capturePractitionerWrites = async (app: App) => {
  const writes: Array<Record<string, unknown>> = [];
  await app.mock(/\/rest\/v1\/practitioners\b/, async (route) => {
    if (route.request().method() !== 'PATCH') return route.continue();
    writes.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({ status: 204 });
  });
  return writes;
};

/** 1×1 transparent PNG. */
const LOGO = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

test.describe('Profil et image de marque', { tag: '@profil' }, () => {
  test('modifier le profil du cabinet', async ({ app, page }) => {
    const writes = await capturePractitionerWrites(app);
    await app.open();
    await page.getByRole('button', { name: 'Menu du compte' }).click();
    await page.getByRole('button', { name: 'Mon Profil' }).click();
    await expect(page.getByRole('heading', { name: 'Mon Profil' })).toBeVisible();

    await page.getByPlaceholder('06...').fill('06 00 00 00 00');
    await page.getByPlaceholder('10 Rue de la Santé, 75000 Paris').fill('1 rue de la Recette, 75000 Paris');
    await page.getByRole('button', { name: 'Enregistrer' }).first().click();
    await expect(page.getByText('Profil mis à jour', { exact: true })).toBeVisible();
    expect(writes[0]).toMatchObject({ phone_pro: '06 00 00 00 00', address_pro: '1 rue de la Recette, 75000 Paris' });
    await expect(page.getByRole('heading', { name: 'Patients suivis' })).toBeVisible();
  });

  test('enregistrer des préférences de rédaction', async ({ app, page }) => {
    const writes = await capturePractitionerWrites(app);
    await app.open();
    await page.getByRole('button', { name: 'Menu du compte' }).click();
    await page.getByRole('button', { name: 'Mon Profil' }).click();
    await page.getByRole('heading', { name: 'Mes préférences de rédaction' }).click();
    await page.locator('textarea').first().fill('- Phrases courtes.');
    await page.getByRole('button', { name: 'Enregistrer' }).last().click();
    await expect(page.getByText('Préférences enregistrées')).toBeVisible();
    expect(JSON.parse(String(writes.at(-1)?.ai_style_preferences))).toMatchObject({ global: '- Phrases courtes.' });
  });

  test('en offre gratuite, le Studio Design propose l’abonnement', async ({ app, page }) => {
    await app.mock(/\/rest\/v1\/subscriptions\b/, (route) =>
      route.fulfill({ json: { plan_id: 'free', status: 'active', trial_ends_at: null } }),
    );
    await app.open('scenario=initial-visualisation');
    await page.getByRole('button', { name: 'Design' }).click();
    await expect(page.getByText('Votre abonnement')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Studio Design' })).toHaveCount(0);
  });

  test('personnaliser le rapport dans le Studio Design', async ({ app, page }) => {
    const writes = await capturePractitionerWrites(app);
    // Offre Performance: the Studio Design is open to it.
    await app.mock(/\/rest\/v1\/subscriptions\b/, (route) =>
      route.fulfill({ json: { plan_id: 'performance', status: 'active', trial_ends_at: null } }),
    );
    await app.open('scenario=initial-visualisation');
    await page.getByRole('button', { name: 'Design' }).click();
    await expect(page.getByRole('heading', { name: 'Studio Design' })).toBeVisible();
    const title = page.getByPlaceholder("Bilan d'Ergothérapie");
    if (!(await title.isVisible())) await page.getByText('Mode Personnalisé').locator('..').getByRole('button').click();

    await title.fill('Bilan recette FICTIF');
    await page.locator('input[type=file][accept="image/*"]').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: LOGO });
    await expect(page.getByRole('img', { name: 'Logo' }).first()).toBeVisible();
    await expect(page.getByText('Bilan recette FICTIF').first()).toBeVisible();
    await expect
      .poll(
        () =>
          [...writes]
            .reverse()
            .map((w) => w.branding_config as Record<string, unknown> | undefined)
            .find(Boolean)?.documentTitle,
      )
      .toBe('Bilan recette FICTIF');
  });

  test('imprimer ouvre le PDF dans un nouvel onglet', async ({ app, page }) => {
    await app.open('scenario=initial-visualisation');
    const popup = page.waitForEvent('popup');
    await page.getByRole('button', { name: 'Imprimer' }).click();
    expect((await popup).url()).toMatch(/^blob:/);
  });

  test('votre abonnement et le mur de crédits', async ({ app, page }) => {
    await app.open('scenario=abonnement');
    await expect(page.getByText('Votre abonnement')).toBeVisible();
    await expect(page).toHaveScreenshot('abonnement.png');

    await app.open('scenario=dashboard&modale=paywall');
    await expect(page.getByText('Plus de crédits disponibles.')).toBeVisible();
    await expect(page).toHaveScreenshot('paywall.png');
  });
});
