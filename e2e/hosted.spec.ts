import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const api = 'http://127.0.0.1:3110';
const frontend = 'http://127.0.0.1:3111';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jA1cAAAAASUVORK5CYII=', 'base64');

async function account(request: APIRequestContext, page: Page, name: string) {
  const response = await request.post(`${api}/api/auth/register`, { data: { username: `${name}_${Date.now()}`, password: 'Hosted-test-password-123', displayName: name } });
  expect(response.status()).toBe(201);
  const { user } = await response.json();
  const token = response.headers()['set-cookie'].split(';')[0].split('=')[1];
  await page.addInitScript(({ api, token, user }) => {
    const state = window as unknown as { hostedConnections: RTCPeerConnection[] };
    state.hostedConnections = [];
    const OriginalConnection = window.RTCPeerConnection;
    window.RTCPeerConnection = class extends OriginalConnection {
      constructor(configuration?: RTCConfiguration) { super(configuration); state.hostedConnections.push(this); }
    };
    window.__HAVEN_CONFIG__ = { apiUrl: api, supabaseUrl: 'https://haven-hosted-test.supabase.co', supabaseAnonKey: 'test-publishable-key' };
    localStorage.setItem('sb-haven-hosted-test-auth-token', JSON.stringify({
      access_token: token, refresh_token: 'test-refresh-token', token_type: 'bearer',
      expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600,
      user: { ...user, email: 'test@haven.example', email_confirmed_at: new Date().toISOString(), aud: 'authenticated', app_metadata: {}, user_metadata: {} },
    }));
  }, { api, token, user });
  const headers = { Authorization: `Bearer ${token}` };
  return { user, token, headers };
}

test('token-only split-origin browser: files, icons, emoji, realtime chat, voice and sounds', async ({ page, browser, request }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const owner = await account(request, page, 'HostedOwner');
  const response = await request.post(`${api}/api/servers`, { headers: owner.headers, data: { name: 'Hosted community' } });
  const { server, channel } = await response.json();
  const upload = await request.post(`${api}/api/attachments`, { headers: owner.headers, multipart: { channelId: channel.id, file: { name: 'hosted-proof.txt', mimeType: 'text/plain', buffer: Buffer.from('authenticated download works') } } });
  expect(upload.status()).toBe(201);
  const { attachment } = await upload.json();
  const icon = await request.post(`${api}/api/servers/${server.id}/icon`, { headers: owner.headers, multipart: { file: { name: 'icon.png', mimeType: 'image/png', buffer: png } } });
  expect(icon.ok()).toBe(true);
  const emojiUpload = await request.post(`${api}/api/servers/${server.id}/emojis`, { headers: owner.headers, multipart: { name: 'hosted_emoji', file: { name: 'emoji.png', mimeType: 'image/png', buffer: png } } });
  expect(emojiUpload.status()).toBe(201);
  const { emoji } = await emojiUpload.json();
  const message = await request.post(`${api}/api/messages`, { headers: owner.headers, data: { channelId: channel.id, content: `:hvn_${emoji.id}:`, attachmentIds: [attachment.id] } });
  expect(message.status()).toBe(201);
  // A small valid WAV avoids testing browser decoder behavior with corrupt audio.
  const wav = Buffer.alloc(44 + 1600);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(1600, 40);
  expect((await request.post(`${api}/api/servers/${server.id}/sounds`, { headers: owner.headers, multipart: { name: 'Hosted chime', file: { name: 'chime.wav', mimeType: 'audio/wav', buffer: wav } } })).status()).toBe(201);
  const seen: { url: string; authorization: string | undefined; status: number }[] = [];
  page.on('response', response => { if (response.url().startsWith(`${api}/api/`)) seen.push({ url: response.url(), authorization: response.request().headers()['authorization'], status: response.status() }); });
  // Counts sounds that actually start on a running Web Audio context.
  await page.addInitScript(() => {
    const started = (window as unknown as { __soundStarts: string[] }).__soundStarts = [];
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (this: AudioBufferSourceNode, ...args: Parameters<AudioBufferSourceNode['start']>) { started.push(this.context.state); return start.apply(this, args); };
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Hosted community', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Welcome to #general', exact: true })).toBeVisible();
  await expect(page.locator('.custom-emoji img')).toHaveJSProperty('naturalWidth', 1);
  await expect(page.locator('.server-icon .community-icon img')).toHaveJSProperty('naturalWidth', 1);
  const downloaded = page.waitForEvent('download');
  await page.getByRole('link').filter({ hasText: 'hosted-proof.txt' }).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toBe('hosted-proof.txt');
  expect(await readFile((await download.path())!, 'utf8')).toBe('authenticated download works');
  await page.getByRole('button', { name: 'Lounge', exact: true }).click();
  await expect(page.getByText('Voice connected', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Room soundboard', exact: true }).click();
  await page.getByRole('button', { name: 'Hosted chime', exact: true }).click();
  // Files redirect to signed Storage URLs; the sound must still be fetched, decoded and played.
  await expect.poll(() => seen.some(item => item.url.includes('/audio') && item.status === 302)).toBe(true);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __soundStarts: string[] }).__soundStarts)).toContain('running');
  await page.getByRole('button', { name: 'Close soundboard dialog', exact: true }).click();
  await page.getByRole('button', { name: 'general', exact: true }).click();
  // A second browser verifies that Socket.IO works without sharing a session cookie.
  const context = await browser.newContext();
  try {
    const guestPage = await context.newPage();
    const guest = await account(request, guestPage, 'HostedGuest');
    const invitation = await request.post(`${api}/api/servers/${server.id}/invites`, { headers: owner.headers, data: {} });
    const { code } = await invitation.json();
    expect((await request.post(`${api}/api/invites/${code}/join`, { headers: guest.headers })).ok()).toBe(true);
    await guestPage.goto('/');
    await guestPage.getByRole('button', { name: 'Hosted community', exact: true }).click();
    await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Hosted realtime message');
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(guestPage.getByText('Hosted realtime message', { exact: true })).toBeVisible();
    await guestPage.getByRole('button', { name: 'Lounge', exact: true }).click();
    await expect(guestPage.getByText('Voice connected', { exact: true })).toBeVisible();
    await expect.poll(() => guestPage.evaluate(async () => {
      const connections = (window as unknown as { hostedConnections: RTCPeerConnection[] }).hostedConnections;
      for (const connection of connections) {
        for (const report of (await connection.getStats()).values()) {
          if (report.type === 'inbound-rtp' && report.kind === 'audio' && report.bytesReceived > 0) return true;
        }
      }
      return false;
    })).toBe(true);
  } finally { await context.close(); }
  expect((await page.context().cookies()).filter(cookie => cookie.name === 'relay_session')).toEqual([]);
  for (const fragment of ['/rtc', '/icon', '/static', '/attachments/', '/audio']) {
    const requests = seen.filter(item => item.url.includes(fragment));
    expect(requests.length, fragment).toBeGreaterThan(0);
    // Files answer with a redirect to signed Storage, as Supabase does; JSON endpoints answer directly.
    const status = fragment === '/rtc' ? 200 : 302;
    expect(requests.every(item => item.status === status && item.authorization === owner.headers.Authorization), fragment).toBe(true);
  }
  expect(errors).toEqual([]);
});

test('frontend invitation links are redeemed locally and new invites point at the frontend', async ({ page, request }) => {
  const owner = await account(request, page, 'InviteOwner');
  const created = await request.post(`${api}/api/servers`, { headers: owner.headers, data: { name: 'Invite community' } });
  const { server } = await created.json();
  const invitation = await request.post(`${api}/api/servers/${server.id}/invites`, { headers: owner.headers, data: {} });
  const { code } = await invitation.json();
  await page.goto('/');
  await page.getByRole('button', { name: 'Join a server', exact: true }).click();
  await page.getByLabel('Invite Code or Link', { exact: true }).fill(`${frontend}/invite/${code}`);
  await expect(page.getByRole('button', { name: 'Join Invite community', exact: true })).toBeVisible();
  await expect(page.getByText('This invitation is on another host')).toHaveCount(0);
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.getByRole('button', { name: 'Invite community', exact: true }).click();
  await page.getByRole('button', { name: /invite (your )?people/i }).click();
  await page.getByRole('button', { name: 'Create invitation', exact: true }).click();
  await expect(page.getByLabel('Invitation link', { exact: true })).toHaveValue(new RegExp(`^${frontend}/invite/`));
});

test('signing out revokes the backend session before clearing the hosted token', async ({ page, request }) => {
  const owner = await account(request, page, 'LogoutOwner');
  await page.route('https://haven-hosted-test.supabase.co/auth/v1/logout*', route => route.fulfill({ status: 204 }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const logoutRequest = page.waitForRequest(`${api}/api/auth/logout`);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  const logout = await logoutRequest;
  expect(logout.headers()['authorization']).toBe(owner.headers.Authorization);
  await expect(page.getByRole('heading', { name: 'Welcome back.', exact: true })).toBeVisible();
  expect((await request.get(`${api}/api/bootstrap`, { headers: owner.headers })).status()).toBe(401);
});

test('a delayed session refresh cannot restore the UI after cross-tab sign-out', async ({ page, request }) => {
  await account(request, page, 'RaceOwner');
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
  let release!: () => void;
  const released = new Promise<void>(resolve => { release = resolve; });
  let captured!: () => void;
  const capture = new Promise<void>(resolve => { captured = resolve; });
  await page.route(`${api}/api/bootstrap`, async route => {
    const response = await route.fetch();
    captured();
    await released;
    await route.fulfill({ response });
  });
  await page.evaluate(() => {
    const channel = new BroadcastChannel('sb-haven-hosted-test-auth-token');
    const session = JSON.parse(localStorage.getItem('sb-haven-hosted-test-auth-token')!);
    channel.postMessage({ event: 'TOKEN_REFRESHED', session });
    channel.close();
  });
  await capture;
  await page.evaluate(() => {
    localStorage.removeItem('sb-haven-hosted-test-auth-token');
    const channel = new BroadcastChannel('sb-haven-hosted-test-auth-token');
    channel.postMessage({ event: 'SIGNED_OUT', session: null });
    channel.close();
  });
  const delivered = page.waitForResponse(`${api}/api/bootstrap`);
  try {
    await expect(page.getByRole('heading', { name: 'Welcome back.', exact: true })).toBeVisible();
  } finally { release(); }
  await (await delivered).finished();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toHaveCount(0);
});
