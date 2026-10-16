import { test, expect, type Page } from '@playwright/test';
import type { Bootstrap, ServerEmoji } from '../shared/types';

const animatedGif = Buffer.from('47494638396101000100800000000000ffffff21ff0b4e45545343415045322e30030100000021f904000a0000002c000000000100010000020244010021f904000a0000002c00000000010001000002024c01003b', 'hex');

async function register(page: Page, name: string) {
  await page.goto('/');
  await page.getByLabel('DISPLAY NAME', { exact: true }).fill(name);
  await page.getByLabel('USERNAME', { exact: true }).fill(name);
  await page.getByLabel('PASSWORD', { exact: true }).fill('Haven-Custom-Emoji-2026');
  await page.getByRole('button', { name: 'Create your account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Better, together.', exact: true })).toBeVisible();
}

async function bootstrap(page: Page): Promise<Bootstrap> {
  const response = await page.request.get('/api/bootstrap'); expect(response.ok()).toBe(true); return response.json();
}

test('custom static and animated emoji upload, sync, picker, reactions, rename and deletion across clients', async ({ page, browser }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const unique = Date.now().toString(36);
  await register(page, `emojia${unique}`);
  const staticPng = Buffer.from(await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 32; const drawing = canvas.getContext('2d')!; drawing.fillStyle = '#99aaff'; drawing.fillRect(0, 0, 32, 32); return canvas.toDataURL('image/png').split(',')[1]; }), 'base64');
  await page.getByRole('button', { name: 'Create a server', exact: true }).first().click();
  await page.getByLabel('SERVER NAME', { exact: true }).fill(`Emoji lab ${unique}`);
  await page.getByRole('button', { name: 'Create server', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Welcome to #general', exact: true })).toBeVisible();
  const server = (await bootstrap(page)).servers[0];
  const inviteResponse = await page.request.post(`/api/servers/${server.id}/invites`);
  const invite = (await inviteResponse.json()).code;
  const context = await browser.newContext();
  try {
    const guest = await context.newPage(); guest.on('pageerror', error => errors.push(error.message));
    await register(guest, `emojib${unique}`);
    expect((await guest.request.post(`/api/invites/${invite}/join`)).ok()).toBe(true);
    await guest.reload();
    await guest.getByRole('button', { name: server.name, exact: true }).click();
    await expect(guest.getByRole('heading', { name: 'Welcome to #general', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Server options', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Emoji', exact: true }).click();
    await page.getByLabel('New emoji name', { exact: true }).fill('tiny_static');
    await page.getByLabel('Emoji image', { exact: true }).setInputFiles({ name: 'static.png', mimeType: 'image/png', buffer: staticPng });
    await page.getByRole('button', { name: 'Upload emoji', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Rename emoji tiny_static', exact: true })).toBeVisible();
    await page.getByLabel('New emoji name', { exact: true }).fill('tiny_dance');
    await page.getByLabel('Emoji image', { exact: true }).setInputFiles({ name: 'dance.gif', mimeType: 'image/gif', buffer: animatedGif });
    await page.getByRole('button', { name: 'Upload emoji', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Rename emoji tiny_dance', exact: true })).toBeVisible();
    const emojis = (await bootstrap(page)).serverEmojis;
    const dancing = emojis.find(emoji => emoji.name === 'tiny_dance') as ServerEmoji;
    expect(dancing.animated).toBe(true);
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await guest.getByRole('button', { name: 'Emoji', exact: true }).click();
    await guest.getByLabel('Search emoji', { exact: true }).fill('tiny');
    await expect(guest.getByRole('button', { name: ':tiny_static:', exact: true })).toBeVisible();
    await guest.getByRole('button', { name: ':tiny_dance: (animated)', exact: true }).click();
    await guest.getByRole('button', { name: 'Send message', exact: true }).click();
    const ownerEmoji = page.locator('.message-text .custom-emoji').filter({ has: page.locator('img') }).first();
    await expect(ownerEmoji).toHaveAttribute('aria-label', 'tiny_dance');
    await expect(ownerEmoji.locator('img')).toHaveAttribute('src', dancing.url);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(ownerEmoji.locator('img')).toHaveAttribute('src', dancing.staticUrl);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await expect(ownerEmoji.locator('img')).toHaveAttribute('src', dancing.url);
    await page.getByRole('button', { name: 'User settings', exact: true }).click();
    await page.getByRole('button', { name: 'desktop & gaming', exact: true }).click();
    await page.getByLabel('Low-resource gaming mode', { exact: true }).check();
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await expect(ownerEmoji.locator('img')).toHaveAttribute('src', dancing.staticUrl);
    await page.locator('.message').first().hover();
    await page.getByRole('button', { name: 'Add reaction', exact: true }).first().click();
    await page.getByRole('button', { name: ':tiny_static:', exact: true }).click();
    await expect(guest.locator('.reactions .custom-emoji[aria-label="tiny_static"]')).toBeVisible();
    await page.getByRole('button', { name: 'Server options', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Emoji', exact: true }).click();
    await page.getByRole('button', { name: 'Rename emoji tiny_dance', exact: true }).click();
    await page.getByLabel('Rename tiny_dance', { exact: true }).fill('victory');
    await page.getByRole('button', { name: 'Save name', exact: true }).click();
    await expect(guest.locator('.message-text .custom-emoji')).toHaveAttribute('aria-label', 'victory');
    await page.getByRole('button', { name: 'Delete emoji victory', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm delete emoji victory', exact: true }).click();
    await expect(guest.locator('.message-text .custom-emoji')).toHaveCount(0);
    await expect(guest.locator('.message-text')).toContainText(`:hvn_${dancing.id}:`);
    const forbidden = await guest.request.post(`/api/servers/${server.id}/emojis`, { multipart: { name: 'forbidden', file: { name: 'a.png', mimeType: 'image/png', buffer: staticPng } } });
    expect(forbidden.status()).toBe(403);
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});
