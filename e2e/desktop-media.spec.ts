import { test, expect, _electron as electron, type Page, type ElectronApplication } from '@playwright/test';
import { mkdtempSync, readFileSync, mkdirSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

async function nativePtt(pressed: boolean) {
  const keys = pressed ? [[0x11, 0], [0x10, 0], [0x79, 0]] : [[0x79, 2], [0x10, 2], [0x11, 2]];
  const script = `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class HavenMediaKey { [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra); }'; ${keys.map(([key, flags]) => `[HavenMediaKey]::keybd_event(${key},0,${flags},[UIntPtr]::Zero)`).join('; ')}`;
  await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true });
}

const launch = (profile: string) => {
  const env = { ...process.env, HAVEN_PROFILE_DIR: profile, HAVEN_MODE: 'local' };
  for (const key of Object.keys(env)) if (/SUPABASE|DATABASE_URL|HAVEN_SERVER|HAVEN_ENV_FILE|ELECTRON_RUN_AS_NODE/.test(key)) delete env[key];
  return electron.launch({ args: [path.resolve('.'), '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'], env });
};
async function register(page: Page, username: string) {
  await page.getByLabel('DISPLAY NAME', { exact: true }).fill(username);
  await page.getByLabel('USERNAME', { exact: true }).fill(username);
  await page.getByLabel('PASSWORD', { exact: true }).fill('Media-regression-2026!');
  await page.getByRole('button', { name: 'Create your account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Better, together.' })).toBeVisible();
}
async function audioSettings(page: Page) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'voice & video', exact: true }).click();
}
async function foreground(app: ElectronApplication, page: Page) {
  const handle = await app.browserWindow(page);
  await handle.evaluate(window => { window.restore(); window.show(); window.focus(); });
  await expect.poll(() => page.evaluate(async () => (await window.haven!.getDesktopSettings()).runtime.background)).toBe(false);
}
function cleanup(profile: string) {
  expect(path.dirname(path.resolve(profile))).toBe(path.resolve(tmpdir()));
  rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}

test('complete audio preferences survive Electron quit and global PTT gates the minimized client', async () => {
  const profile = mkdtempSync(path.join(tmpdir(), 'haven-media-restart-'));
  let app = await launch(profile);
  try {
    const page = await app.firstWindow();
    await register(page, 'persistmedia');
    await page.getByRole('button', { name: 'Output Options', exact: true }).click();
    await page.getByLabel('Output volume', { exact: true }).fill('0.6');
    await page.getByLabel('Output device', { exact: true }).selectOption({ index: 2 });
    await page.getByRole('button', { name: 'Output Options', exact: true }).click();
    await audioSettings(page);
    await page.getByLabel('Noise suppression mode', { exact: true }).selectOption('enhanced');
    await page.getByRole('checkbox', { name: /^Push to talk/ }).check();
    await page.getByLabel('Input volume', { exact: true }).fill('1.3');
    await page.getByLabel('Input sensitivity', { exact: true }).fill('-37');
    await page.getByLabel('Voice bitrate', { exact: true }).selectOption('64');
    await page.getByLabel('Input device', { exact: true }).selectOption({ index: 2 });
    await page.getByRole('button', { name: 'desktop & gaming', exact: true }).click();
    const recorder = page.getByRole('button', { name: 'Push-to-talk shortcut', exact: true });
    await recorder.click(); await page.keyboard.press('Control+Shift+F10');
    await page.getByRole('button', { name: 'Apply shortcuts', exact: true }).click();
    await expect(page.getByText('Desktop settings applied and saved', { exact: true })).toBeVisible();
    const saved = await page.evaluate(() => window.haven!.readClientSetting('haven.media.settings'));
    expect(JSON.parse(saved!)).toMatchObject({ pushToTalk: true, noiseSuppressionMode: 'enhanced', inputVolume: 1.3, outputVolume: .6, inputSensitivity: -37, voiceBitrateKbps: 64 });
    expect(Object.keys(JSON.parse(saved!)).sort()).toEqual(['echoCancellation', 'gamingMode', 'inputDevice', 'inputDeviceLabel', 'outputDeviceLabel', 'inputSensitivity', 'inputVolume', 'noiseSuppression', 'noiseSuppressionMode', 'outputDevice', 'outputVolume', 'pushToTalk', 'pushToTalkKey', 'shareBitrateMbps', 'shareFps', 'shareHeight', 'voiceBitrateKbps'].sort());
    const firstOrigin = new URL(page.url()).origin;
    await app.close();
    expect(JSON.parse(readFileSync(path.join(profile, 'client-settings.json'), 'utf8'))['haven.media.settings']).toBe(saved);
    app = await launch(profile);
    const restarted = await app.firstWindow();
    await expect(restarted.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
    expect(new URL(restarted.url()).origin).not.toBe(firstOrigin);
    expect(JSON.parse((await restarted.evaluate(() => window.haven!.readClientSetting('haven.media.settings')))!).pushToTalk).toBe(true);
    await audioSettings(restarted);
    await expect(restarted.getByRole('checkbox', { name: /^Push to talk/ })).toBeChecked();
    await expect(restarted.getByLabel('Noise suppression mode', { exact: true })).toHaveValue('enhanced');
    await expect(restarted.getByLabel('Input device', { exact: true }).locator('option:checked')).toHaveText(JSON.parse(saved!).inputDeviceLabel);
    expect((await restarted.evaluate(() => window.haven!.getDesktopSettings())).settings.pttShortcut).toBe('Control+Shift+F10');
    await restarted.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await restarted.getByRole('button', { name: 'Output Options', exact: true }).click();
    await expect(restarted.getByLabel('Output volume', { exact: true })).toHaveValue('0.6');
    await expect(restarted.getByLabel('Output device', { exact: true }).locator('option:checked')).toHaveText(JSON.parse(saved!).outputDeviceLabel);
    const restored = JSON.parse((await restarted.evaluate(() => window.haven!.readClientSetting('haven.media.settings')))!);
    const original = JSON.parse(saved!);
    expect({ ...restored, inputDevice: original.inputDevice, outputDevice: original.outputDevice }).toEqual(original);
    await restarted.getByRole('button', { name: 'Output Options', exact: true }).click();
    await restarted.evaluate(() => {
      const get = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      (window as any).qaMicrophones = [];
      navigator.mediaDevices.getUserMedia = async constraints => { const stream = await get(constraints); (window as any).qaMicrophones.push(stream); return stream; };
    });
    await restarted.getByRole('button', { name: 'Create a server', exact: true }).first().click();
    await restarted.getByLabel('SERVER NAME').fill('Minimized PTT lab');
    await restarted.getByRole('button', { name: 'Create server', exact: true }).click();
    await restarted.getByRole('button', { name: 'Lounge', exact: true }).click();
    await expect.poll(() => restarted.evaluate(async () => (await window.haven!.getDesktopSettings()).runtime.globalPttAvailable)).toBe(true);
    const transmitting = () => restarted.evaluate(() => (window as any).qaMicrophones.some((stream: MediaStream) => stream.getAudioTracks().some(track => track.readyState === 'live' && track.enabled)));
    await expect.poll(transmitting).toBe(false);
    const handle = await app.browserWindow(restarted);
    await handle.evaluate(window => window.minimize());
    await app.evaluate(async ({ BrowserWindow }) => {
      const surface = new BrowserWindow({ width: 640, height: 360, title: 'Haven owned PTT test surface' });
      await surface.loadURL('data:text/html,<h1>Haven minimized PTT verification</h1>');
      surface.focus();
    });
    await expect.poll(() => restarted.evaluate(async () => (await window.haven!.getDesktopSettings()).runtime.background)).toBe(true);
    await nativePtt(true);
    await expect.poll(transmitting).toBe(true);
    await nativePtt(false);
    await expect.poll(transmitting).toBe(false);
    await foreground(app, restarted);
    await restarted.getByRole('button', { name: 'Disconnect voice', exact: true }).click();
    await expect.poll(() => restarted.evaluate(() => (window as any).qaMicrophones.every((stream: MediaStream) => stream.getTracks().every(track => track.readyState === 'ended')))).toBe(true);
  } finally { await nativePtt(false); await app.close(); cleanup(profile); }
});

test('disk save failures and corrupt settings visibly block microphone transmission', async () => {
  const profile = mkdtempSync(path.join(tmpdir(), 'haven-media-safety-'));
  let app = await launch(profile);
  try {
    const page = await app.firstWindow();
    await register(page, 'safemedia');
    await page.evaluate(() => {
      const get = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      (window as any).qaMicrophones = [];
      navigator.mediaDevices.getUserMedia = async constraints => { const stream = await get(constraints); (window as any).qaMicrophones.push(stream); return stream; };
    });
    await page.getByRole('button', { name: 'Create a server', exact: true }).first().click();
    await page.getByLabel('SERVER NAME').fill('Safety lab');
    await page.getByRole('button', { name: 'Create server', exact: true }).click();
    await page.getByRole('button', { name: 'Lounge', exact: true }).click();
    const transmitting = () => page.evaluate(() => (window as any).qaMicrophones.some((stream: MediaStream) => stream.getAudioTracks().some(track => track.readyState === 'live' && track.enabled)));
    await expect.poll(transmitting).toBe(true);
    const temporary = path.join(profile, 'client-settings.json.tmp');
    mkdirSync(temporary);
    await audioSettings(page);
    await page.getByRole('checkbox', { name: /^Push to talk/ }).check();
    await expect(page.getByRole('alert')).toContainText('Microphone is blocked');
    await expect.poll(transmitting).toBe(false);
    await page.getByRole('checkbox', { name: /^Push to talk/ }).uncheck();
    await expect.poll(transmitting).toBe(false);
    await app.close();
    rmdirSync(temporary); // Empty test-owned failure fixture only.
    app = await launch(profile);
    const failedRestart = await app.firstWindow();
    await expect(failedRestart.getByRole('alert')).toContainText('previous audio settings save failed');
    await audioSettings(failedRestart);
    await expect(failedRestart.getByRole('checkbox', { name: /^Push to talk/ })).toBeChecked();
    await app.close();
    rmSync(path.join(profile, 'audio-settings-save-failed'));
    writeFileSync(path.join(profile, 'client-settings.json'), '{corrupt test fixture');
    app = await launch(profile);
    const restarted = await app.firstWindow();
    await expect(restarted.getByRole('alert')).toContainText('Microphone is blocked');
    await audioSettings(restarted);
    await expect(restarted.getByRole('checkbox', { name: /^Push to talk/ })).toBeChecked();
  } finally { await app.close(); cleanup(profile); }
});

test('isolated Electron clients render both sharing directions and restore foreground video quality', async () => {
  test.setTimeout(120_000);
  const profile = mkdtempSync(path.join(tmpdir(), 'haven-media-windows-'));
  const app = await launch(profile);
  try {
    const main = await app.firstWindow();
    await register(main, 'windowowner');
    const opened = app.waitForEvent('window');
    await main.evaluate(() => window.haven!.openTestClient());
    const extra = await opened;
    await register(extra, 'windowviewer');
    await main.getByRole('button', { name: 'Create a server', exact: true }).first().click();
    await main.getByLabel('SERVER NAME').fill('Window media lab');
    await main.getByRole('button', { name: 'Create server', exact: true }).click();
    const boot = await (await main.request.get(new URL('/api/bootstrap', main.url()).href)).json();
    const invite = await (await main.request.post(new URL(`/api/servers/${boot.servers[0].id}/invites`, main.url()).href)).json();
    const joined = await extra.evaluate(async code => (await fetch(`/api/invites/${code}/join`, { method: 'POST' })).status, invite.code);
    expect(joined).toBe(200);
    await extra.reload();
    await extra.getByRole('button', { name: 'Window media lab', exact: true }).click();
    for (const page of [main, extra]) {
      await page.evaluate(() => {
        const qa = (window as any).qaMedia = { streams: [], connections: [] };
        const get = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
        navigator.mediaDevices.getUserMedia = async constraints => { const stream = await get(constraints); qa.streams.push(stream); return stream; };
        const capture = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
        navigator.mediaDevices.getDisplayMedia = async constraints => { const stream = await capture(constraints); qa.streams.push(stream); return stream; };
        const Peer = window.RTCPeerConnection;
        window.RTCPeerConnection = class extends Peer { constructor(config?: RTCConfiguration) { super(config); qa.connections.push(this); } };
      });
      await page.getByRole('button', { name: 'Lounge', exact: true }).click();
      await expect(page.locator('.voice-connected')).toBeVisible();
    }
    for (const [sender, receiver, label] of [[main, extra, 'primary'], [extra, main, 'secondary']] as const) {
      await foreground(app, sender);
      const handle = await app.browserWindow(sender);
      await handle.evaluate((window, label) => window.setTitle(`Haven QA ${label}`), label);
      await sender.evaluate(() => {
        const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180;
        canvas.style.cssText = 'position:fixed;top:100px;left:400px;z-index:3'; document.body.append(canvas);
        const context = canvas.getContext('2d')!; let frame = 0;
        (window as any).qaDraw = setInterval(() => { context.fillStyle = `hsl(${frame++ % 360} 70% 50%)`; context.fillRect(0, 0, 320, 180); }, 50);
      });
      const picking = app.waitForEvent('window');
      await sender.getByRole('button', { name: 'Share screen', exact: true }).first().click();
      const picker = await picking;
      await picker.locator('button.source').filter({ hasText: `Haven QA ${label}` }).click();
      await expect.poll(() => picker.isClosed()).toBe(true);
      await foreground(app, receiver);
      const video = receiver.locator('video').first();
      await expect.poll(() => video.evaluate(element => ({ attached: !!(element as HTMLVideoElement).srcObject, height: (element as HTMLVideoElement).videoHeight, playing: !(element as HTMLVideoElement).paused })), { timeout: 25_000 }).toMatchObject({ attached: true, playing: true });
      await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).videoHeight)).toBeGreaterThan(0);
      const originalHeight = await video.evaluate(element => (element as HTMLVideoElement).videoHeight);
      const decoded = await video.evaluate(element => (element as HTMLVideoElement).getVideoPlaybackQuality().totalVideoFrames);
      await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).getVideoPlaybackQuality().totalVideoFrames)).toBeGreaterThan(decoded + 2);
      const receiverWindow = await app.browserWindow(receiver);
      await receiverWindow.evaluate(window => window.minimize());
      await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).srcObject === null)).toBe(true);
      await foreground(app, receiver);
      await expect.poll(() => video.evaluate(element => !!(element as HTMLVideoElement).srcObject && !(element as HTMLVideoElement).paused)).toBe(true);
      await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).videoHeight)).toBe(originalHeight);
      await foreground(app, sender);
      await sender.getByRole('button', { name: 'Quality & statistics', exact: true }).click();
      await sender.getByLabel('RESOLUTION', { exact: true }).selectOption('480');
      await sender.getByRole('button', { name: 'Apply quality', exact: true }).click();
      await sender.getByRole('button', { name: 'Close dialog', exact: true }).click();
      await foreground(app, receiver);
      await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).videoHeight)).toBe(480);
      await foreground(app, sender);
      await sender.getByRole('button', { name: 'Quality & statistics', exact: true }).click();
      await sender.getByLabel('RESOLUTION', { exact: true }).selectOption('native');
      await sender.getByRole('button', { name: 'Apply quality', exact: true }).click();
      await sender.getByRole('button', { name: 'Close dialog', exact: true }).click();
      await foreground(app, receiver);
      await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).videoHeight)).toBe(originalHeight);
      await foreground(app, sender);
      await sender.getByRole('button', { name: 'Stop sharing', exact: true }).click();
      await expect(receiver.locator('video')).toHaveCount(0);
      await sender.evaluate(() => clearInterval((window as any).qaDraw));
    }
    for (const page of [main, extra]) {
      await page.getByRole('button', { name: 'Disconnect voice', exact: true }).click();
      await expect(page.locator('.voice-connected')).toHaveCount(0);
      await expect.poll(() => page.evaluate(() => {
        const qa = (window as any).qaMedia;
        return qa.streams.every((stream: MediaStream) => stream.getTracks().every(track => track.readyState === 'ended')) && qa.connections.every((peer: RTCPeerConnection) => peer.connectionState === 'closed');
      })).toBe(true);
    }
  } finally { await app.close(); cleanup(profile); }
});
