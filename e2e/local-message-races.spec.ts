import { test, expect, type Page, type APIRequestContext } from '@playwright/test';

async function fixture(page: Page, request: APIRequestContext) {
  const unique = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const username = `race${unique}`;
  const password = 'Local-regression-2026!';
  expect((await page.request.post('/api/auth/register', { data: { username, displayName: username, password } })).ok()).toBe(true);
  const otherName = `peer${unique}`;
  expect((await request.post('/api/auth/register', { data: { username: otherName, displayName: otherName, password } })).ok()).toBe(true);
  const other = (await (await request.get('/api/auth/me')).json()).user;
  await page.request.post('/api/friends/requests', { data: { username: otherName } });
  const incoming = (await (await request.get('/api/bootstrap')).json()).requests[0];
  expect((await request.post(`/api/friends/requests/${incoming.id}/accept`)).ok()).toBe(true);
  expect((await page.request.post('/api/conversations', { data: { memberIds: [other.id] } })).ok()).toBe(true);
  const server = (await (await page.request.post('/api/servers', { data: { name: `Race lab ${unique}` } })).json()).server;
  expect((await page.request.post(`/api/servers/${server.id}/channels`, { data: { name: 'second', type: 'text' } })).ok()).toBe(true);
  await page.goto('/');
  const choose = async (destination: string) => {
    if (destination === 'dm') {
      await page.getByRole('button', { name: 'Home', exact: true }).click();
      await page.locator('.dm-row').filter({ hasText: otherName }).click();
    } else {
      await page.getByRole('button', { name: server.name, exact: true }).click();
      await page.getByRole('button', { name: destination, exact: true }).click();
    }
    await expect(page.locator('.loading-messages')).toHaveCount(0);
  };
  return { choose };
}

for (const [origin, destination] of [['general', 'second'], ['general', 'dm'], ['dm', 'general']]) {
  test(`late ${origin} send cannot contaminate ${destination} or clear its draft`, async ({ page, request }) => {
    const { choose } = await fixture(page, request);
    await choose(origin);
    let release!: () => void;
    let sent!: (body: any) => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const saved = new Promise<any>(resolve => { sent = resolve; });
    await page.route('**/api/messages', async route => {
      if (route.request().method() !== 'POST') return route.continue();
      const response = await route.fetch();
      sent(await response.json());
      await held;
      await route.fulfill({ response });
    });
    const content = `Delayed ${origin} to ${destination}`;
    try {
      await page.getByRole('textbox', { name: 'Message', exact: true }).fill(content);
      await page.getByRole('button', { name: 'Send message', exact: true }).click();
      await saved;
      await expect(page.locator('.message-text').filter({ hasText: content })).toHaveCount(1);
      await choose(destination);
      await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Keep this new destination draft');
      const returned = page.waitForResponse(response => response.url().endsWith('/api/messages') && response.request().method() === 'POST');
      release();
      await returned;
      await page.waitForTimeout(150);
      await expect(page.locator('.message-text').filter({ hasText: content })).toHaveCount(0);
      await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('Keep this new destination draft');
      await choose(origin);
      await expect(page.locator('.message-text').filter({ hasText: content })).toHaveCount(1);
    } finally { release(); await page.unrouteAll({ behavior: 'wait' }); }
  });
}

for (const navigate of [false, true]) test(`late send never resurrects a realtime deletion (navigate: ${navigate})`, async ({ page, request }) => {
  const { choose } = await fixture(page, request);
  await choose('general');
  let release!: () => void;
  let sent!: (body: any) => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const saved = new Promise<any>(resolve => { sent = resolve; });
  await page.route('**/api/messages', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    const response = await route.fetch(); sent(await response.json()); await held; await route.fulfill({ response });
  });
  try {
    await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Delete before send acknowledgement');
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    const { message } = await saved;
    await expect(page.locator('.message-text')).toHaveCount(1);
    expect((await page.request.delete(`/api/messages/${message.id}`)).ok()).toBe(true);
    await expect(page.locator('.message-text')).toHaveCount(0);
    if (navigate) { await choose('dm'); await choose('second'); await choose('general'); }
    const returned = page.waitForResponse(response => response.url().endsWith('/api/messages') && response.request().method() === 'POST');
    release(); await returned; await page.waitForTimeout(150);
    await expect(page.locator('.message-text')).toHaveCount(0);
  } finally { release(); await page.unrouteAll({ behavior: 'wait' }); }
});


test('send acknowledgement preserves a newer realtime edit without duplicating the message', async ({ page, request }) => {
  const { choose } = await fixture(page, request);
  await choose('general');
  let release!: () => void;
  let sent!: (body: any) => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const saved = new Promise<any>(resolve => { sent = resolve; });
  await page.route('**/api/messages', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    const response = await route.fetch(); sent(await response.json()); await held; await route.fulfill({ response });
  });
  try {
    await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Original pending acknowledgement');
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    const { message } = await saved;
    await expect(page.locator('.message-text')).toHaveCount(1);
    expect((await page.request.patch(`/api/messages/${message.id}`, { data: { content: 'Newer realtime edit' } })).ok()).toBe(true);
    await expect(page.locator('.message-text')).toContainText('Newer realtime edit');
    const returned = page.waitForResponse(response => response.url().endsWith('/api/messages') && response.request().method() === 'POST');
    release(); await returned; await page.waitForTimeout(150);
    await expect(page.locator('.message-text')).toHaveCount(1);
    await expect(page.locator('.message-text')).toContainText('Newer realtime edit');
  } finally { release(); await page.unrouteAll({ behavior: 'wait' }); }
});
