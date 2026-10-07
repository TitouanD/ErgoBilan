/**
 * Bilan initial, fil rouge: the whole flow through the interface, from « Nouveau
 * patient » to the finalized assessment in the patient record, as a practitioner
 * does it. The only recette test that starts without a scenario.
 *
 * 1. patient record, with the required fields that hold the next button;
 * 2. tests from the real catalogue, scores typed in each metric (NS, ET, %),
 *    conversions and zones;
 * 3. synthesis, interruption (page reloaded) then « Reprendre » without loss;
 * 4. suspect words (one masked, one allowed), generation with what is sent
 *    checked: pseudonyms, no identifier;
 * 5. validation with an edited section;
 * 6. preview, PDF downloaded;
 * 7. finalization: assessment in the patient record, draft gone, reminder in 6 months.
 */

import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '../fixtures';

const CHILD = { firstName: 'Margaux', lastName: 'RECETTE', dob: '2018-05-20' };
const PARENT = { name: 'Claire RECETTE', phone: '0611223344' };
const MASKED = 'Dupont'; // « Mme Dupont », a name: stays masked
const ALLOWED = 'Montessori'; // a method, not a person: allowed by the practitioner
// Names reach the AI through the free text: the pseudonyms must replace them there.
const NOTES = `${CHILD.firstName} est coopérante. Sa mère, ${PARENT.name}, joignable au ${PARENT.phone}. Suivie par Mme ${MASKED} en orthophonie. Classe inspirée de la pédagogie ${ALLOWED}.`;
const DIAGNOSTIC = `Chez ${CHILD.firstName}, dysgraphie avec fragilité visuo-motrice, retentissement scolaire.`;
const EDIT = 'Phrase ajoutée par la recette.';

/**
 * Fills a debounced field and leaves it, so its value reaches the state at once.
 * Held by its element: some placeholders change once the field is filled.
 */
const fill = async (page: Page, selector: string, value: string) => {
  const field = (await page.locator(selector).elementHandle())!;
  await field.fill(value);
  await field.evaluate((el: HTMLElement) => el.blur());
};
const openSection = (page: Page, title: string) => page.getByRole('button', { name: title }).click();
const scoreRow = (page: Page, subtest: string) => page.locator('tr', { hasText: subtest });
/** Score inputs of a row: NS, ET, %. */
const scoreInput = (page: Page, subtest: string, metric: 'NS' | 'ET' | '%') =>
  scoreRow(page, subtest).locator('input[placeholder="—"]').nth({ NS: 0, ET: 1, '%': 2 }[metric]);

test('Bilan initial : fil rouge, du nouveau patient au bilan finalisé', { tag: ['@initial', '@fil-rouge'] }, async ({ app, page }) => {
  test.setTimeout(240_000);
  await app.open();

  await test.step('1. Dossier : champs requis puis patient créé', async () => {
    await page.getByRole('button', { name: 'Nouveau patient' }).first().click();
    await page.getByRole('button', { name: /Saisie manuelle/ }).click();
    await expect(page.getByRole('heading', { name: 'Dossier Patient' })).toBeVisible();
    const next = page.getByRole('button', { name: 'Suivant : Tests & Mesures' });
    await expect(next).toBeDisabled();

    await fill(page, 'textarea[placeholder^="Dictez ou tapez vos notes"]', NOTES);
    await fill(page, 'input[name=firstName]', CHILD.firstName);
    await fill(page, 'input[name=lastName]', CHILD.lastName);
    await fill(page, 'input[name=dob]', CHILD.dob);
    await page.getByLabel('Fille').check();
    await expect(next, 'Identité seule : responsable, médical et motif manquent').toBeDisabled();

    await openSection(page, 'Situation familiale');
    await fill(page, 'input[name=parent1Name]', PARENT.name);
    await fill(page, 'input[name=parent1Phone]', PARENT.phone);
    await openSection(page, 'Suivi médical');
    await fill(page, 'input[name=prescribingDoctor]', 'Dr Martin');
    await expect(next, 'Le motif manque').toBeDisabled();
    await openSection(page, 'Motif de consultation');
    await fill(page, 'textarea[name=reason]', 'Écriture lente et douloureuse.');
    await expect(next).toBeEnabled();
    await next.click();
  });

  await test.step('2. Tests du catalogue réel, scores en NS, ET et %', async () => {
    await expect(page.getByRole('heading', { name: 'Tests & mesures' })).toBeVisible();
    await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Catalogue tests' })).toBeVisible();
    const search = page.getByPlaceholder('Rechercher un test ou un sous-test...');

    await search.fill('BHK');
    await page.getByRole('button', { name: /^BHK \d+ sous-tests?/ }).click();
    await page.getByLabel('Qualité', { exact: true }).check();
    await page.getByLabel('Vitesse', { exact: true }).check();
    await search.fill('Beery');
    await page
      .getByRole('button', { name: /^Beery/ })
      .first()
      .click();
    await page.getByLabel('Intégration visuo-motrice', { exact: true }).check();
    await expect(page.getByText('3 épreuve(s) sélectionnée(s)')).toBeVisible();
    // The page header also has an « Ajouter »: the modal's comes last.
    await page.getByRole('button', { name: 'Ajouter', exact: true }).last().click();
    await expect(page.getByRole('heading', { name: 'Catalogue tests' })).toBeHidden();

    // Order of the catalogue, not of the clicks (#92).
    await expect(page.locator('h4').filter({ hasText: /^(BHK|Beery)/ })).toHaveText([/^BHK/, /^Beery/]);

    // ET -1,5: fragile. % 50: in the average. NS of z = -2: difficulty.
    await scoreInput(page, 'Qualité', 'ET').fill('-1,5');
    await scoreInput(page, 'Qualité', 'ET').blur();
    await scoreInput(page, 'Vitesse', '%').fill('50');
    await scoreInput(page, 'Vitesse', '%').blur();
    const beery = scoreInput(page, 'Intégration visuo-motrice', 'NS');
    await beery.fill('70');
    await beery.blur();

    await expect(scoreRow(page, 'Qualité')).toHaveClass(/bg-amber-50/);
    await expect(scoreRow(page, 'Vitesse')).toHaveClass(/bg-emerald-50/);
    await expect(scoreRow(page, 'Vitesse').locator('input[placeholder="—"]').nth(1), '50 % = 0 ET').toHaveValue(/^[+]?0([.,]0+)?$/);
    await expect(scoreRow(page, 'Intégration visuo-motrice')).toHaveClass(/bg-rose-50/);
    await expect(scoreInput(page, 'Intégration visuo-motrice', 'ET'), 'NS 70 (m=100, σ=15) = -2 ET').toHaveValue(/^-2([.,]0+)?$/);
    await expect(page.getByText('3/3 saisis')).toBeVisible();
    await page.getByRole('button', { name: 'Passer au diagnostic' }).click();
  });

  await test.step('3. Synthèse, interruption puis reprise sans perte', async () => {
    await expect(page.getByRole('heading', { name: "Diagnostic et projet d'accompagnement" })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Diagnostic requis' })).toBeDisabled();
    await fill(page, 'textarea[placeholder^="Ex: TDC mixte"]', DIAGNOSTIC);
    await fill(page, 'textarea[placeholder^="Ex: Suivi ergo hebdomadaire"]', 'Séances hebdomadaires pendant 6 mois.');
    await fill(page, 'textarea[placeholder^="Ex: Tiers-temps"]', 'Temps majoré, ordinateur à envisager.');
    // Autosave after 3 s of calm.
    await page.waitForTimeout(4_500);

    // The browser is new: Margaux is the only patient of the dashboard.
    await app.open();
    await expect(page.getByRole('heading', { name: `${CHILD.firstName} ${CHILD.lastName}` })).toBeVisible();
    await expect(page.getByText('Brouillon', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Reprendre' }).click();
    await expect(page.getByRole('heading', { name: "Diagnostic et projet d'accompagnement" })).toBeVisible();
    await expect(page.locator('textarea').filter({ hasText: DIAGNOSTIC })).toHaveCount(1);
  });

  await test.step('4. Mots suspects et génération : ce qui part est pseudonymisé', async () => {
    await page.getByRole('button', { name: 'Générer', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Vérification avant analyse' })).toBeVisible();
    await expect(page.getByLabel(MASKED)).toBeChecked();
    await page.getByLabel(ALLOWED).uncheck();
    await page.locator('#demo-btn-generate').click();
    await expect(page.getByRole('heading', { name: 'Relecture' })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText('Rapport généré avec succès')).toBeVisible();

    expect(app.aiRequests.length, 'Requêtes envoyées à generate').toBeGreaterThan(0);
    const sent = JSON.stringify(app.aiRequests, null, 2);
    await test.info().attach('envoye-a-l-ia', { body: sent, contentType: 'application/json' });
    for (const identifier of [CHILD.firstName, CHILD.lastName, PARENT.name, PARENT.phone, MASKED, 'Martin', CHILD.dob]) {
      expect(sent, `« ${identifier} » ne doit pas partir vers l'IA`).not.toContain(identifier);
    }
    expect(sent, 'Le mot autorisé part tel quel').toContain(ALLOWED);
    // The anonymizer itself, not only the suspect words, replaces the first name.
    expect(sent, 'Le pseudonyme remplace le prénom dans les notes').toContain('{{PATIENT_PRENOM}} est coopérante');

    // Scores leave resolved with the catalogue, even right after « Reprendre ».
    const diagnostic = app.aiRequests.find((r) => r.task === 'report_diagnostic')?.payload as {
      scoresEvidence: Array<{ testName: string; subtestName: string; zScore: number | null }>;
    };
    expect(diagnostic.scoresEvidence.map((e) => [e.testName, e.subtestName, e.zScore])).toEqual([
      [expect.stringMatching(/^BHK/), 'Qualité', -1.5],
      [expect.stringMatching(/^BHK/), 'Vitesse', 0],
      [expect.stringMatching(/^Beery/), 'Intégration visuo-motrice', -2],
    ]);
  });

  await test.step('5. Relecture : une section modifiée, les autres validées', async () => {
    const firstCard = page
      .locator('div.group')
      .filter({ has: page.getByRole('button', { name: 'Modifier' }) })
      .first();
    await firstCard.getByRole('button', { name: 'Modifier' }).click();
    const editor = page.locator('.ProseMirror[contenteditable="true"]');
    await editor.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type(` ${EDIT}`);
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByText(EDIT)).toBeVisible();

    await page.getByRole('button', { name: 'Tout valider' }).click();
    await page.getByRole('button', { name: /^Valider \d+ section\(s\)$/ }).click();
    await expect(page.getByText(/^(\d+)\/\1 validé\(s\)$/)).toBeVisible();
    await page.getByRole('button', { name: 'Visualiser le document' }).click();
  });

  await test.step('6. Aperçu et PDF', async () => {
    await expect(page.getByRole('heading', { name: 'Visualisation & Export' })).toBeVisible();
    await expect(page.getByText(EDIT)).toBeVisible();
    await expect(page.getByText(`${CHILD.firstName} ${CHILD.lastName}`).first()).toBeVisible();

    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Télécharger PDF' }).click()]);
    expect(download.suggestedFilename()).toBe(`Bilan_${CHILD.lastName}_${CHILD.firstName}_2026-10-01.pdf`);
    const pdf = readFileSync(await download.path());
    expect(pdf.subarray(0, 5).toString(), 'Fichier PDF').toBe('%PDF-');
    const pages = pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) ?? [];
    expect(pages.length, 'Pages du PDF : sections et annexes').toBeGreaterThanOrEqual(3);
    await expect(page.getByText('PDF exporté avec succès ✓')).toBeVisible();
  });

  await test.step('7. Finalisation : bilan rangé, brouillon supprimé, rappel à 6 mois', async () => {
    await page.getByRole('button', { name: 'Terminer & Archiver' }).click();
    await expect(page.getByText('Bilan sauvegardé.')).toBeVisible();
    const name = page.getByRole('heading', { name: `${CHILD.firstName} ${CHILD.lastName}` });
    await expect(page.getByText('Prochain rappel le 1 avril 2027')).toBeVisible();
    await expect(page.getByText('Brouillon', { exact: true })).toHaveCount(0);

    await name.click();
    await expect(page.getByRole('heading', { name: 'Historique des bilans' })).toBeVisible();
    await expect(page.getByText('Bilan initial').first()).toBeVisible();
    await expect(page.getByText('1 octobre 2026').first()).toBeVisible();
    await expect(page.getByText('Brouillon non terminé')).toHaveCount(0);
    await expect(page.getByText('Rééval. À venir')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Réévaluation 1 clic' })).toBeVisible();
  });
});
