/**
 * Admin panel: official catalogue, users, AI monitoring. The test account is shown
 * as admin (practitioners.is_admin, admin_check) and every admin RPC is simulated:
 * the recette reads nothing from other accounts and changes nothing.
 */

import type { Route } from '@playwright/test';
import { expect, test, type App } from '../fixtures';

const TEST_ID = '00000000-0000-4000-8000-000000000001';
const USER_ID = '00000000-0000-4000-8000-000000000002';

const subtest = {
  id: '00000000-0000-4000-8000-000000000003',
  test_id: TEST_ID,
  name: 'Vitesse',
  score_type: 'z',
  input_model: 'numeric_4mode',
  display_order: 0,
};
const user = {
  user_id: USER_ID,
  email: 'praticienne.fictive@example.test',
  first_name: 'Claire',
  last_name: 'FICTIF',
  is_admin: false,
  credits: 12,
  organization_id: null,
  organization_name: null,
  organization_role: null,
  subscription_plan: 'essential',
  subscription_status: 'active',
  trial_ends_at: null,
  current_period_end: null,
  monthly_extraction_quota: 20,
  created_at: '2026-09-01T09:00:00Z',
};

const json = (body: unknown) => (route: Route) => route.fulfill({ json: body });

/** Simulates admin rights and the admin RPCs; returns the bodies the app sent to the writing RPCs. */
const asAdmin = async (app: App) => {
  const writes: Record<string, unknown> = {};
  await app.mock(/\/rest\/v1\/practitioners\?select=[^&]*is_admin/, async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    const admin = (row: Record<string, unknown>) => ({ ...row, is_admin: true });
    await route.fulfill({ response, json: Array.isArray(body) ? body.map(admin) : admin(body) });
  });
  await app.mock(/\/rpc\/admin_check\b/, json(true));
  await app.mock(/\/official_categories\b/, json([{ id: 'graphisme', label: 'Graphisme' }]));
  await app.mock(
    /\/rpc\/admin_list_tests\b/,
    json([{ id: TEST_ID, name: 'Test recette FICTIF', category_id: 'graphisme', created_at: '2026-09-01T09:00:00Z', subtest_count: 1 }]),
  );
  await app.mock(
    /\/rpc\/admin_get_test_detail\b/,
    json({ test: { id: TEST_ID, name: 'Test recette FICTIF', category_id: 'graphisme', version: '1' }, subtests: [subtest] }),
  );
  await app.mock(/\/rpc\/admin_list_users\b/, json([user]));
  await app.mock(
    /\/rpc\/admin_get_ai_health_stats\b/,
    json({ daily: [{ date: '2026-09-30', requests: 40, errors: 2 }], total_requests: 40, total_errors: 2, error_rate_pct: 5 }),
  );
  for (const rpc of ['admin_save_test_detail', 'admin_update_user']) {
    await app.mock(new RegExp(`/rpc/${rpc}\\b`), async (route) => {
      writes[rpc] = route.request().postDataJSON();
      await route.fulfill({ json: rpc === 'admin_update_user' ? { ok: true, user_id: USER_ID } : null });
    });
  }
  return writes;
};

test.describe('Administration', { tag: '@admin' }, () => {
  test('catalogue, utilisateurs et supervision', async ({ app, page }) => {
    const writes = await asAdmin(app);
    await app.open();
    await page.getByRole('button', { name: 'Menu du compte' }).click();
    await page.getByRole('button', { name: 'Admin' }).click();
    await expect(page.getByText('Mode Super-Admin')).toBeVisible();

    // Catalogue officiel: open a test, rename its subtest, save.
    await page.getByRole('button', { name: /Test recette FICTIF/ }).click();
    await expect(page.getByRole('heading', { name: 'Test recette FICTIF' })).toBeVisible();
    await page.getByPlaceholder('Nom *').first().fill('Vitesse d’écriture');
    await page.getByRole('button', { name: 'Sauvegarder' }).first().click();
    await expect(page.getByText('Test sauvegardé.')).toBeVisible();
    expect(JSON.stringify(writes.admin_save_test_detail)).toContain('Vitesse d’écriture');

    // Utilisateurs: change the credits of a user, save.
    await page.getByRole('button', { name: 'Utilisateurs' }).click();
    await expect(page.getByText(user.email)).toBeVisible();
    await page.locator('input[type=number]').first().fill('30');
    await page.getByRole('button', { name: 'Enregistrer' }).first().click();
    await expect(page.getByText('Utilisateur mis à jour.')).toBeVisible();
    expect(writes.admin_update_user).toMatchObject({ p_user_id: USER_ID, p_credits: 30 });

    // Ops & Monitoring: the AI health figures.
    await page.getByRole('button', { name: 'Ops & Monitoring' }).click();
    await expect(page.getByRole('heading', { name: 'Supervision Technique & IA' })).toBeVisible();
    await expect(page.getByText('40').first()).toBeVisible();

    await page.getByRole('button', { name: 'Fermer Session' }).click();
    await expect(page.getByRole('heading', { name: 'Patients suivis' })).toBeVisible();
  });

  test('sans les droits, le serveur refuse l’accès', async ({ app, page }) => {
    await asAdmin(app);
    await app.mock(/\/rpc\/admin_check\b/, json(false));
    await app.open();
    await page.getByRole('button', { name: 'Menu du compte' }).click();
    await page.getByRole('button', { name: 'Admin' }).click();
    await expect(page.getByText('Accès refusé par le serveur.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Patients suivis' })).toBeVisible();
  });
});
