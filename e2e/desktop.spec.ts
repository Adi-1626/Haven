import { streamStatistics } from './stream-statistics';
import { test, expect, _electron as electron, type Page } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

async function account(page: Page, username: string) {
  await page.getByRole('button', { name: 'Join Haven', exact: true }).click();
  await page.getByLabel('DISPLAY NAME').fill(username);
  await page.getByLabel('USERNAME', { exact: true }).fill(username);
  await page.getByLabel('PASSWORD', { exact: true }).fill('Desktop-Pass-2026');
  await page.getByRole('button', { name: 'Create your account' }).click();
  await expect(page.locator('.my-profile')).toContainText(username);
}

test('Electron captures its own real window and sends it alongside voice', async ({ browser }, testInfo) => {
  test.setTimeout(100_000);
  const profile = mkdtempSync(path.join(tmpdir(), 'haven-desktop-'));
  const env: Record<string, string | undefined> = { ...process.env, HAVEN_PROFILE_DIR: profile, HAVEN_MODE: 'local' };
  for (const key of Object.keys(env)) if (/SUPABASE|DATABASE_URL|HAVEN_SERVER|HAVEN_ENV_FILE|ELECTRON_RUN_AS_NODE/.test(key)) delete env[key];
  const instance = await electron.launch({ args: [path.resolve('.'), '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'], env: env as Record<string, string> });
  const context = await browser.newContext();
  try {
    const main = await instance.firstWindow();
    await main.waitForLoadState('domcontentloaded');
    const mainWindow = await instance.browserWindow(main);
    await mainWindow.evaluate(window => window.setTitle('Haven QA window capture'));
    await account(main, 'desktopowner');
    await main.getByRole('button', { name: 'Create a server', exact: true }).first().click();
    await main.getByLabel('SERVER NAME').fill('Desktop capture lab');
    await main.getByRole('button', { name: 'Create server', exact: true }).click();
    await expect(main.getByRole('heading', { name: 'Welcome to #general' })).toBeVisible();
    const bootstrap = await (await main.request.get(new URL('/api/bootstrap', main.url()).href)).json();
    const invite = await (await main.request.post(new URL(`/api/servers/${bootstrap.servers[0].id}/invites`, main.url()).href)).json();
    const remote = await context.newPage();
    await remote.goto(main.url());
    await account(remote, 'desktopviewer');
    await remote.request.post(new URL(`/api/invites/${invite.code}/join`, main.url()).href);
    await remote.getByRole('button', { name: 'Desktop capture lab', exact: true }).click();
    await main.getByRole('button', { name: 'Lounge', exact: true }).click();
    await expect(main.locator('.voice-connected')).toBeVisible();
    await remote.getByRole('button', { name: 'Lounge', exact: true }).click();
    await expect(remote.locator('.voice-connected')).toBeVisible();
    await main.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 256; canvas.height = 144;
      canvas.style.cssText = 'position:fixed;bottom:80px;left:380px;width:256px;height:144px;z-index:4;pointer-events:none;border-radius:8px';
      document.body.append(canvas);
      const context = canvas.getContext('2d')!;
      let frame = 0;
      const draw = () => { context.fillStyle = `hsl(${frame++ % 360} 50% 40%)`; context.fillRect(0, 0, 256, 144); context.font = '16px sans-serif'; context.fillStyle = 'white'; context.fillText(`Real window · frame ${frame}`, 20, 76); requestAnimationFrame(draw); };
      draw();
    });
    const pickerPromise = instance.waitForEvent('window');
    await main.getByRole('button', { name: 'Share screen', exact: true }).first().click();
    const picker = await pickerPromise;
    await picker.waitForLoadState('domcontentloaded');
    await picker.locator('button.source').filter({ hasText: 'Haven QA window capture' }).click();
    await expect(main.getByRole('button', { name: 'Stop sharing' }).first()).toBeVisible();
    await expect(remote.locator('video')).toHaveCount(0);
    await remote.getByRole('button', { name: 'Watch Stream', exact: true }).first().click();
    expect(await remote.evaluate(() => Boolean(document.fullscreenElement))).toBe(false);
    await expect.poll(() => remote.locator('video').evaluateAll(elements => elements.map(element => (element as HTMLVideoElement).videoWidth).filter(width => width > 0)), { timeout: 25_000 }).not.toEqual([]);
    const actual = await remote.locator('video').first().evaluate(element => { const video = element as HTMLVideoElement; return { width: video.videoWidth, height: video.videoHeight }; });
    await main.getByRole('button', { name: 'Stream quality', exact: true }).click();
    await main.getByText('Live connection statistics', { exact: true }).click();
    await expect.poll(async () => (await streamStatistics(main)).outbound?.[0]?.fps || 0, { timeout: 20_000 }).toBeGreaterThan(0);
    await expect.poll(async () => (await streamStatistics(main)).outbound?.[0]?.bitrateMbps || 0, { timeout: 10_000 }).toBeGreaterThan(0);
    const stats = await streamStatistics(main);
    const sourceBanner = main.getByText(`Captured source: ${actual.width} × ${actual.height}`, { exact: true });
    await expect(sourceBanner).toBeVisible();
    const source = await sourceBanner.textContent();
    console.log('Real window capture sample:', JSON.stringify({ source, received: actual, stats }));
    await testInfo.attach('real-window-capture', { body: JSON.stringify({ source, received: actual, stats }, null, 2), contentType: 'application/json' });
    await main.getByRole('button', { name: 'Close quality dialog', exact: true }).click();
    await main.getByRole('button', { name: 'Fullscreen your screen', exact: true }).click();
    const viewer = main.getByRole('dialog', { name: 'Your screen stream viewer', exact: true });
    await expect.poll(() => main.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
    await viewer.getByRole('button', { name: 'Exit fullscreen', exact: true }).click();
    await expect.poll(() => main.evaluate(() => Boolean(document.fullscreenElement))).toBe(false);
    await viewer.getByRole('button', { name: 'Picture in picture', exact: true }).click();
    await expect.poll(() => main.evaluate(() => Boolean(document.pictureInPictureElement))).toBe(true);
    await expect(viewer.locator('video')).toHaveJSProperty('muted', true);
    await mainWindow.evaluate(window => window.minimize());
    await expect.poll(() => main.evaluate(async () => (await window.haven!.getDesktopSettings()).runtime.background)).toBe(true);
    expect(await main.evaluate(() => {
      const video = document.pictureInPictureElement as HTMLVideoElement | null;
      return !!video?.srcObject && !video.paused;
    })).toBe(true);
    await mainWindow.evaluate(window => { window.restore(); window.show(); window.focus(); });
    await expect.poll(() => main.evaluate(async () => (await window.haven!.getDesktopSettings()).runtime.background)).toBe(false);
    await viewer.locator('.stream-dock-exit-btn').click();
    await expect.poll(() => main.evaluate(() => Boolean(document.pictureInPictureElement))).toBe(false);
    await main.screenshot({ path: testInfo.outputPath('haven-desktop.png') });
    await main.getByRole('button', { name: 'Stop sharing', exact: true }).first().click();
    await expect(main.getByRole('button', { name: 'Stop sharing' })).toHaveCount(0);
    await expect(main.locator('.voice-connected')).toBeVisible();
  } finally {
    await context.close();
    await instance.close();
    rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});
