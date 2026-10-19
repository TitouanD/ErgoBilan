/** Locators shared by the recette specs (the app has no test ids). */

import type { Locator, Page } from '@playwright/test';
import type { App } from './fixtures';

/** Dashboard card of a patient (the clickable block of Dashboard.tsx). */
export const patientCard = (page: Page, fullName: string): Locator =>
  page.locator('div.group.cursor-pointer.rounded-2xl').filter({ has: page.getByRole('heading', { name: fullName, exact: true }) });

/** Opens a patient record from the dashboard. */
export const openPatient = async (page: Page, fullName: string) => {
  await page.getByRole('heading', { name: fullName, exact: true }).click();
  await page.getByRole('heading', { name: 'Historique des bilans' }).waitFor();
};

/** Back to the dashboard from a patient record. */
export const backToDashboard = (page: Page) => page.getByRole('button', { name: 'Retour Dashboard' }).click();

/**
 * Fills a debounced field and leaves it, so its value reaches the state at once.
 * Held by its element: some placeholders change once the field is filled.
 */
export const fillField = async (field: Locator, value: string) => {
  const handle = (await field.elementHandle())!;
  await handle.fill(value);
  await handle.evaluate((el: HTMLElement) => el.blur());
};

/**
 * Fixes the balance read from the test account (practitioners row), so a visual reference does not
 * depend on the credits the real account holds that day (header pill, subscription banner).
 */
export const fixedCredits = async (app: App, credits = 5) => {
  await app.mock(/\/rest\/v1\/practitioners\?select=[^&]*credits/, async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    const fixed = (row: Record<string, unknown>) => ({ ...row, credits, monthly_credits: 0 });
    await route.fulfill({ response, json: Array.isArray(body) ? body.map(fixed) : fixed(body) });
  });
};
