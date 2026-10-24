import { expect, type Page } from '@playwright/test';

export async function expectCleanProductUI(page: Page) {
  await expect(page.getByRole('button', { name: /Test with another|Open isolated test client|Open browser client|Connect to a Haven host|Switch desktop to invite host|Copy backend URL|connection & testing/i })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: /HAVEN BACKEND URL|HOST ADDRESS|Current Haven host/i })).toHaveCount(0);
  await expect(page.locator('.client-tools-entry,.connection-settings,.server-switcher,.foreign-invite,.raw-statistics')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText(/Supabase Mumbai|Development server|Hosted server type|Test client|Debug connection/i);
}
