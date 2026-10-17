import { test, expect } from '@playwright/test';

test('existing account signs in through the form with a copied username and retains its session', async ({ page }) => {
  const username = `return.user-${Date.now().toString(36)}`;
  const password = 'Returning-Account-2026';
  const created = await page.request.post('/api/auth/register', { data: { username, password, displayName: 'Returning member' } });
  expect(created.status()).toBe(201);
  const userId = (await created.json()).user.id;
  await page.request.post('/api/auth/logout');
  await page.goto('/');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByText('A separately started localhost:3001 server has a different account database.', { exact: false })).toBeVisible();
  await page.getByLabel('USERNAME', { exact: true }).fill(` @${username.toUpperCase()} `);
  await page.getByLabel('PASSWORD', { exact: true }).fill('wrong-password');
  await page.locator('.auth-form form button.primary').click();
  await expect(page.getByRole('alert')).toContainText('Invalid username or password', { timeout: 4000 });
  await page.getByLabel('PASSWORD', { exact: true }).fill(password);
  const login = page.waitForResponse(response => response.url().endsWith('/api/auth/login') && response.request().method() === 'POST');
  await page.locator('.auth-form form button.primary').click();
  expect((await login).status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Better, together.' })).toBeVisible();
  expect((await (await page.request.get('/api/auth/me')).json()).user.id).toBe(userId);
  await page.reload();
  await expect(page.locator('.my-profile')).toContainText('Returning member');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Sign out', exact: false }).click();
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByLabel('USERNAME', { exact: true }).fill(username);
  await page.getByLabel('PASSWORD', { exact: true }).fill(password);
  await page.locator('.auth-form form button.primary').click();
  await expect(page.locator('.my-profile')).toContainText('Returning member');
});

test('registration accepts the same dotted and hyphenated usernames as the server', async ({ page }) => {
  const username = `new.user-${Date.now().toString(36)}`;
  await page.goto('/');
  await page.getByLabel('DISPLAY NAME', { exact: true }).fill('New member');
  await page.getByLabel('USERNAME', { exact: true }).fill(username);
  await page.getByLabel('PASSWORD', { exact: true }).fill('New-Account-2026');
  await page.getByRole('button', { name: 'Create your account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Better, together.' })).toBeVisible();
  expect((await (await page.request.get('/api/auth/me')).json()).user.username).toBe(username);
});
