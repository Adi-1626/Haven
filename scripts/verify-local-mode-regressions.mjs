import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const profile = await mkdtemp(path.join(tmpdir(), 'haven-local-sync-regression-'));
const env = { ...process.env, HAVEN_PROFILE_DIR: profile, HAVEN_MODE: 'local', NODE_ENV: 'development' };
for (const key of Object.keys(env)) if (/SUPABASE|DATABASE_URL|HAVEN_SERVER|HAVEN_ENV_FILE|ELECTRON_RUN_AS_NODE|PUBLIC_URL/.test(key)) delete env[key];
let instance;
let output = '';
try {
  instance = await electron.launch({ args: [root, '--use-fake-device-for-media-stream'], env });
  instance.process().stderr.on('data', chunk => { output += chunk; });
  const main = await instance.firstWindow();
  const register = async (page, username) => {
    page.setDefaultTimeout(12000);
    await page.getByLabel('DISPLAY NAME', { exact: true }).fill(username);
    await page.getByLabel('USERNAME', { exact: true }).fill(username);
    await page.getByLabel('PASSWORD', { exact: true }).fill('Local-sync-regression-2026!');
    await page.getByRole('button', { name: 'Create your account', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Better, together.' })).toBeVisible();
  };
  await register(main, 'syncprimary');
  const secondary = [];
  await expect(main.getByRole('button', { name: 'Test with another account', exact: true })).toHaveCount(0);
  for (let index = 0; index < 3; index++) {
    const opened = instance.waitForEvent('window');
    await main.evaluate(() => window.haven.openTestClient());
    const client = await opened;
    await register(client, `syncsecondary${index}`);
    secondary.push(client);
  }
  for (const page of [main, ...secondary]) {
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'desktop & gaming', exact: true }).click();
  }
  for (const page of secondary) await expect(page.getByLabel('Low-resource gaming mode', { exact: true })).toBeDisabled();
  for (let index = 0; index < 6; index++) {
    const enabled = index % 2 === 0;
    await main.getByLabel('Low-resource gaming mode', { exact: true }).setChecked(enabled);
    for (const page of [main, ...secondary]) {
      await expect(page.getByLabel('Low-resource gaming mode', { exact: true })).toBeChecked({ checked: enabled });
      await expect(page.getByText(/Could not save gaming mode/)).toHaveCount(0);
    }
    await expect.poll(() => main.evaluate(async () => (await window.haven.getDesktopSettings()).settings.gamingMode)).toBe(enabled);
  }
  for (const page of secondary) {
    await page.getByRole('button', { name: 'voice & video', exact: true }).click();
    await page.getByLabel('Voice bitrate', { exact: true }).selectOption('32');
    await expect(page.getByText(/Could not save gaming mode/)).toHaveCount(0);
  }
  await main.waitForTimeout(300);
  assert.doesNotMatch(output, /Change desktop settings in the main Haven window|Error occurred in handler/);
  for (const page of secondary) {
    const denied = await page.evaluate(() => window.haven.updateDesktopSettings({ gamingMode: true }).then(() => '', error => error.message));
    assert.match(denied, /Change desktop settings in the main Haven window/);
  }
  assert.equal((await main.evaluate(() => window.haven.getDesktopSettings())).settings.gamingMode, false);
  console.log(JSON.stringify({ pass: true, clients: 4, toggles: 6, checks: ['UI toggles synchronize to three isolated clients without unauthorized writes', 'secondary shared toggle is disabled', 'secondary bitrate changes do not write desktop settings', 'direct unauthorized IPC writes still rejected', 'final main state remains unchanged after rejected writes'] }, null, 2));
} finally {
  await instance?.close().catch(() => {});
  const relative = path.relative(tmpdir(), profile);
  if (relative.startsWith('haven-local-sync-regression-') && !relative.includes(path.sep)) await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
