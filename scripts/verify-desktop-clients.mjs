import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, chromium } from '@playwright/test';
import { watchElectronErrors } from './electron-errors.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const profile = await mkdtemp(path.join(tmpdir(), 'haven-clients-'));
let instance;
let browser;
let assertMainErrors = () => {};
const request = (page, endpoint, data) => page.evaluate(async ({ endpoint, data }) => {
  const response = await fetch(`/api${endpoint}`, { method: data ? 'POST' : 'GET', credentials: 'include', headers: data ? { 'Content-Type': 'application/json' } : undefined, body: data ? JSON.stringify(data) : undefined });
  return { status: response.status, body: await response.json() };
}, { endpoint, data });
const register = async (page, username) => {
  const result = await request(page, '/auth/register', { username, displayName: username, password: 'Independent-Clients-2026' });
  assert.equal(result.status, 201, JSON.stringify(result));
  return result.body.user;
};
try {
  instance = await electron.launch({ args: [root, '--use-fake-device-for-media-stream'], env: { ...process.env, HAVEN_PROFILE_DIR: profile } });
  assertMainErrors = await watchElectronErrors(instance);
  const main = await instance.firstWindow();
  await main.waitForLoadState('domcontentloaded');
  const connection = await main.evaluate(() => window.haven.getConnection());
  assert.equal(connection.url, new URL(main.url()).origin);
  assert.equal(connection.local, true);
  const owner = await register(main, 'desktopaccounta');
  await main.evaluate(() => localStorage.setItem('independent-client-marker', 'Account A'));
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const browserContext = await browser.newContext();
  const browserPage = await browserContext.newPage();
  await browserPage.goto(connection.url);
  assert.equal((await request(browserPage, '/auth/me')).status, 401);
  const browserUser = await register(browserPage, 'browseraccountb');
  assert.notEqual(browserUser.id, owner.id);
  assert.equal((await request(main, '/auth/me')).body.user.id, owner.id);
  const extraPromise = instance.waitForEvent('window');
  await main.evaluate(() => window.haven.openTestClient());
  const extra = await extraPromise;
  await extra.waitForLoadState('domcontentloaded');
  assert.equal(new URL(extra.url()).origin, connection.url);
  assert.equal((await request(extra, '/auth/me')).status, 401);
  assert.equal(await extra.evaluate(() => localStorage.getItem('independent-client-marker')), null);
  const independentUser = await register(extra, 'isolatedaccountc');
  assert.notEqual(independentUser.id, owner.id);
  const microphone = await extra.evaluate(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const live = stream.getAudioTracks().every(track => track.readyState === 'live');
    stream.getTracks().forEach(track => track.stop());
    return { count: stream.getAudioTracks().length, live, ended: stream.getTracks().every(track => track.readyState === 'ended') };
  });
  assert.deepEqual(microphone, { count: 1, live: true, ended: true });
  await extra.evaluate(() => {
    const trigger = document.createElement('button');
    trigger.textContent = 'Verify native fullscreen';
    trigger.onclick = () => { void document.documentElement.requestFullscreen(); };
    document.body.append(trigger);
  });
  await extra.getByRole('button', { name: 'Verify native fullscreen' }).click();
  await extra.waitForFunction(() => document.fullscreenElement === document.documentElement);
  await extra.evaluate(() => document.exitFullscreen());
  await extra.evaluate(() => localStorage.setItem('independent-client-marker', 'Account C'));
  assert.equal((await request(main, '/auth/me')).body.user.id, owner.id);
  assert.equal((await request(browserPage, '/auth/me')).body.user.id, browserUser.id);
  const mainOnly = await extra.evaluate(() => window.haven.connectServer(location.origin).then(() => false, error => error.message));
  assert.match(mainOnly, /main Haven window/);
  await extra.close();
  assert.equal((await request(main, '/auth/me')).body.user.id, owner.id);
  const freshPromise = instance.waitForEvent('window');
  await main.evaluate(() => window.haven.openTestClient());
  const fresh = await freshPromise;
  await fresh.waitForLoadState('domcontentloaded');
  assert.equal((await request(fresh, '/auth/me')).status, 401);
  assert.equal(await fresh.evaluate(() => localStorage.getItem('independent-client-marker')), null);
  assert.equal(await main.evaluate(() => localStorage.getItem('independent-client-marker')), 'Account A');
  for (const address of ['invitecode', 'http://192.168.1.50:3001', 'https://user:password@example.com', `${connection.url}/unrelated`, `${connection.url}?redirect=other`]) {
    const result = await main.evaluate(address => window.haven.connectServer(address).then(() => false, error => error.message), address);
    assert.equal(typeof result, 'string', `Rejected ${address}`);
    assert.equal(new URL(main.url()).origin, connection.url);
  }
  const switchClosed = fresh.waitForEvent('close');
  await main.evaluate(address => { void window.haven.connectServer(address); }, `${connection.url}/invite/desktop-path-check`);
  await main.waitForURL('**/invite/desktop-path-check');
  await switchClosed;
  assert.equal((await request(main, '/auth/me')).body.user.id, owner.id);
  const dependentPromise = instance.waitForEvent('window');
  await main.evaluate(() => window.haven.openTestClient());
  const dependent = await dependentPromise;
  await dependent.waitForLoadState('domcontentloaded');
  const closed = dependent.waitForEvent('close');
  await main.close();
  await closed;
  console.log(JSON.stringify({ pass: true, checks: ['desktop and real Chrome use same backend', 'three independent authenticated accounts', 'isolated local storage', 'isolated client synthetic microphone permission and cleanup', 'isolated client native HTML fullscreen enter and exit', 'fresh test session on reopening', 'closing test client preserves main login', 'main window closes dependent clients', 'unsafe or malformed backend addresses rejected', 'test clients cannot switch shared backend', 'backend connection preserves invitation path and current account'], connection }, null, 2));
} finally {
  await browser?.close();
  await instance?.close().catch(() => {});
  const relative = path.relative(tmpdir(), profile);
  if (relative.startsWith('haven-clients-') && !relative.includes(path.sep)) await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  assertMainErrors();
}
