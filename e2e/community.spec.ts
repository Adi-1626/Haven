import { test, expect, type Page, type Browser } from '@playwright/test';
import { io } from 'socket.io-client';

async function instrument(page: Page) {
  await page.addInitScript(() => {
    const state = window as unknown as { communityConnections: RTCPeerConnection[]; communityAudio: HTMLAudioElement[]; communityMicrophones: MediaStream[] };
    state.communityConnections = []; state.communityAudio = []; state.communityMicrophones = [];
    const OriginalConnection = window.RTCPeerConnection;
    window.RTCPeerConnection = class extends OriginalConnection { constructor(configuration?: RTCConfiguration) { super(configuration); state.communityConnections.push(this); } };
    const OriginalAudio = window.Audio;
    window.Audio = class extends OriginalAudio { constructor(source?: string) { super(source); state.communityAudio.push(this); } };
    const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async constraints => { const stream = await capture(constraints); state.communityMicrophones.push(stream); return stream; };
  });
}

async function room(page: Page, browser: Browser) {
  const suffix = Date.now().toString(36);
  const registered = await page.request.post('/api/auth/register', { data: { username: `profilea${suffix}`, displayName: 'Profile Owner', password: 'Community-Test-2026' } });
  const owner = (await registered.json()).user;
  const response = await page.request.post('/api/servers', { data: { name: `Profile room ${suffix}` } });
  const server = (await response.json()).server;
  const invitation = (await (await page.request.post(`/api/servers/${server.id}/invites`)).json()).code;
  const context = await browser.newContext({ permissions: ['microphone'] });
  const guest = await context.newPage();
  const guestResponse = await guest.request.post('/api/auth/register', { data: { username: `profileb${suffix}`, displayName: 'Profile Guest', password: 'Community-Test-2026' } });
  const member = (await guestResponse.json()).user;
  expect((await guest.request.post(`/api/invites/${invitation}/join`)).status()).toBe(200);
  await instrument(page); await instrument(guest);
  await page.goto('/'); await guest.goto('/');
  const image = Buffer.from(await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 1024; const drawing = canvas.getContext('2d')!; drawing.fillStyle = '#8899dd'; drawing.fillRect(0, 0, 1024, 1024); return canvas.toDataURL('image/png').split(',')[1]; }), 'base64');
  for (const client of [page, guest]) await client.route('https://haven-image.test/**', route => route.fulfill({ contentType: 'image/png', body: image }));
  await page.getByRole('button', { name: server.name, exact: true }).click();
  await guest.getByRole('button', { name: server.name, exact: true }).click();
  return { owner, member, server, guest, context };
}

async function join(page: Page) {
  await page.getByRole('button', { name: 'Lounge', exact: true }).click();
  await expect(page.locator('.voice-connected')).toBeVisible();
}

async function userMenu(page: Page, name: string) {
  await page.locator('.person-tile').filter({ has: page.locator('strong', { hasText: name }) }).click({ button: 'right' });
  return page.getByRole('menu', { name: `Actions for ${name}`, exact: true });
}

test('profiles update throughout active voice, original pictures open, local audio and moderated actions work across clients', async ({ page, browser }) => {
  const state = await room(page, browser);
  try {
    await page.request.patch('/api/users/me', { data: { avatar: 'https://haven-image.test/before.png', bio: 'Live profile before' } });
    await join(page); await join(state.guest);
    await expect.poll(() => state.guest.evaluate(() => (window as unknown as { communityConnections: RTCPeerConnection[] }).communityConnections.some(connection => connection.connectionState === 'connected'))).toBe(true);
    await state.guest.getByRole('button', { name: 'View profile for Profile Owner', exact: true }).click();
    const profile = state.guest.getByRole('dialog', { name: 'Profile', exact: true });
    await expect(profile.locator('.avatar img')).toHaveAttribute('src', 'https://haven-image.test/before.png');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByLabel('AVATAR', { exact: false }).fill('https://haven-image.test/original.png');
    await page.getByLabel('ABOUT YOU').fill('Live profile after');
    await page.getByRole('button', { name: 'Save profile', exact: true }).click();
    await expect(profile.locator('.avatar img')).toHaveAttribute('src', 'https://haven-image.test/original.png');
    await expect(profile).toContainText('Live profile after');
    await expect(state.guest.locator('.person-tile').filter({ hasText: 'Profile Owner' }).locator('.avatar img')).toHaveAttribute('src', 'https://haven-image.test/original.png');
    await expect(state.guest.locator('.voice-roster').getByRole('button', { name: /Profile Owner in Lounge/ }).locator('img')).toHaveAttribute('src', 'https://haven-image.test/original.png');
    await profile.getByRole('button', { name: "View Profile Owner's original profile picture", exact: true }).click();
    const picture = state.guest.getByRole('dialog', { name: 'Profile Owner — original picture', exact: true });
    await expect(picture.getByRole('img', { name: "Profile Owner's full profile picture", exact: true })).toHaveAttribute('src', 'https://haven-image.test/original.png');
    await expect.poll(() => picture.getByRole('img', { name: "Profile Owner's full profile picture", exact: true }).evaluate(element => (element as HTMLImageElement).naturalWidth)).toBe(1024);
    await picture.getByRole('button', { name: 'Actual size', exact: true }).click();
    await expect(picture.locator('.actual-size')).toBeVisible();
    await picture.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await profile.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click();

    const local = await userMenu(state.guest, 'Profile Owner');
    await expect(local.getByRole('menuitem', { name: 'Server mute', exact: true })).toHaveCount(0);
    await local.getByRole('slider', { name: 'Profile Owner volume', exact: true }).fill('0.3');
    await expect.poll(() => state.guest.evaluate(() => (window as unknown as { communityAudio: HTMLAudioElement[] }).communityAudio.filter(audio => audio.srcObject).map(audio => audio.volume))).toEqual([0.3]);
    await local.getByRole('menuitem', { name: 'Mute locally', exact: true }).click();
    await expect(local.getByRole('menuitem', { name: 'Unmute locally', exact: true })).toBeVisible();
    await expect.poll(() => state.guest.evaluate(() => (window as unknown as { communityAudio: HTMLAudioElement[] }).communityAudio.filter(audio => audio.srcObject).every(audio => audio.muted))).toBe(true);
    expect((await (await page.request.get('/api/bootstrap')).json()).voice.find((peer: { user: { id: string } }) => peer.user.id === state.owner.id).muted).toBe(false);
    await local.getByRole('menuitem', { name: 'Unmute locally', exact: true }).click();
    await state.guest.screenshot({ path: test.info().outputPath('participant-menu.png') });
    await state.guest.keyboard.press('Escape');

    const moderation = await userMenu(page, 'Profile Guest');
    await moderation.getByRole('menuitem', { name: 'Server mute', exact: true }).click();
    await expect(state.guest.locator('.person-tile').filter({ hasText: '(you)' })).toContainText('Server muted');
    await expect.poll(() => state.guest.evaluate(() => (window as unknown as { communityMicrophones: MediaStream[] }).communityMicrophones.filter(stream => stream.active).every(stream => stream.getAudioTracks().every(track => !track.enabled)))).toBe(true);
    await state.guest.locator('.voice-connected').getByRole('button', { name: 'Unmute microphone', exact: true }).click();
    await expect(state.guest.getByText('A moderator has muted you in this community.', { exact: true })).toBeVisible();
    await (await userMenu(page, 'Profile Guest')).getByRole('menuitem', { name: 'Remove server mute', exact: true }).click();
    await expect.poll(async () => (await (await page.request.get('/api/bootstrap')).json()).voice.find((peer: { user: { id: string } }) => peer.user.id === state.member.id).muted).toBe(false);
    await expect.poll(() => state.guest.evaluate(() => (window as unknown as { communityMicrophones: MediaStream[] }).communityMicrophones.filter(stream => stream.active).every(stream => stream.getAudioTracks().every(track => track.enabled)))).toBe(true);
    await (await userMenu(page, 'Profile Guest')).getByRole('menuitem', { name: 'Server deafen', exact: true }).click();
    await expect(state.guest.locator('.person-tile').filter({ hasText: '(you)' })).toContainText('Server deafened');
    await (await userMenu(page, 'Profile Guest')).getByRole('menuitem', { name: 'Remove server deafen', exact: true }).click();
    await expect.poll(async () => (await (await page.request.get('/api/bootstrap')).json()).voice.find((peer: { user: { id: string } }) => peer.user.id === state.member.id).deafened).toBe(false);

    await (await userMenu(state.guest, 'Profile Owner')).getByRole('menuitem', { name: 'Add friend', exact: true }).click();
    await (await userMenu(page, 'Profile Guest')).getByRole('menuitem', { name: 'Accept friend request', exact: true }).click();
    await (await userMenu(state.guest, 'Profile Owner')).getByRole('menuitem', { name: 'Message', exact: true }).click();
    await expect(state.guest.getByRole('textbox', { name: 'Message', exact: true })).toBeVisible();
    await expect(state.guest.locator('.voice-connected')).toBeVisible();
  } finally { await state.context.close(); }
});

test('server overview and icons synchronize while member editing remains permission-gated', async ({ page, browser }) => {
  const state = await room(page, browser);
  try {
    await page.getByRole('button', { name: 'Server options', exact: true }).click();
    await page.getByLabel('SERVER NAME', { exact: true }).fill(`${state.server.name} updated`);
    await page.getByLabel('Community description', { exact: true }).fill('A community for quiet background gaming.');
    await page.getByLabel('Community icon', { exact: true }).fill('https://haven-image.test/icon.png');
    await page.getByRole('button', { name: 'Save community', exact: true }).click();
    await expect(state.guest.getByRole('button', { name: `${state.server.name} updated`, exact: true })).toBeVisible();
    await expect(state.guest.getByRole('button', { name: `${state.server.name} updated`, exact: true }).locator('img')).toHaveAttribute('src', 'https://haven-image.test/icon.png');
    await state.guest.getByRole('button', { name: 'Server options', exact: true }).click();
    await expect(state.guest.getByLabel('Community description', { exact: true })).toHaveValue('A community for quiet background gaming.');
    await expect(state.guest.getByLabel('Community description', { exact: true })).toBeDisabled();
    await page.screenshot({ path: test.info().outputPath('community-settings.png') });
    expect((await state.guest.request.patch(`/api/servers/${state.server.id}`, { data: { name: 'Unauthorized' } })).status()).toBe(403);
    await state.guest.getByRole('button', { name: 'Close dialog', exact: true }).click();
    const icon = Buffer.from(await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 32; const drawing = canvas.getContext('2d')!; drawing.fillStyle = '#bb88dd'; drawing.fillRect(0, 0, 32, 32); return canvas.toDataURL('image/png').split(',')[1]; }), 'base64');
    await page.getByLabel('Upload community icon', { exact: true }).setInputFiles({ name: 'icon.png', mimeType: 'image/png', buffer: icon });
    await page.getByRole('button', { name: 'Upload icon', exact: true }).click();
    await expect(state.guest.getByRole('button', { name: `${state.server.name} updated`, exact: true }).locator('img')).toHaveAttribute('src', new RegExp(`/api/servers/${state.server.id}/icon\\?v=`));
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await state.guest.getByRole('button', { name: `${state.server.name} updated`, exact: true }).click({ button: 'right' });
    await expect(state.guest.getByRole('menuitem', { name: 'Server settings', exact: true })).toBeVisible();
    await state.guest.keyboard.press('Escape');
    await state.guest.getByRole('button', { name: 'Lounge', exact: true }).click({ button: 'right' });
    await expect(state.guest.getByRole('menuitem', { name: 'Edit channel', exact: true })).toHaveCount(0);
    await expect(state.guest.getByRole('menuitem', { name: 'Join voice channel', exact: true })).toBeVisible();
  } finally { await state.context.close(); }
});

test('a delayed bootstrap cannot erase a newer speaking transition', async ({ page, browser }) => {
  const state = await room(page, browser);
  const cookies = (await page.context().cookies()).map(cookie => `${cookie.name}=${cookie.value}`).join('; ');
  const participant = io('http://127.0.0.1:3107', { transports: ['websocket'], extraHeaders: { Cookie: cookies } });
  let release = () => {};
  try {
    await new Promise<void>((resolve, reject) => { participant.once('connect', resolve); participant.once('connect_error', reject); });
    const bootstrap = await (await page.request.get('/api/bootstrap')).json();
    const channel = bootstrap.channels.find((value: { serverId: string; type: string }) => value.serverId === state.server.id && value.type === 'voice');
    expect((await participant.timeout(5000).emitWithAck('voice:join', { channelId: channel.id })).error).toBeUndefined();
    await expect(state.guest.locator('.voice-roster')).toContainText('Profile Owner');
    let captured = () => {};
    const snapshot = new Promise<void>(resolve => { captured = resolve; });
    const responseGate = new Promise<void>(resolve => { release = resolve; });
    let intercepted = false;
    await state.guest.route('**/api/bootstrap', async route => {
      if (intercepted) return route.continue();
      intercepted = true;
      const response = await route.fetch();
      captured();
      await responseGate;
      await route.fulfill({ response });
    });
    expect((await state.guest.request.patch('/api/users/me', { data: { settings: { snapshotTest: true } } })).ok()).toBe(true);
    await snapshot;
    await participant.timeout(5000).emitWithAck('voice:activity', { speaking: true });
    const speaking = state.guest.locator('.voice-roster button.speaking').filter({ hasText: 'Profile Owner' });
    await expect(speaking).toHaveCount(1);
    const refreshed = state.guest.waitForResponse(response => response.url().endsWith('/api/bootstrap'));
    release();
    await (await refreshed).finished();
    await state.guest.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(speaking).toHaveCount(1);
    await participant.timeout(5000).emitWithAck('voice:activity', { speaking: false });
    await expect(speaking).toHaveCount(0);
  } finally { release(); participant.disconnect(); await state.context.close(); }
});
