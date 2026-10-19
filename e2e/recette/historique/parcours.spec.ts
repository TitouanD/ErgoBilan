/**
 * Bilan historique through the interface: « Bilan antérieur », the date of the
 * original assessment, scores, sections pasted, saved without any AI call; the
 * reminder starts from the original date and the re-evaluation becomes available.
 */

import { expect, test } from '../fixtures';
import { fillField, openPatient, patientCard } from '../helpers';

test('Bilan antérieur : saisie, enregistrement sans IA, réévaluation disponible', { tag: ['@historique'] }, async ({ app, page }) => {
  test.setTimeout(180_000);
  await app.open();

  await test.step('1. Dossier et date du bilan d’origine', async () => {
    await page.getByRole('button', { name: 'Nouveau patient' }).first().click();
    await page.getByRole('button', { name: /Bilan antérieur/ }).click();
    await expect(page.getByText('Mode import — Bilan antérieur')).toBeVisible();
    const next = page.getByRole('button', { name: 'Suivant — Saisir les scores' });

    await fillField(page.locator('input[name=firstName]'), 'Jules');
    await fillField(page.locator('input[name=lastName]'), 'RECETTE');
    const dates = page.locator('input[type=date]');
    // The date of the original assessment comes first, then the date of birth.
    await fillField(dates.nth(1), '2017-04-12');
    await expect(next, 'La date du bilan manque').toBeDisabled();
    await expect(page.getByText("La date du bilan d'origine est obligatoire.")).toBeVisible();
    await fillField(dates.nth(0), '2025-12-01');
    await expect(next).toBeEnabled();
    await next.click();
  });

  await test.step('2. Scores', async () => {
    await expect(page.getByRole('heading', { name: 'Tests & mesures' })).toBeVisible();
    await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
    await page.getByPlaceholder('Rechercher un test ou un sous-test...').fill('BHK');
    await page.getByRole('button', { name: /^BHK \d+ sous-tests?/ }).click();
    await page.getByLabel('Qualité', { exact: true }).check();
    await page.getByRole('button', { name: 'Ajouter', exact: true }).last().click();
    const et = page.locator('tr', { hasText: 'Qualité' }).locator('input[placeholder="—"]').nth(1);
    await et.fill('-2,5');
    await et.blur();
    await expect(page.locator('tr', { hasText: 'Qualité' })).toHaveClass(/bg-rose-50/);
    await page.getByRole('button', { name: 'Passer au rapport' }).click();
  });

  await test.step('3. Sections collées, enregistrées sans IA', async () => {
    await expect(page.getByRole('heading', { name: 'Rapport antérieur' })).toBeVisible();
    await page.getByRole('button', { name: 'Tout développer' }).click();
    const sections = page.getByPlaceholder('Collez ou tapez le contenu de cette section...');
    await expect(sections).toHaveCount(6);
    // Fourth section: « Diagnostic en ergothérapie ».
    await fillField(sections.nth(3), 'Dysgraphie sévère, posée lors du bilan de décembre 2025.');
    await expect(page.getByText('1/6 sections remplies')).toBeVisible();
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByText('Bilan de référence enregistré. La réévaluation est maintenant disponible.')).toBeVisible();
    expect(app.aiRequests, 'Aucun appel à l’IA pour un bilan antérieur').toHaveLength(0);
  });

  await test.step('4. Rappel parti de la date d’origine, réévaluation disponible', async () => {
    // 2025-12-01 + 6 months is past (due), + 12 months not yet (overdue).
    await expect(patientCard(page, 'Jules RECETTE').getByText('Réévaluation à planifier')).toBeVisible();
    await openPatient(page, 'Jules RECETTE');
    await expect(page.getByText('Bilan initial', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('01 décembre 2025')).toBeVisible();
    await expect(page.getByText('Rééval. À planifier')).toBeVisible();
    await page.getByRole('button', { name: 'Réévaluation 1 clic' }).click();
    await expect(page.getByRole('heading', { name: 'Saisie des nouvelles mesures' })).toBeVisible();
    await expect(page.getByText('1 décembre 2025').first()).toBeVisible();
  });
});
