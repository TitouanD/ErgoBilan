/** Locators shared by the recette specs (the app has no test ids). */

import type { Locator, Page } from '@playwright/test';

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
