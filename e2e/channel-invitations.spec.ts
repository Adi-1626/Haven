import { test, expect, type Page, type Browser } from '@playwright/test';
import { randomUUID } from 'node:crypto';

async function account(page: Page) {
  const response = await page.request.post('/api/auth/register', { data: { username: `invite_${randomUUID().slice(0, 8)}`, password: 'Invitation-QA-2026' } });
  expect(response.status()).toBe(201);
  return (await response.json()).user;
}
async function fixture(page: Page) {
  const user = await account(page);
  const server = (await (await page.request.post('/api/servers', { data: { name: 'Invitation QA' } })).json()).server;
  const second = (await (await page.request.post('/api/servers', { data: { name: 'Second QA' } })).json()).server;
  const invitation = await (await page.request.post(`/api/servers/${server.id}/invites`, { data: { expiresInHours: null } })).json();
  await page.goto('/');
  await page.getByRole('button', { name: server.name, exact: true }).click();
  return { user, server, second, invitation };
}
const openCreate = (page: Page) => page.getByRole('button', { name: 'Create channel', exact: true }).click();
const openInvites = (page: Page) => page.getByRole('button', { name: 'Invite people', exact: true }).click();
async function switchSecond(page: Page) {
  await page.keyboard.press('Control+k');
  await page.getByLabel('Find a conversation').fill('Second QA');
  await page.locator('.quick-results button').first().click();
}

test('voice plus creates voice; text CRUD propagates between real clients and duplicate submits are suppressed', async ({ page, browser }) => {
  const f = await fixture(page);
  const context = await browser.newContext();
  try {
    const member = await context.newPage(); await account(member);
    expect((await member.request.post(`/api/invites/${f.invitation.code}/join`)).status()).toBe(200);
    await member.goto('/'); await member.getByRole('button', { name: f.server.name, exact: true }).click();
    await expect(member.getByRole('button', { name: 'Create channel', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Create voice channel', exact: true }).click();
    await expect(page.getByRole('radio', { name: /Voice/ })).toHaveAttribute('aria-checked', 'true');
    await page.getByLabel('CHANNEL NAME', { exact: true }).fill('voice-regression');
    await page.locator('.zenith-channel-modal button[type=submit]').click();
    await expect(member.getByRole('button', { name: 'voice-regression', exact: true })).toBeVisible();
    const boot = await (await page.request.get('/api/bootstrap')).json();
    expect(boot.channels.find((channel: any) => channel.name === 'voice-regression').type).toBe('voice');
    await openCreate(page);
    await page.getByLabel('CHANNEL NAME', { exact: true }).fill('text-regression');
    let requests = 0;
    page.on('request', request => { if (request.url().endsWith(`/servers/${f.server.id}/channels`) && request.method() === 'POST') requests++; });
    await page.locator('.zenith-channel-modal form').evaluate(form => { (form as HTMLFormElement).requestSubmit(); (form as HTMLFormElement).requestSubmit(); });
    await expect(member.getByRole('button', { name: 'text-regression', exact: true })).toBeVisible();
    expect(requests).toBe(1);
    await page.getByTitle('Edit text-regression', { exact: true }).click();
    await page.getByLabel('CHANNEL NAME', { exact: true }).fill('renamed-regression');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(member.getByRole('button', { name: 'renamed-regression', exact: true })).toBeVisible();
    await page.getByTitle('Edit renamed-regression', { exact: true }).click();
    await page.getByRole('button', { name: 'Delete channel', exact: true }).click();
    await page.getByRole('alertdialog', { name: 'Delete channel', exact: true }).getByRole('button', { name: 'Delete channel', exact: true }).click();
    await expect(member.getByRole('button', { name: 'renamed-regression', exact: true })).toHaveCount(0);
  } finally { await context.close(); }
});

test('channel delete failures recover; HTML success responses keep the form and never auto-replay writes', async ({ page }) => {
  await fixture(page);
  await page.getByTitle('Edit general', { exact: true }).click();
  await page.route('**/api/channels/*', route => route.request().method() === 'DELETE'
    ? route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"QA unavailable"}' }) : route.continue());
  await page.getByRole('button', { name: 'Delete channel', exact: true }).click();
  const confirmation = page.getByRole('alertdialog', { name: 'Delete channel', exact: true });
  await confirmation.getByRole('button', { name: 'Delete channel', exact: true }).click();
  await expect(confirmation.getByRole('alert')).toContainText('temporarily unavailable');
  await expect(confirmation.getByRole('button', { name: 'Delete channel', exact: true })).toBeEnabled();
  await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('.zenith-channel-modal [role=alert]')).toContainText('temporarily unavailable');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.unroute('**/api/channels/*');
  let attempts = 0;
  await page.route('**/api/servers/*/channels', async route => {
    attempts++;
    if (attempts === 1) await route.fulfill({ contentType: 'text/html', body: '<title>Starting your app - Voroa</title>' });
    else await route.continue();
  });
  await openCreate(page); await page.getByLabel('CHANNEL NAME', { exact: true }).fill('cold-start-retry');
  await page.locator('.zenith-channel-modal button[type=submit]').click();
  await expect(page.locator('.zenith-channel-modal [role=alert]')).toContainText('temporarily unavailable');
  expect(attempts).toBe(1);
  await page.locator('.zenith-channel-modal button[type=submit]').click();
  await expect(page.getByRole('button', { name: 'cold-start-retry', exact: true })).toBeVisible();
  expect(attempts).toBe(2);
});

test('closing an in-flight channel operation cannot close a newer dialog, including another channel dialog', async ({ page }) => {
  await fixture(page);
  for (const next of ['settings', 'channel']) {
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    await page.route('**/api/servers/*/channels', async route => { entered(); await gate; await route.continue(); });
    await openCreate(page); await page.getByLabel('CHANNEL NAME', { exact: true }).fill(`delayed-${next}`);
    await page.locator('.zenith-channel-modal button[type=submit]').click(); await started;
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
    if (next === 'settings') await page.getByRole('button', { name: 'Server options', exact: true }).click();
    else { await openCreate(page); await page.getByLabel('CHANNEL NAME', { exact: true }).fill('keep-this-draft'); }
    const response = page.waitForResponse(response => response.url().includes('/channels') && response.request().method() === 'POST');
    release(); await response;
    await expect(page.getByRole('dialog')).toBeVisible();
    if (next === 'channel') await expect(page.getByLabel('CHANNEL NAME', { exact: true })).toHaveValue('keep-this-draft');
    else await expect(page.getByRole('dialog')).toHaveAttribute('aria-label', 'Community settings');
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await page.unroute('**/api/servers/*/channels');
  }
});

test('server switches discard old invitation reads and in-flight creation results', async ({ page }) => {
  const f = await fixture(page);
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  await page.route(`**/api/servers/${f.server.id}/invites`, async route => {
    const response = await route.fetch(); entered(); await gate; await route.fulfill({ response });
  });
  await openInvites(page); await started; await switchSecond(page);
  await expect(page.locator('.zenith-modal-heading')).toContainText('Second QA');
  release(); await expect(page.getByLabel('Invitation link', { exact: true })).toHaveCount(0);
  await page.unroute(`**/api/servers/${f.server.id}/invites`);
  await page.getByRole('button', { name: 'Create invitation', exact: true }).click();
  await expect(page.getByLabel('Invitation link', { exact: true })).toBeVisible();
  const secondLink = await page.getByLabel('Invitation link', { exact: true }).inputValue();
  expect(secondLink).not.toContain(f.invitation.code);
  await page.keyboard.press('Control+k'); await page.getByLabel('Find a conversation').fill('Invitation QA'); await page.locator('.quick-results button').first().click();
  await expect(page.getByLabel('Invitation link', { exact: true })).toHaveValue(new RegExp(f.invitation.code));
  let releaseCreate!: () => void, enteredCreate!: () => void;
  const createGate = new Promise<void>(resolve => { releaseCreate = resolve; });
  const createStarted = new Promise<void>(resolve => { enteredCreate = resolve; });
  await page.route(`**/api/servers/${f.server.id}/invites`, async route => {
    if (route.request().method() !== 'POST') return route.continue();
    const response = await route.fetch(); enteredCreate(); await createGate; await route.fulfill({ response });
  });
  await page.getByRole('button', { name: 'Create invitation', exact: true }).click(); await createStarted;
  await switchSecond(page); releaseCreate();
  await expect(page.getByLabel('Invitation link', { exact: true })).toHaveValue(secondLink);
});

test('quick switching while editing a channel closes the old server editor', async ({ page }) => {
  await fixture(page);
  await page.getByTitle('Edit general', { exact: true }).click();
  await page.getByLabel('CHANNEL NAME', { exact: true }).fill('unsaved-old-server-draft');
  await switchSecond(page);
  await expect(page.locator('.zenith-channel-modal')).toHaveCount(0);
  await expect(page.locator('.sidebar-header .server-name')).toHaveText('Second QA');
  await page.getByTitle('Edit general', { exact: true }).click();
  await expect(page.getByLabel('CHANNEL NAME', { exact: true })).toHaveValue('general');
});

test('moderator revocation synchronizes across actual clients; members remain permission-gated', async ({ page, browser }) => {
  const f = await fixture(page); const context = await browser.newContext();
  try {
    const other = await context.newPage(); const user = await account(other);
    await other.request.post(`/api/invites/${f.invitation.code}/join`);
    await page.request.patch(`/api/servers/${f.server.id}/members/${user.id}`, { data: { role: 'admin' } });
    await other.goto('/'); await other.getByRole('button', { name: f.server.name, exact: true }).click();
    await openInvites(page); await openInvites(other);
    await expect(other.getByLabel('Invitation link', { exact: true })).toHaveValue(new RegExp(f.invitation.code));
    await page.getByRole('button', { name: `Revoke ${f.invitation.code}`, exact: true }).click();
    await expect(other.getByLabel('Invitation link', { exact: true })).toHaveCount(0);
    await expect(other.getByRole('button', { name: `Revoke ${f.invitation.code}`, exact: true })).toHaveCount(0);
    await page.request.patch(`/api/servers/${f.server.id}/members/${user.id}`, { data: { role: 'member' } });
    await expect(other.locator('.zenith-member-restriction-notice')).toBeVisible();
    expect((await other.request.post(`/api/servers/${f.server.id}/invites`, { data: {} })).status()).toBe(403);
    expect((await other.request.post(`/api/servers/${f.server.id}/channels`, { data: { name: 'forbidden', type: 'text' } })).status()).toBe(403);
  } finally { await context.close(); }
});

test('a delayed successful preview cannot copy an invite already revoked by realtime', async ({ page }) => {
  const f = await fixture(page);
  await page.evaluate(() => {
    (window as any).qaCopies = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => (window as any).qaCopies.push(text) } });
  });
  await openInvites(page);
  await expect(page.getByLabel('Invitation link', { exact: true })).toBeVisible();
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  await page.route(`**/api/invites/${f.invitation.code}`, async route => {
    const response = await route.fetch(); entered(); await gate; await route.fulfill({ response });
  });
  await page.getByRole('button', { name: 'Copy invite link', exact: true }).click(); await started;
  await page.request.delete(`/api/invites/${f.invitation.code}`);
  await expect(page.getByLabel('Invitation link', { exact: true })).toHaveCount(0);
  const preview = page.waitForResponse(response => response.url().endsWith(`/invites/${f.invitation.code}`));
  release(); await preview;
  // A task turn lets the clipboard continuation consume the released response.
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => (window as any).qaCopies)).toEqual([]);
});

test('expiry removes an open invitation without user interaction', async ({ page }) => {
  await fixture(page); await page.clock.install(); await openInvites(page);
  await page.getByLabel('Invite expiration', { exact: true }).selectOption('24');
  const response = page.waitForResponse(response => response.url().endsWith('/invites') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Create invitation', exact: true }).click();
  const created = await (await response).json();
  await expect(page.getByLabel('Invitation link', { exact: true })).toHaveValue(new RegExp(created.code));
  await page.clock.fastForward(24 * 3600000 + 100);
  await expect.poll(() => page.getByLabel('Invitation link', { exact: true }).inputValue().catch(() => '')).not.toContain(created.code);
  await expect(page.getByRole('button', { name: `Revoke ${created.code}`, exact: true })).toHaveCount(0);
});

test('cold-start configuration never exposes Local Mode and recovers to Hosted auth', async ({ page }) => {
  let ready = false;
  await page.route('**/api/config', route => ready
    ? route.fulfill({ contentType: 'application/json', body: JSON.stringify({ mode: 'hosted', supabaseUrl: 'https://haven-cold-test.supabase.co', supabaseAnonKey: 'test-publishable-key' }) })
    : route.fulfill({ contentType: 'text/html', body: '<title>Starting your app - Voroa</title>' }));
  await page.route('https://haven-cold-test.supabase.co/**', route => route.abort());
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Retry connection', exact: true })).toBeVisible();
  await expect(page.getByLabel('USERNAME', { exact: true })).toHaveCount(0);
  ready = true; await page.getByRole('button', { name: 'Retry connection', exact: true }).click();
  await expect(page.getByLabel('EMAIL ADDRESS', { exact: true })).toBeVisible();
  await expect(page.getByLabel('USERNAME', { exact: true })).toHaveCount(0);
});

test('legacy/disconnected invitation dialogs validate before copying; duplicate creation and failed revocation recover', async ({ page }) => {
  const f = await fixture(page);
  await page.evaluate(() => {
    // Simulate an older deployed backend without invitation invalidation events.
    window.addEventListener('haven:invites-changed', event => event.stopImmediatePropagation(), true);
    (window as any).qaCopies = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => (window as any).qaCopies.push(text) } });
  });
  await openInvites(page);
  await expect(page.getByLabel('Invitation link', { exact: true })).toHaveValue(new RegExp(f.invitation.code));
  await page.request.delete(`/api/invites/${f.invitation.code}`);
  await page.getByRole('button', { name: 'Copy invite link', exact: true }).click();
  await expect(page.locator('.zenith-invite-modal [role=alert]')).toContainText('revoked');
  expect(await page.evaluate(() => (window as any).qaCopies)).toEqual([]);
  await expect(page.getByLabel('Invitation link', { exact: true })).toHaveCount(0);
  let writes = 0;
  page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/invites')) writes++; });
  await page.getByRole('button', { name: 'Create invitation', exact: true }).evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  await expect(page.getByLabel('Invitation link', { exact: true })).toBeVisible();
  expect(writes).toBe(1);
  const code = (await page.getByLabel('Invitation link', { exact: true }).inputValue()).split('/').at(-1)!;
  await page.route(`**/api/invites/${code}`, route => route.request().method() === 'DELETE'
    ? route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"QA restarting"}' }) : route.continue());
  await page.getByRole('button', { name: `Revoke ${code}`, exact: true }).click();
  await expect(page.locator('.zenith-invite-modal [role=alert]')).toContainText('temporarily unavailable');
  await expect(page.getByRole('button', { name: `Revoke ${code}`, exact: true })).toBeEnabled();
  await page.unroute(`**/api/invites/${code}`);
  await page.getByRole('button', { name: `Revoke ${code}`, exact: true }).click();
  await expect(page.getByRole('button', { name: `Revoke ${code}`, exact: true })).toHaveCount(0);
});

test('an existing session recovers automatically after backend startup HTML', async ({ page }) => {
  const f = await fixture(page);
  let ready = false;
  await page.route('**/api/bootstrap', route => ready ? route.continue() : route.fulfill({ contentType: 'text/html', body: '<title>Starting your app - Voroa</title>' }));
  await page.reload();
  await expect(page.locator('.server-rail')).toHaveCount(0);
  ready = true;
  await expect(page.getByRole('button', { name: f.server.name, exact: true })).toBeVisible();
  await expect(page.locator('.my-profile')).toContainText(f.user.username);
});
