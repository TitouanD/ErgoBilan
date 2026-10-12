/**
 * Custom test: created from the catalogue, then added to the assessment (scenario
 * `initial-scores`). The RPC `practitioner_save_custom_test` is simulated; the reloaded
 * catalogue is the real one plus the new test, as the database would return it.
 */

import { expect, test } from '../fixtures';

const TEST_ID = '00000000-0000-4000-8000-0000000000aa';

test.describe('Test personnalisé', { tag: ['@initial', '@test-perso'] }, () => {
  test('créer un test personnalisé et l’ajouter au bilan', async ({ app, page }) => {
    let saved: { payload: { test: Record<string, unknown>; subtests: Array<Record<string, unknown>> } } | null = null;
    await app.mock(/\/rpc\/practitioner_save_custom_test\b/, async (route) => {
      saved = route.request().postDataJSON();
      await route.fulfill({ json: null });
    });
    await app.mock(/\/rest\/v1\/view_unified_(catalog|subtests)\b/, async (route) => {
      const response = await route.fetch();
      const rows = (await response.json()) as unknown[];
      if (!saved) return route.fulfill({ response, json: rows });
      const added = route.request().url().includes('view_unified_catalog')
        ? [{ id: TEST_ID, label: 'Batterie recette', category_id: 'autre', category_label: 'Autre', icon_key: null, sort_order: 999 }]
        : saved.payload.subtests.map((s, i) => ({
            id: `${TEST_ID.slice(0, -2)}b${i}`,
            test_id: TEST_ID,
            name: s.name,
            unit: null,
            score_type: s.score_type,
            input_model: 'numeric_4mode',
            input_config: null,
            display_group_order: null,
            display_order: i,
          }));
      await route.fulfill({ response, json: [...rows, ...added] });
    });

    await app.open('scenario=initial-scores');
    await page.getByRole('button', { name: 'Ajouter', exact: true }).first().click();
    await expect(page.getByRole('heading', { name: 'Catalogue tests' })).toBeVisible();
    await page.getByRole('button', { name: 'Créer un test' }).click();
    await expect(page.getByRole('heading', { name: 'Créer un test personnalisé' })).toBeVisible();

    const create = page.getByRole('button', { name: 'Créer le test' });
    await expect(create).toBeDisabled();
    await page.getByPlaceholder('ex : Batterie maison de coordination').fill('Batterie recette');
    await page.getByPlaceholder('ex : BMC').fill('BR');
    await page.getByPlaceholder("Nom de l'épreuve *").first().fill('Lancer de balle');
    await create.click();
    await expect(page.getByText('Test « Batterie recette » créé avec succès !')).toBeVisible();
    expect(saved!.payload).toMatchObject({
      test: { name: 'Batterie recette', abbreviation: 'BR', category_id: 'autre' },
      subtests: [{ name: 'Lancer de balle', order_index: 0 }],
    });

    await page.getByPlaceholder('Rechercher un test ou un sous-test...').fill('Batterie recette');
    await page.getByRole('button', { name: /^Batterie recette/ }).click();
    await page.getByLabel('Lancer de balle', { exact: true }).check();
    await page.getByRole('button', { name: 'Ajouter', exact: true }).last().click();
    await expect(page.getByRole('heading', { name: 'Catalogue tests' })).toBeHidden();
    await expect(page.getByText('Lancer de balle').first()).toBeVisible();
  });
});
