/**
 * Réévaluation through the interface: « Réévaluation 1 clic » on Léo (scenario
 * `dashboard`, initial assessment two months ago), new scores, evolution, AI
 * synthesis (checked payload), validation, PDF, finalization and the reminder;
 * then the re-evaluation draft of Lina, resumed and abandoned.
 */

import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '../fixtures';
import { openPatient, patientCard } from '../helpers';

/** The editable row of a subtest, in the « Nouveaux résultats » table. */
const newRow = (page: Page, subtest: string) =>
  page
    .locator('tr', { hasText: subtest })
    .filter({ has: page.locator('input[placeholder="—"]') })
    .first();

/** A clearly better score in the metric of the column (z = +2; BHK is on a 100/15 scale). */
const BETTER: Record<string, string> = { ET: '2', '%': '98', NS: '130' };

test('Réévaluation 1 clic : nouveaux scores, évolution, synthèse et bilan rangé', { tag: ['@reeval'] }, async ({ app, page }) => {
  test.setTimeout(240_000);
  await app.open('scenario=dashboard');

  await test.step('1. Nouvelles mesures face au bilan de référence', async () => {
    await openPatient(page, 'Léo FICTIF');
    await page.getByRole('button', { name: 'Réévaluation 1 clic' }).click();
    await expect(page.getByRole('heading', { name: 'Saisie des nouvelles mesures' })).toBeVisible();
    await expect(page.getByText('1 août 2026').first()).toBeVisible();

    const row = newRow(page, 'Qualité');
    const metric = (await row.locator('xpath=ancestor::table//th').nth(1).innerText()).trim().toUpperCase();
    expect(Object.keys(BETTER), `Colonne de saisie : ${metric}`).toContain(metric);
    const input = row.locator('input[placeholder="—"]').first();
    await input.fill(BETTER[metric]);
    await input.blur();
    await page.getByRole('button', { name: "Voir l'évolution" }).click();
  });

  await test.step('2. Évolution : progression marquée, épreuves non repassées', async () => {
    await expect(page.getByRole('heading', { name: 'Évolution des scores' })).toBeVisible();
    const delta = page.locator('tr', { hasText: 'Qualité' }).last().locator('td').last();
    await expect(delta.locator('.text-emerald-600'), 'Δ en amélioration').toBeVisible();
    await expect(page.getByText('non mesuré').first()).toBeVisible();

    await page.getByRole('button', { name: 'Générer avec l’IA' }).click();
    await expect(page.getByRole('heading', { name: 'Générer la synthèse' })).toBeVisible();
    await page.getByRole('button', { name: 'Générer (1 crédit)' }).click();
    await expect(page.getByText('Synthèse générée — relisez et ajustez si besoin.')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('heading', { name: 'Relecture' })).toBeVisible();

    const reeval = app.aiRequests.filter((r) => r.task === 'report_reevaluation');
    expect(reeval, 'Une requête de réévaluation').toHaveLength(1);
    const sent = JSON.stringify(reeval);
    await test.info().attach('envoye-a-l-ia', { body: JSON.stringify(reeval, null, 2), contentType: 'application/json' });
    for (const identifier of ['Léo', 'FICTIF', 'Claire', '06 00 00 00 01', 'claire.fictif@example.com', 'Morel']) {
      expect(sent, `« ${identifier} » ne doit pas partir vers l'IA`).not.toContain(identifier);
    }
  });

  await test.step('3. Relecture, aperçu et PDF', async () => {
    for (const title of ['Rappel du bilan initial', 'Évolution des résultats', 'Conclusion', 'Préconisations']) {
      await expect(page.getByRole('heading', { name: title }).first()).toBeVisible();
    }
    await page.getByRole('button', { name: 'Tout valider' }).click();
    await page.getByRole('button', { name: /^Valider \d+ section\(s\)$/ }).click();
    await page.getByRole('button', { name: 'Visualiser le document' }).click();
    await expect(page.getByRole('heading', { name: 'Visualisation & Export' })).toBeVisible();

    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Télécharger PDF' }).click()]);
    expect(download.suggestedFilename()).toMatch(/^Bilan_FICTIF_L.+o_2026-10-01\.pdf$/);
    expect(
      readFileSync(await download.path())
        .subarray(0, 5)
        .toString(),
    ).toBe('%PDF-');
  });

  await test.step('4. Finalisation : réévaluation rangée, rappel à 6 mois, rappel clôturable', async () => {
    await page.getByRole('button', { name: 'Terminer & Archiver' }).click();
    await expect(page.getByText('Bilan sauvegardé.')).toBeVisible();
    await expect(patientCard(page, 'Léo FICTIF').getByText('Prochain rappel le 1 avril 2027')).toBeVisible();

    await openPatient(page, 'Léo FICTIF');
    await expect(page.getByText('Réévaluation', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('01 octobre 2026')).toBeVisible();
    await expect(page.getByText('Échéance : 01/04/2027')).toBeVisible();
    await page.getByRole('button', { name: 'Marquer complété' }).click();
    await expect(page.getByText('Rappel marqué comme complété.')).toBeVisible();
    await expect(page.getByText('Rééval. Complété')).toBeVisible();
  });
});

test('Réévaluation en cours : reprise du brouillon puis abandon', { tag: ['@reeval', '@brouillons'] }, async ({ app, page }) => {
  await app.open('scenario=dashboard');
  await patientCard(page, 'Lina FICTIF').getByRole('button', { name: 'Reprendre' }).click();
  await expect(page.getByRole('heading', { name: 'Saisie des nouvelles mesures' })).toBeVisible();
  // The draft kept its new scores.
  const filled = await page
    .locator('input[placeholder="—"]')
    .evaluateAll((inputs) => inputs.filter((i) => (i as HTMLInputElement).value).length);
  expect(filled, 'Scores du brouillon').toBeGreaterThan(0);

  await page.getByRole('button', { name: 'Retour' }).click();
  await page.getByRole('button', { name: 'Quitter sans sauvegarder' }).click();
  await expect(patientCard(page, 'Lina FICTIF').getByRole('button', { name: 'Reprendre' })).toHaveCount(0);
  await openPatient(page, 'Lina FICTIF');
  await expect(page.getByText('Réévaluation en cours')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Réévaluation 1 clic' })).toBeVisible();
});
