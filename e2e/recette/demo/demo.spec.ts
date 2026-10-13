/** Landing page and demo mode, without a session: the demo sends nothing to Supabase nor to the AI. */

import { expect, test } from '../fixtures';

test.use({ connecte: false });

test.describe('Accueil et démo', { tag: '@demo' }, () => {
  test('page d’accueil, connexion et mentions légales', async ({ app, page }) => {
    await app.open();
    await expect(page.getByRole('button', { name: 'Accès Praticien' })).toBeVisible();
    await expect(page).toHaveScreenshot('accueil.png');

    await page.getByRole('button', { name: 'Accès Praticien' }).click();
    await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Se connecter' })).toBeVisible();
    await page.getByRole('button', { name: 'Fermer' }).click();

    await page.getByRole('button', { name: 'Conditions Générales' }).click();
    await expect(page.getByRole('heading', { name: '1. Éditeur du service' })).toBeVisible();
  });

  test('la démo s’ouvre sans aucun appel à Supabase', async ({ app, page }) => {
    await app.open();
    const before = app.supabaseRequests.length;
    await page.getByRole('button', { name: "Explorer l'interface sans inscription" }).click();
    await page.getByRole('button', { name: "C'est parti" }).click();
    await page.getByRole('button', { name: "J'ai compris" }).click();
    await page.getByRole('button', { name: /Accéder à l.espace démo/ }).click();

    await expect(page.getByText("Mode démonstration — aucune donnée n'est sauvegardée")).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Patients suivis' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Sarah DUBOIS' })).toBeVisible();
    await expect(page).toHaveScreenshot('demo-dashboard.png', { fullPage: true });

    await page.getByRole('heading', { name: 'Sarah DUBOIS' }).click();
    await expect(page.getByRole('heading', { name: 'Historique des bilans' })).toBeVisible();
    expect(app.supabaseRequests.slice(before)).toEqual([]);
  });

  test('importer le questionnaire d’Elya ouvre son bilan', async ({ app, page }) => {
    await app.open();
    const before = app.supabaseRequests.length;
    await page.getByRole('button', { name: "Explorer l'interface sans inscription" }).click();
    await page.getByRole('button', { name: "C'est parti" }).click();
    await page.getByRole('button', { name: "J'ai compris" }).click();
    await page.getByRole('button', { name: /Accéder à l.espace démo/ }).click();

    await page.getByRole('button', { name: 'Importer' }).click();
    await expect(page.getByRole('button', { name: /Sauvegarder & Quitter/ })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('RAVEL').first()).toBeVisible();
    expect(app.supabaseRequests.slice(before)).toEqual([]);
  });
});
