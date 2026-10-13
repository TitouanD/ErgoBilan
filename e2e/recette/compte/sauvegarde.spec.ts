/** Backup `.ergobilan` from the account menu: export, then import brings back a deleted patient (scenario `dashboard`). */

import { expect, test } from '../fixtures';
import { openPatient, patientCard } from '../helpers';

test.describe('Sauvegarde des données', { tag: '@sauvegarde' }, () => {
  test('exporter puis réimporter retrouve un patient supprimé', async ({ app, page }, testInfo) => {
    await app.open('scenario=dashboard');
    const menu = page.getByRole('button', { name: 'Menu du compte' });

    await menu.click();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Sauvegarder mes données' }).click();
    const file = await download;
    await expect(page.getByText(/^Backup sauvegardé/)).toBeVisible();
    expect(file.suggestedFilename()).toMatch(/^ergobilan-backup-.+\.ergobilan$/);
    const backup = testInfo.outputPath(file.suggestedFilename());
    await file.saveAs(backup);

    await openPatient(page, 'Adam FICTIF');
    await page.getByRole('button', { name: 'Supprimer' }).click();
    await page.getByPlaceholder('supprimer').fill('supprimer');
    await page.getByRole('button', { name: 'Supprimer', exact: true }).last().click();
    await expect(patientCard(page, 'Adam FICTIF')).toHaveCount(0);

    let question = '';
    page.once('dialog', (dialog) => {
      question = dialog.message();
      void dialog.accept();
    });
    await menu.click();
    await page.getByLabel('Importer un backup').setInputFiles(backup);
    await expect(page.getByText(/Import réussi : 6 patients/)).toBeVisible();
    expect(question).toContain('Importer ce backup ?');
    await expect(patientCard(page, 'Adam FICTIF')).toBeVisible();
  });

  test('un fichier qui n’est pas un .ergobilan est refusé', async ({ app, page }) => {
    app.expectConsoleError(/Backup import failed/);
    await app.open();
    await page.getByRole('button', { name: 'Menu du compte' }).click();
    await page.getByLabel('Importer un backup').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('rien') });
    await expect(page.getByText('Fichier invalide. Choisissez un fichier .ergobilan')).toBeVisible();
  });
});
