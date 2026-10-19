/**
 * Tableau de bord and drafts: one patient per status (scenario `dashboard`), search,
 * draft resumed, saved and abandoned.
 */

import { expect, test } from '../fixtures';
import { openPatient, patientCard } from '../helpers';

test.describe('Tableau de bord : statuts et brouillons', { tag: ['@dashboard'] }, () => {
  test.beforeEach(async ({ app }) => {
    await app.open('scenario=dashboard');
  });

  test('un patient par statut, avec le bon rappel et la bonne action', async ({ page }) => {
    const expected: Array<[string, string | RegExp, boolean]> = [
      ['Chloé FICTIF', 'Réévaluation en retard', false],
      ['Inès FICTIF', 'Réévaluation à planifier', false],
      ['Léo FICTIF', 'Prochain rappel le 1 février 2027', false],
      // Stale draft: the report exists, a re-evaluation starts instead.
      ['Adam FICTIF', 'Prochain rappel le 1 janvier 2027', false],
      ['Lina FICTIF', 'Réévaluation à planifier', true],
      ['Noah FICTIF', 'Tests en cours', true],
    ];
    for (const [name, line, resumable] of expected) {
      const card = patientCard(page, name);
      await expect(card.getByText(line), `${name} : ${line}`).toBeVisible();
      await expect(card.getByRole('button', { name: 'Reprendre' }), `${name} : Reprendre`).toHaveCount(resumable ? 1 : 0);
    }
    await expect(patientCard(page, 'Noah FICTIF').getByText('Brouillon', { exact: true })).toBeVisible();
    // Due and overdue: Chloé, Inès, Lina.
    await expect(page.getByText('Rappels actifs').locator('..')).toContainText('3');
  });

  test('la recherche filtre la liste', async ({ page }) => {
    const search = page.getByPlaceholder('Rechercher un patient');
    await search.fill('lina');
    await expect(page.locator('div.group.cursor-pointer.rounded-2xl')).toHaveCount(1);
    await expect(patientCard(page, 'Lina FICTIF')).toBeVisible();
    await search.fill('zzz');
    await expect(page.getByText('Aucun patient trouvé pour "zzz".')).toBeVisible();
  });

  test('le brouillon périmé ne se reprend pas : une réévaluation est proposée', async ({ page }) => {
    await openPatient(page, 'Adam FICTIF');
    await expect(page.getByText('Brouillon non terminé')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Réévaluation 1 clic' })).toBeVisible();
  });

  test('un brouillon repris puis sauvegardé reste à reprendre', async ({ page }) => {
    await patientCard(page, 'Noah FICTIF').getByRole('button', { name: 'Reprendre' }).click();
    await expect(page.getByRole('heading', { name: 'Tests & mesures' })).toBeVisible();
    await page.getByRole('button', { name: 'Sauvegarder & Quitter' }).click();
    await expect(page.getByText('Brouillon sauvegardé')).toBeVisible();
    await expect(patientCard(page, 'Noah FICTIF').getByRole('button', { name: 'Reprendre' })).toBeVisible();
  });

  test('un nouveau brouillon apparaît à reprendre sans recharger la page', async ({ page }) => {
    await openPatient(page, 'Léo FICTIF');
    await page.getByRole('button', { name: 'Réévaluation 1 clic' }).click();
    await expect(page.getByRole('heading', { name: 'Saisie des nouvelles mesures' })).toBeVisible();
    await page.getByRole('button', { name: 'Sauvegarder & Quitter' }).click();
    await expect(page.getByText('Brouillon sauvegardé')).toBeVisible();
    await expect(patientCard(page, 'Léo FICTIF').getByRole('button', { name: 'Reprendre' })).toBeVisible();
  });

  test('abandonner un brouillon le supprime, le dossier reste', async ({ page }) => {
    await patientCard(page, 'Noah FICTIF').getByRole('button', { name: 'Reprendre' }).click();
    await expect(page.getByRole('heading', { name: 'Tests & mesures' })).toBeVisible();
    await page.getByRole('button', { name: 'Retour' }).click();
    await page.getByRole('button', { name: 'Quitter', exact: true }).click();
    await expect(page.getByText('Souhaitez-vous sauvegarder un brouillon avant de quitter ?')).toBeVisible();
    await page.getByRole('button', { name: 'Quitter sans sauvegarder' }).click();

    const noah = patientCard(page, 'Noah FICTIF');
    await expect(noah.getByText('Bilan initial en cours')).toBeVisible();
    await expect(noah.getByRole('button', { name: 'Reprendre' })).toHaveCount(0);
    await expect(noah.getByText('En cours', { exact: true })).toBeVisible();
  });
});

test.describe('Tableau de bord : questionnaires parents', { tag: ['@dashboard'] }, () => {
  test('un questionnaire reçu porte le nom de l’enfant (#98)', async ({ app, page }) => {
    // Fictitious questionnaires, encrypted as by the portal and decrypted by the dashboard (memory only).
    await app.open('scenario=dashboard&questionnaires=oui');
    const section = page.getByRole('heading', { name: 'Questionnaires' }).locator('xpath=ancestor::section');
    await expect(section.getByText('Léo FICTIF (22/09/2026)')).toBeVisible();
    await expect(section.getByText('Adam FICTIF (25/09/2026)')).toBeVisible();
    // Cannot be decrypted: generic label. Still waiting: generic label.
    await expect(section.getByText('Dossier #3 (27/09/2026)')).toBeVisible();
    await expect(section.getByText('Dossier #4 (30/09/2026)')).toBeVisible();
  });
});
