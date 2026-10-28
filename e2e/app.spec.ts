import { streamStatistics } from './stream-statistics';
import { test, expect, type Page, type Browser } from '@playwright/test';
import { registerLocal } from './local-auth';

async function register(page: Page, username: string) {
  await registerLocal(page, username);
  await expect(page.getByRole('heading', { name: 'Better, together.' })).toBeVisible();
}

async function community(page: Page, name: string) {
  await page.getByRole('button', { name: 'Create a server', exact: true }).first().click();
  await page.getByLabel('SERVER NAME').fill(name);
  await page.getByRole('button', { name: 'Create server', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Welcome to #general' })).toBeVisible();
  const result = await page.request.get('/api/bootstrap');
  const data = await result.json();
  const server = data.servers.find((item: { name: string }) => item.name === name);
  const invite = await page.request.post(`/api/servers/${server.id}/invites`);
  return { data, server, invite: (await invite.json()).code };
}

test('two accounts: invites, realtime chat, replies, reactions, edits, files, friends and DMs', async ({ page, browser }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const suffix = Date.now().toString().slice(-8);
  const owner = `owner${suffix}`;
  const guest = `guest${suffix}`;
  await register(page, owner);
  const { server, invite } = await community(page, 'The observatory');
  const context = await browser.newContext();
  const second = await context.newPage();
  await register(second, guest);
  await second.getByRole('button', { name: 'Join a server', exact: true }).click();
  await second.getByLabel('INVITE CODE').fill(invite);
  await second.getByRole('button', { name: 'Join The observatory', exact: true }).click();
  await expect(second.getByRole('heading', { name: 'Welcome to #general' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('A real message across two sessions');
  await page.getByRole('textbox', { name: 'Message', exact: true }).press('Enter');
  await expect(second.getByText('A real message across two sessions', { exact: true })).toBeVisible();
  const message = second.locator('article.message').filter({ has: second.locator('.message-text', { hasText: 'A real message across two sessions' }) });
  await message.hover();
  await message.getByRole('button', { name: 'Reply', exact: true }).click();
  await second.getByRole('textbox', { name: 'Message', exact: true }).fill('Reply arrived');
  await second.getByRole('textbox', { name: 'Message', exact: true }).press('Enter');
  await expect(page.getByText('Reply arrived', { exact: true })).toBeVisible();
  await message.hover();
  await message.getByRole('button', { name: 'Add reaction' }).click();
  await message.getByRole('button', { name: '💜', exact: true }).click();
  await expect(page.locator('.reactions').first()).toContainText('💜');
  const ownMessage = page.locator('article.message').filter({ hasText: 'A real message across two sessions' }).first();
  await ownMessage.hover();
  await ownMessage.getByRole('button', { name: 'Edit message', exact: true }).click();
  await ownMessage.getByRole('textbox', { name: 'Edit message' }).fill('Edited and persisted');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(second.getByText('Edited and persisted', { exact: false }).first()).toBeVisible();
  await page.locator('.composer input[type=file]').setInputFiles({ name: 'hello.txt', mimeType: 'text/plain', buffer: Buffer.from('A real persisted attachment') });
  await expect(page.locator('.pending-files')).toContainText('hello.txt');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(second.locator('a.attachment')).toContainText('hello.txt');
  const downloadURL = await second.locator('a.attachment').getAttribute('href');
  const download = await second.request.get(downloadURL!);
  expect(await download.text()).toBe('A real persisted attachment');
  await second.reload();
  await expect(second.getByText('Edited and persisted', { exact: false }).first()).toBeVisible();
  await page.request.post('/api/friends/requests', { data: { username: guest } });
  const pending = await (await second.request.get('/api/bootstrap')).json();
  await second.request.post(`/api/friends/requests/${pending.requests[0].id}/accept`);
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await page.getByRole('button', { name: `Message ${guest}`, exact: true }).click();
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Private hello');
  await page.getByRole('textbox', { name: 'Message', exact: true }).press('Enter');
  await second.getByRole('button', { name: 'Home', exact: true }).click();
  await second.locator('.dm-row').first().click();
  await expect(second.getByText('Private hello', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
  await page.screenshot({ path: 'test-results/haven-conversation.png' });
  await context.close();
});

test('actual WebRTC audio and encoded screen video between independent clients', async ({ page, browser }) => {
  const suffix = Date.now().toString().slice(-8);
  await page.addInitScript(() => {
    const Original = window.RTCPeerConnection;
    (window as any).__connections = [];
    window.RTCPeerConnection = class extends Original { constructor(configuration?: RTCConfiguration) { super(configuration); (window as any).__connections.push(this); } };
    navigator.mediaDevices.getDisplayMedia = async () => {
      const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 720;
      const context = canvas.getContext('2d')!;
      let frame = 0;
      const draw = () => { context.fillStyle = `hsl(${frame++ % 360} 45% 35%)`; context.fillRect(0, 0, 1280, 720); context.fillStyle = 'white'; context.font = '50px sans-serif'; context.fillText(`Haven WebRTC · frame ${frame}`, 70, 360); requestAnimationFrame(draw); };
      draw();
      return canvas.captureStream(60);
    };
  });
  await register(page, `speaker${suffix}`);
  const { server, invite } = await community(page, 'Voice lab');
  const context = await browser.newContext({ permissions: ['microphone'] });
  const second = await context.newPage();
  await second.addInitScript(() => { const Original = window.RTCPeerConnection; (window as any).__connections = []; window.RTCPeerConnection = class extends Original { constructor(configuration?: RTCConfiguration) { super(configuration); (window as any).__connections.push(this); } }; });
  await register(second, `listener${suffix}`);
  await second.request.post(`/api/invites/${invite}/join`);
  await second.getByRole('button', { name: 'Voice lab', exact: true }).click();
  await page.getByRole('button', { name: 'Lounge', exact: true }).click();
  await expect(page.locator('.voice-connected')).toContainText('Voice connected');
  await second.getByRole('button', { name: 'Lounge', exact: true }).click();
  await expect(second.locator('.voice-connected')).toContainText('Voice connected');
  await expect.poll(async () => second.evaluate(async () => { const connections = (window as any).__connections as RTCPeerConnection[]; const stats = await Promise.all(connections.map(connection => connection.getStats())); return stats.flatMap(report => [...report.values()]).filter(item => item.type === 'inbound-rtp' && item.kind === 'audio').reduce((total, item) => total + item.bytesReceived, 0); }), { timeout: 25_000 }).toBeGreaterThan(100);
  await page.getByRole('button', { name: 'Share screen', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Stop sharing' }).first()).toBeVisible();
  // Screen transport is viewer-driven: announcing a broadcast must not start
  // sending video to every voice participant without their consent.
  await expect(second.getByRole('button', { name: 'Watch Stream', exact: true })).toBeVisible();
  await second.getByRole('button', { name: 'Watch Stream', exact: true }).click();
  await expect.poll(async () => second.locator('video').evaluateAll(videos => videos.map(element => ({ width: (element as HTMLVideoElement).videoWidth, height: (element as HTMLVideoElement).videoHeight })).filter(item => item.width > 0)), { timeout: 25_000 }).toEqual([{ width: 1280, height: 720 }]);
  await page.getByRole('button', { name: 'Stream quality', exact: true }).click();
  await expect(page.getByText('Captured source: 1280 × 720', { exact: true })).toBeVisible();
  const resolution = page.getByLabel('Resolution', { exact: true });
  await expect(resolution.locator('option')).toHaveText(['Native (1280 × 720)', '480p']);
  await resolution.selectOption('480');
  await page.getByLabel('Frame Rate', { exact: true }).selectOption('30');
  await page.getByRole('button', { name: 'Apply quality', exact: true }).click();
  await page.getByRole('button', { name: 'Close quality dialog', exact: true }).click();
  await expect.poll(async () => second.locator('video').evaluateAll(videos => videos.map(element => (element as HTMLVideoElement).videoHeight)), { timeout: 20_000 }).toEqual([480]);
  await page.getByRole('button', { name: 'Stream quality', exact: true }).click();
  await page.getByText('Live connection statistics', { exact: true }).click();
  await expect.poll(async () => { const stats = await streamStatistics(page); return stats.outbound?.[0]?.fps || 0; }, { timeout: 15_000 }).toBeGreaterThan(0);
  const stats = await streamStatistics(page);
  expect(stats.outbound[0].width).toBeLessThanOrEqual(1280);
  expect(stats.outbound[0].height).toBe(480);
  await expect.poll(async () => (await streamStatistics(page)).outbound?.[0]?.fps || 60, { timeout: 15_000 }).toBeLessThanOrEqual(31);
  console.log('30 fps screen sample:', await streamStatistics(page));
  await page.getByLabel('Frame Rate', { exact: true }).selectOption('15');
  await page.getByRole('button', { name: 'Apply quality', exact: true }).click();
  await expect.poll(async () => (await streamStatistics(page)).outbound?.[0]?.fps || 60, { timeout: 15_000 }).toBeLessThanOrEqual(16);
  console.log('15 fps screen sample:', await streamStatistics(page));
  await page.getByRole('button', { name: 'Close quality dialog', exact: true }).click();
  await page.locator('.voice-connected').getByRole('button', { name: 'Mute microphone', exact: true }).click();
  const roster = await (await second.request.get('/api/bootstrap')).json();
  await expect.poll(async () => { const data = await (await second.request.get('/api/bootstrap')).json(); return data.voice.find((peer: any) => peer.user.username === `speaker${suffix}`)?.muted; }).toBe(true);
  await page.getByRole('button', { name: 'Disconnect voice', exact: true }).click();
  await expect(second.locator('.call-header')).toContainText('Participants (1)');
  await context.close();
});

test('responsive navigation and settings remain usable', async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 860 });
  await register(page, `mobile${Date.now().toString().slice(-8)}`);
  await page.getByRole('button', { name: 'Toggle navigation' }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('DISPLAY NAME').fill('A new name');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByRole('status')).toHaveText('Settings saved');
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'Close navigation' }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/haven-mobile.png' });
});
