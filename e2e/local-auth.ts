import { expect, type Page } from '@playwright/test';

/** Register through the Local Mode UI, retaining the current URL for invitation flows. */
export async function registerLocal(page: Page, username: string, {
  navigate = true,
  password = 'Haven-Strong-Pass-2026',
}: { navigate?: boolean; password?: string } = {}) {
  if (navigate) await page.goto('/');
  await page.getByRole('button', { name: 'Join Haven', exact: true }).click();
  await page.getByLabel('DISPLAY NAME', { exact: true }).fill(username);
  await page.getByLabel('USERNAME', { exact: true }).fill(username);
  await page.getByLabel('PASSWORD', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create your account', exact: true }).click();
  await expect(page.locator('.my-profile')).toContainText(username);
}
