import { test, expect, type Page } from '@playwright/test';

async function settings(page: Page) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'desktop & gaming', exact: true }).click();
}

test('animated messages and reactions respect persisted motion, gaming and notification settings', async ({ page, browser }) => {
  const username = `emoji${Date.now().toString(36)}`;
  await page.addInitScript(() => {
    const state = window as unknown as { __havenNotifications: string[]; __havenHidden: boolean };
    state.__havenNotifications = []; state.__havenHidden = false;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => state.__havenHidden });
    Object.defineProperty(window, 'Notification', { configurable: true, value: class {
      static permission = 'granted';
      static requestPermission = async () => 'granted';
      constructor(title: string) { state.__havenNotifications.push(title); }
    } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Join Haven', exact: true }).click();
  await page.getByLabel('DISPLAY NAME', { exact: true }).fill(username);
  await page.getByLabel('USERNAME', { exact: true }).fill(username);
  await page.getByLabel('PASSWORD', { exact: true }).fill('Haven-Emoji-2026');
  await page.getByRole('button', { name: 'Create your account', exact: true }).click();
  await page.getByRole('button', { name: 'Create a server', exact: true }).first().click();
  await page.getByLabel('SERVER NAME').fill(`Emoji lab ${username}`);
  await page.getByRole('button', { name: 'Create server', exact: true }).click();
  await page.getByRole('button', { name: 'Emoji', exact: true }).click();
  await page.getByRole('button', { name: 'Waving hello (animated)', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue(':haven_wave:');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  const message = page.locator('article.message').filter({ has: page.locator('[data-emoji=":haven_wave:"]') });
  const wave = message.locator('.message-text [data-emoji=":haven_wave:"]');
  await expect(wave).toHaveClass(/is-animated/);
  await expect(wave).toHaveAttribute('aria-label', 'Waving hello');
  await expect(wave.locator('svg')).toBeVisible();
  await expect.poll(() => wave.locator('g.emoji-motion').evaluate(element => getComputedStyle(element).animationName)).toBe('haven-emoji-wave');
  await message.hover();
  await message.getByRole('button', { name: 'Add reaction', exact: true }).click();
  await page.getByRole('button', { name: 'Heart beat (animated)', exact: true }).click();
  const heart = message.locator('.reactions [data-emoji=":haven_heart:"]');
  await expect(heart).toHaveClass(/is-animated/);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(wave).not.toHaveClass(/is-animated/);
  await expect(heart).not.toHaveClass(/is-animated/);
  await expect(wave.locator('g.emoji-motion')).toHaveCSS('animation-name', 'none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(wave).toHaveClass(/is-animated/);
  await settings(page);
  await page.getByRole('switch', { name: /^Animate emoji/ }).uncheck();
  await page.getByRole('button', { name: 'notifications', exact: true }).click();
  await page.getByRole('switch', { name: /^Desktop notifications/ }).uncheck();
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(wave).not.toHaveClass(/is-animated/);
  await page.reload();
  await expect(wave).toBeVisible();
  await expect(wave).not.toHaveClass(/is-animated/);
  await expect(heart).not.toHaveClass(/is-animated/);
  await settings(page);
  await expect(page.getByRole('switch', { name: /^Animate emoji/ })).not.toBeChecked();
  await page.getByRole('switch', { name: /^Animate emoji/ }).check();
  await page.getByRole('switch', { name: /^Low-resource gaming mode/ }).check();
  await expect(page.getByText('Global shortcuts, tray and startup controls require Haven Desktop.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(wave).not.toHaveClass(/is-animated/);
  await page.reload();
  await settings(page);
  await expect(page.getByRole('switch', { name: /^Low-resource gaming mode/ })).toBeChecked();
  await page.getByRole('switch', { name: /^Low-resource gaming mode/ }).uncheck();
  await page.getByRole('button', { name: 'notifications', exact: true }).click();
  await expect(page.getByRole('switch', { name: /^Desktop notifications/ })).not.toBeChecked();
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(wave).toHaveClass(/is-animated/);
  await expect(heart).toHaveClass(/is-animated/);
  const response = await page.request.get('/api/bootstrap');
  expect(response.ok()).toBe(true);
  const boot = await response.json();
  const invite = await page.request.post(`/api/servers/${boot.servers[0].id}/invites`, { data: {} });
  expect(invite.ok()).toBe(true);
  const { code } = await invite.json();
  const createdChannel = await page.request.post(`/api/servers/${boot.servers[0].id}/channels`, { data: { name: 'notification-lab', type: 'text' } });
  expect(createdChannel.ok()).toBe(true);
  const { channel } = await createdChannel.json();
  const otherContext = await browser.newContext({ baseURL: new URL(page.url()).origin });
  try {
    expect((await otherContext.request.post('/api/auth/register', { data: { username: `${username}b`, password: 'Haven-Emoji-2026' } })).ok()).toBe(true);
    expect((await otherContext.request.post(`/api/invites/${code}/join`, { data: {} })).ok()).toBe(true);
    await page.evaluate(() => {
      (window as unknown as { __havenHidden: boolean }).__havenHidden = true;
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(wave).not.toHaveClass(/is-animated/);
    expect((await otherContext.request.post('/api/messages', { data: { channelId: channel.id, content: 'Notifications disabled' } })).ok()).toBe(true);
    await expect(page.locator('.channel-row').filter({ hasText: 'notification-lab' })).toContainText('1');
    expect(await page.evaluate(() => (window as unknown as { __havenNotifications: string[] }).__havenNotifications.length)).toBe(0);
    await page.evaluate(() => {
      (window as unknown as { __havenHidden: boolean }).__havenHidden = false;
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await settings(page);
    await page.getByRole('button', { name: 'notifications', exact: true }).click();
    await page.getByRole('switch', { name: /^Desktop notifications/ }).check();
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await page.evaluate(() => {
      (window as unknown as { __havenHidden: boolean }).__havenHidden = true;
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect((await otherContext.request.post('/api/messages', { data: { channelId: channel.id, content: 'Notifications enabled' } })).ok()).toBe(true);
    await expect.poll(() => page.evaluate(() => (window as unknown as { __havenNotifications: string[] }).__havenNotifications.length)).toBe(1);
    await page.evaluate(() => {
      (window as unknown as { __havenHidden: boolean }).__havenHidden = false;
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(wave).toHaveClass(/is-animated/);
  } finally { await otherContext.close(); }
});
