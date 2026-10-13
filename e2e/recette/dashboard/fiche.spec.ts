/** Fiche patient: report viewer, identity edit, reminder actions, archive and delete (scenario `dashboard`). */

import { expect, test } from '../fixtures';
import { backToDashboard, openPatient, patientCard } from '../helpers';

test.describe('Fiche patient', { tag: ['@dashboard', '@fiche'] }, () => {
  test.beforeEach(async ({ app }) => {
    await app.open('scenario=dashboard');
  });

  test('voir le rapport d’un bilan rangé', async ({ page }) => {
    await openPatient(page, 'Léo FICTIF');
    await expect(page.getByText('01 août 2026')).toBeVisible();
    await page.getByRole('button', { name: 'Voir le rapport' }).first().click();
    await expect(page.getByText('Bilan initial · 1 août 2026')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Diagnostic en ergothérapie' }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Fermer' }).click();
    await expect(page.getByText('Bilan initial · 1 août 2026')).toHaveCount(0);
  });

  test('corriger l’identité dans la fiche', async ({ page }) => {
    await openPatient(page, 'Léo FICTIF');
    // Identité is the first section: its « Modifier » comes first.
    await page.getByRole('button', { name: 'Modifier' }).first().click();
    const identity = page
      .locator('div')
      .filter({ has: page.getByRole('heading', { name: 'Identité', exact: true }) })
      .filter({ has: page.getByRole('button', { name: 'Enregistrer' }) })
      .last();
    const firstName = identity.locator('input[type=text], input:not([type])').first();
    await expect(firstName).toHaveValue('Léo');
    await firstName.fill('Léon');
    await identity.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByText('Profil mis à jour.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Léon FICTIF', level: 1 })).toBeVisible();
    await backToDashboard(page);
    await expect(patientCard(page, 'Léon FICTIF')).toBeVisible();
  });

  test('planifier la réévaluation', async ({ page }) => {
    await openPatient(page, 'Inès FICTIF');
    await expect(page.getByText('Rééval. À planifier')).toBeVisible();
    await page.getByRole('button', { name: 'Planifier' }).click();
    await expect(page.getByText('Rappel planifié.')).toBeVisible();
    await expect(page.getByText('Rééval. Planifié')).toBeVisible();
    await backToDashboard(page);
    await expect(patientCard(page, 'Inès FICTIF').getByText('Réévaluation planifiée (1 septembre 2026)')).toBeVisible();
  });

  test('reporter le rappel d’un mois', async ({ page }) => {
    await openPatient(page, 'Chloé FICTIF');
    await expect(page.getByText('Rééval. En retard')).toBeVisible();
    await page.getByRole('button', { name: 'Reporter 1 mois' }).click();
    await expect(page.getByText('Rappel reporté d’un mois.')).toBeVisible();
    await expect(page.getByText('Rééval. Reporté')).toBeVisible();
    await expect(page.getByText("Reporté jusqu'au : 01/11/2026")).toBeVisible();
    await backToDashboard(page);
    await expect(patientCard(page, 'Chloé FICTIF').getByText("Rappel reporté jusqu'au 1 novembre 2026")).toBeVisible();
  });

  test('archiver un patient le retire de la liste active', async ({ page }) => {
    await openPatient(page, 'Léo FICTIF');
    await page.getByRole('button', { name: 'Archiver' }).click();
    await expect(page.getByRole('heading', { name: 'Patients suivis' })).toBeVisible();
    await expect(patientCard(page, 'Léo FICTIF')).toHaveCount(0);
    await page.getByRole('button', { name: 'Voir archives' }).click();
    await expect(patientCard(page, 'Léo FICTIF')).toBeVisible();
  });

  test('supprimer un patient demande de taper « supprimer »', async ({ page }) => {
    await openPatient(page, 'Adam FICTIF');
    await page.getByRole('button', { name: 'Supprimer' }).click();
    await expect(page.getByRole('heading', { name: 'Zone de danger' })).toBeVisible();
    const confirm = page.getByRole('button', { name: 'Supprimer', exact: true }).last();
    await expect(confirm).toBeDisabled();
    await page.getByPlaceholder('supprimer').fill('supprimer');
    await confirm.click();
    await expect(page.getByRole('heading', { name: 'Patients suivis' })).toBeVisible();
    await expect(patientCard(page, 'Adam FICTIF')).toHaveCount(0);
  });
});
