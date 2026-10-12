/**
 * Parent portal, round trip: the practitioner generates a link, the family fills in
 * and sends the questionnaire (encrypted with the key of the link), the practitioner
 * imports it into a new assessment. The `pending_questionnaires` table is simulated
 * by a single row kept in the test: nothing is written to Supabase.
 */

import type { Route } from '@playwright/test';
import { expect, test, type Page } from '../fixtures';
import { fillField, patientCard } from '../helpers';

const Q_ID = '00000000-0000-4000-8000-0000000000f1';

type Row = Record<string, unknown>;

/** Answers `pending_questionnaires` as PostgREST would, from one row in memory. */
const simulatePendingTable = () => {
  let row: Row | null = null;
  const wantsObject = (route: Route) => (route.request().headers()['accept'] ?? '').includes('vnd.pgrst.object');
  const answer = async (route: Route) => {
    const request = route.request();
    const url = request.url();
    switch (request.method()) {
      case 'POST': {
        const body = request.postDataJSON() as Row | Row[];
        row = { ...(Array.isArray(body) ? body[0] : body), id: Q_ID, created_at: '2026-10-01T07:00:00Z', family_encrypted_data: null };
        return route.fulfill({ status: 201, json: wantsObject(route) ? row : [row] });
      }
      case 'PATCH':
        row = { ...row, ...(request.postDataJSON() as Row) };
        return route.fulfill({ status: 204 });
      case 'DELETE':
        row = null;
        return route.fulfill({ status: 204 });
      default: {
        const rows = row && (!url.includes('status=eq.completed') || row.status === 'completed') ? [row] : [];
        if (!wantsObject(route)) return route.fulfill({ json: rows });
        if (rows.length === 0) return route.fulfill({ status: 406, json: { code: 'PGRST116', message: 'no rows' } });
        return route.fulfill({ json: rows[0] });
      }
    }
  };
  return { answer, current: () => row };
};

/** Keeps what the app copies to the clipboard in `window.__copied`. */
const recordClipboard = (page: Page) =>
  page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: async (text: string) => void ((window as unknown as { __copied: string }).__copied = text) },
    });
  });

test.describe('Portail famille', { tag: '@portail' }, () => {
  test('lien, questionnaire rempli par la famille, import par la praticienne', async ({ app, page }) => {
    test.setTimeout(180_000);
    const table = simulatePendingTable();
    await app.mock(/\/rest\/v1\/pending_questionnaires\b/, table.answer);
    await recordClipboard(page);
    await app.open();

    await test.step('1. La praticienne génère le lien', async () => {
      await page.getByRole('button', { name: 'Nouveau patient' }).first().click();
      await page.getByText('Envoyer un lien famille').click();
      await expect(page.getByText('Lien sécurisé généré et copié')).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Questionnaires' })).toBeVisible();
      expect(table.current()).toMatchObject({ status: 'pending' });
    });
    const link = await page.evaluate(() => (window as unknown as { __copied: string }).__copied);
    expect(link).toMatch(new RegExp(`/\\?q_id=${Q_ID}&t=[0-9a-f]{64}#key=.+`));

    await test.step('2. La famille remplit le questionnaire et l’envoie', async () => {
      await page.goto(link);
      await expect(page.getByRole('heading', { name: 'Préparation du Bilan' })).toBeVisible();
      const send = page.getByRole('button', { name: 'Chiffrer et Envoyer' });
      await expect(send).toBeDisabled();

      await fillField(page.locator('input[name=firstName]').first(), 'Zoé');
      await fillField(page.locator('input[name=lastName]').first(), 'FICTIF');
      await fillField(page.locator('input[name=dob]').first(), '2018-03-14');
      await page.getByRole('button', { name: 'Situation familiale' }).click();
      await fillField(page.locator('input[name=parent1Name]'), 'Camille FICTIF');
      await fillField(page.locator('input[name=parent1Phone]'), '06 00 00 00 00');
      await page.getByRole('button', { name: 'Suivi médical' }).click();
      await fillField(page.locator('input[name=prescribingDoctor]'), 'Dr Martin');
      await page.getByRole('button', { name: 'Motif de consultation' }).click();
      await fillField(page.locator('textarea[name=reason]'), 'Difficultés d’écriture en classe.');

      await expect(send).toBeEnabled();
      await send.click();
      await expect(page.getByRole('heading', { name: 'Dossier Transmis !' })).toBeVisible();
      const sent = table.current()!;
      expect(sent.status).toBe('completed');
      // Encrypted with the key of the link: no name in clear.
      expect(String(sent.family_encrypted_data)).not.toContain('Zoé');
    });

    await test.step('3. La praticienne importe la réponse', async () => {
      await app.open();
      await expect(page.getByText('Réponse reçue')).toBeVisible();
      await page.getByRole('button', { name: 'Importer' }).click();
      await expect(page.getByRole('heading', { name: 'Dossier Patient' })).toBeVisible();
      await expect(page.getByText('Revue des données transmises par la famille.')).toBeVisible();
      // The family's answers, decrypted, in the summary of the questionnaire.
      await expect(page.getByText('Prénom: Zoé')).toBeVisible();
      await expect(page.getByText('Naissance: 2018-03-14')).toBeVisible();
      expect(table.current()).toBeNull();
      await page.getByRole('button', { name: /Sauvegarder & Quitter/ }).click();
      await expect(patientCard(page, 'Zoé FICTIF')).toBeVisible();
    });
  });
});

test.describe('Portail famille, sans compte', { tag: '@portail' }, () => {
  test.use({ connecte: false });

  test('un lien collé sans sa clé est refusé', async ({ app, page }) => {
    await app.open();
    await page.getByRole('button', { name: 'Espace Famille' }).click();
    await expect(page.getByRole('heading', { name: 'Accès Sécurisé' })).toBeVisible();
    await page.getByPlaceholder('https://app.com/?q_id=...').fill(`https://app.ergobilan.fr/?q_id=${Q_ID}`);
    await page.getByPlaceholder('https://app.com/?q_id=...').press('Enter');
    await expect(page.getByText('Lien incomplet. Vérifiez que vous avez copié tout le lien.')).toBeVisible();
    expect(app.supabaseRequests.filter((r) => r.includes('pending_questionnaires'))).toEqual([]);
  });
});
