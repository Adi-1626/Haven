import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, mkdir, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { _electron as electron, chromium } from '@playwright/test';
import { watchElectronErrors } from './electron-errors.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const argumentsList = process.argv.slice(2);
const executableArgument = argumentsList[0] && !argumentsList[0].startsWith('--') ? argumentsList.shift() : undefined;
if (argumentsList.length && (argumentsList.length !== 2 || argumentsList[0] !== '--previous')) throw new Error('Usage: node scripts/verify-package.mjs [Haven.exe] [--previous PreviousHaven.exe]');
const previousExecutable = argumentsList.length ? path.resolve(argumentsList[1]) : undefined;
const executable = path.resolve(executableArgument || path.join(root, 'release', `Haven-${manifest.version}-win32-x64`, 'Haven.exe'));
const bundle = path.dirname(executable);
const packagedApp = path.join(bundle, 'resources', 'app');
const metadata = JSON.parse(await readFile(path.join(bundle, 'PACKAGE-INFO.json'), 'utf8'));
const digest = contents => createHash('sha256').update(contents).digest('hex');
const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !['path', 'haven_node', 'haven_profile_dir', 'electron_run_as_node'].includes(key.toLowerCase())));
assert.equal(Object.keys(environment).some(key => key.toLowerCase() === 'path'), false);
assert.equal(Object.keys(environment).some(key => key.toLowerCase() === 'haven_node'), false);
const profile = await mkdtemp(path.join(tmpdir(), 'haven-package-'));
const password = 'Packaged-Verification-2026';
let instance;
let browser;
const mainErrorChecks = [];
const request = (page, endpoint, data) => page.evaluate(async ({ endpoint, data }) => {
  const response = await fetch(`/api${endpoint}`, { method: data ? 'POST' : 'GET', credentials: 'include', headers: data ? { 'Content-Type': 'application/json' } : undefined, body: data ? JSON.stringify(data) : undefined });
  return { status: response.status, body: await response.json() };
}, { endpoint, data });
const register = async (page, username) => {
  const result = await request(page, '/auth/register', { username, displayName: username, password });
  assert.equal(result.status, 201, JSON.stringify(result));
  return result.body.user;
};
async function files(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...await files(entryPath));
    else if (entry.isFile()) found.push(entryPath);
  }
  return found;
}
async function launch(executablePath = executable, expectedVersion = metadata.version) {
  const app = await electron.launch({ executablePath, args: [], env: { ...environment, HAVEN_PROFILE_DIR: profile } });
  mainErrorChecks.push(await watchElectronErrors(app));
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  assert.equal(await app.evaluate(({ app }) => app.getVersion()), expectedVersion);
  assert.equal(path.resolve(await app.evaluate(({ app }) => app.getPath('userData'))), path.resolve(profile));
  return { app, page };
}
async function createOwner(page) {
  await page.getByLabel('DISPLAY NAME', { exact: true }).fill('Packaged Account A');
  await page.getByLabel('USERNAME', { exact: true }).fill('packagedaccounta');
  await page.getByLabel('PASSWORD', { exact: true }).fill(password);
  const registration = page.waitForResponse(response => response.url().endsWith('/api/auth/register') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Create your account', exact: true }).click();
  assert.equal((await registration).status(), 201);
  await page.getByRole('heading', { name: 'Better, together.' }).waitFor();
  return (await request(page, '/auth/me')).body.user;
}
async function createCommunity(page) {
  await page.getByRole('button', { name: 'Create a server', exact: true }).first().click();
  await page.getByLabel('SERVER NAME').fill('Packaged persistence lab');
  await page.getByRole('button', { name: 'Create server', exact: true }).click();
  await page.getByRole('heading', { name: 'Welcome to #general', exact: true }).waitFor();
  const community = (await request(page, '/bootstrap')).body.servers.find(server => server.name === 'Packaged persistence lab');
  assert.ok(community);
  return community;
}
try {
  await stat(path.join(bundle, 'PACKAGING-COMPLETE.txt'));
  for (const license of ['LICENSE', 'LICENSES.chromium.html', 'THIRD_PARTY_NOTICES.txt', 'resources/node/LICENSE']) assert.ok((await stat(path.join(bundle, license))).size > 0);
  const payload = [];
  for (const directory of ['electron', 'build', 'dist']) {
    for (const source of await files(path.join(root, directory))) {
      const relative = path.relative(root, source);
      const sourceHash = digest(await readFile(source));
      const packagedHash = digest(await readFile(path.join(packagedApp, relative)));
      assert.equal(packagedHash, sourceHash, `Packaged file differs from current source: ${relative}`);
      payload.push({ file: relative.split(path.sep).join('/'), sha256: packagedHash });
    }
  }
  let owner;
  let community;
  let previousVersion;
  let previousInvite;
  let previousDatabaseHash;
  if (previousExecutable) {
    const previousManifest = JSON.parse(await readFile(path.join(path.dirname(previousExecutable), 'resources', 'app', 'package.json'), 'utf8'));
    previousVersion = previousManifest.version;
    const previous = await launch(previousExecutable, previousVersion);
    instance = previous.app;
    owner = await createOwner(previous.page);
    community = await createCommunity(previous.page);
    const invitation = await request(previous.page, `/servers/${community.id}/invites`, {});
    assert.equal(invitation.status, 201);
    previousInvite = invitation.body.code;
    await instance.close(); instance = null;
    previousDatabaseHash = digest(await readFile(path.join(profile, 'server', 'relay.sqlite')));
  }
  const first = await launch();
  instance = first.app;
  const main = first.page;
  if (previousExecutable) {
    const preserved = await request(main, '/auth/me');
    assert.equal(preserved.status, 200);
    assert.equal(preserved.body.user.id, owner.id);
    assert.ok((await request(main, '/bootstrap')).body.servers.some(server => server.id === community.id));
    await main.locator('.my-profile').filter({ hasText: owner.displayName }).waitFor();
    assert.equal((await request(main, `/invites/${previousInvite}`)).status, 200);
  } else {
    owner = await createOwner(main);
    community = await createCommunity(main);
  }
  const connection = await main.evaluate(() => window.haven.getConnection());
  const health = await main.request.get(`${connection.url}/api/health`);
  assert.equal(health.status(), 200);
  assert.equal((await health.json()).ok, true);
  const clientAsset = await main.locator('script[type="module"][src]').first().getAttribute('src');
  const clientAssetPath = new URL(clientAsset, connection.url).pathname;
  const servedClient = await main.request.get(new URL(clientAsset, connection.url).href);
  assert.equal(servedClient.status(), 200);
  const servedClientHash = digest(await servedClient.body());
  assert.equal(servedClientHash, digest(await readFile(path.join(packagedApp, 'dist', clientAssetPath))));
  const invitation = await request(main, `/servers/${community.id}/invites`, {});
  assert.equal(invitation.status, 201);
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const browserContext = await browser.newContext();
  const browserPage = await browserContext.newPage();
  await browserPage.goto(connection.url);
  assert.equal((await request(browserPage, '/auth/me')).status, 401);
  const browserUser = await register(browserPage, 'packagedaccountb');
  assert.notEqual(browserUser.id, owner.id);
  assert.equal((await request(browserPage, `/invites/${previousInvite || invitation.body.code}/join`, {})).status, 200);
  assert.ok((await request(browserPage, '/bootstrap')).body.servers.some(server => server.id === community.id));
  const friendRequest = await request(main, '/friends/requests', { username: browserUser.username });
  assert.equal(friendRequest.status, 201);
  assert.equal((await request(browserPage, `/friends/requests/${friendRequest.body.request.id}/accept`, {})).status, 200);
  assert.ok((await request(main, '/bootstrap')).body.friends.includes(browserUser.id));
  const childPromise = instance.waitForEvent('window');
  await main.evaluate(() => window.haven.openTestClient());
  const child = await childPromise;
  await child.waitForLoadState('domcontentloaded');
  assert.equal((await request(child, '/auth/me')).status, 401);
  const childUser = await register(child, 'packagedaccountc');
  assert.notEqual(childUser.id, owner.id);
  assert.equal((await request(main, '/auth/me')).body.user.id, owner.id);
  assert.equal((await request(browserPage, '/auth/me')).body.user.id, browserUser.id);
  await child.close();
  assert.equal((await request(main, '/auth/me')).body.user.id, owner.id);
  await browser.close(); browser = null;
  await instance.close(); instance = null;
  const bundledNode = path.join(bundle, 'resources', 'node', 'node.exe');
  const native = spawnSync(bundledNode, ['--input-type=commonjs', '-e', "const Database = require('better-sqlite3'); const database = new Database(process.argv[1], {readonly:true}); console.log(JSON.stringify({node:process.version,abi:process.versions.modules,sqlite:database.prepare('select sqlite_version() as version').get().version,users:database.prepare('select username from users order by username').all(),communities:database.prepare('select name from servers order by name').all()})); database.close();", path.join(profile, 'server', 'relay.sqlite')], { cwd: packagedApp, env: environment, encoding: 'utf8', windowsHide: true });
  assert.equal(native.status, 0, native.stderr || native.error?.message);
  const nativeResult = JSON.parse(native.stdout.trim());
  assert.deepEqual(nativeResult.users.map(user => user.username), ['packagedaccounta', 'packagedaccountb', 'packagedaccountc']);
  assert.ok(nativeResult.communities.some(community => community.name === 'Packaged persistence lab'));
  const second = await launch();
  instance = second.app;
  const restarted = second.page;
  const restartedAuth = await request(restarted, '/auth/me');
  assert.equal(restartedAuth.status, 200);
  assert.equal(restartedAuth.body.user.id, owner.id);
  const persistent = (await request(restarted, '/bootstrap')).body;
  assert.ok(persistent.servers.some(server => server.id === community.id));
  assert.ok(persistent.friends.includes(browserUser.id));
  const login = await request(restarted, '/auth/login', { username: owner.username, password });
  assert.equal(login.status, 200);
  assert.equal(login.body.user.id, owner.id);
  const restartedConnection = await restarted.evaluate(() => window.haven.getConnection());
  const freshPromise = instance.waitForEvent('window');
  await restarted.evaluate(() => window.haven.openTestClient());
  const fresh = await freshPromise;
  await fresh.waitForLoadState('domcontentloaded');
  assert.equal((await request(fresh, '/auth/me')).status, 401);
  await fresh.getByRole('button', { name: 'Sign in', exact: true }).click();
  await fresh.getByLabel('USERNAME', { exact: true }).fill(` @${owner.username.toUpperCase()} `);
  await fresh.getByLabel('PASSWORD', { exact: true }).fill(password);
  const formLogin = fresh.waitForResponse(response => response.url().endsWith('/api/auth/login') && response.request().method() === 'POST');
  await fresh.getByRole('button', { name: 'Sign in', exact: true }).click();
  assert.equal((await formLogin).status(), 200);
  await fresh.locator('.my-profile').filter({ hasText: owner.displayName }).waitFor();
  assert.equal((await request(fresh, '/auth/me')).body.user.id, owner.id);
  assert.equal((await request(restarted, '/auth/me')).body.user.id, owner.id);
  const childClosed = fresh.waitForEvent('close');
  await instance.close(); instance = null;
  await childClosed;
  const bundleFiles = await files(bundle);
  const bytes = (await Promise.all(bundleFiles.map(file => stat(file)))).reduce((total, entry) => total + entry.size, 0);
  const report = { pass: true, verifiedAt: new Date().toISOString(), executable, version: metadata.version, bytes, fileCount: bundleFiles.length, payloadFileCount: payload.length, payload, productionPackageCount: metadata.productionPackageCount, executableSha256: digest(await readFile(executable)), nodeSha256: digest(await readFile(bundledNode)), servedClientAsset: clientAssetPath, servedClientSha256: servedClientHash, indexHtmlSha256: digest(await readFile(path.join(packagedApp, 'dist', 'index.html'))), native: nativeResult, checks: ['exact versioned executable', 'all PATH variables removed', 'HAVEN_NODE unset', 'all current electron/build/dist payload hashes match', 'licensing files retained', 'visible account creation and authenticated UI', 'served asset matches packaged bytes', 'real independent Chrome account joins invitation and accepts friend request', 'isolated Electron third account preserves desktop and browser sessions', 'bundled Node queries persisted packaged SQLite with no PATH', 'restart preserves desktop login, community and friendship', 'password login after restart', 'fresh isolated session after restart', 'closing owner closes dependent test client', ...(previousExecutable ? ['old executable creates isolated owner profile', 'upgrade preserves existing login and community without signing in', 'legacy invitation previews and redeems after migration', 'new invitation creates after legacy database migration'] : [])], upgrade: previousExecutable ? { previousExecutable, previousVersion, oldProfileOnly: true, previousDatabaseSha256: previousDatabaseHash, preservedLogin: true, preservedCommunity: true, legacyInviteRedeemed: true } : null, firstOrigin: connection.url, restartedOrigin: restartedConnection.url, realMicrophoneTested: false, realScreenCaptureTested: false };
  await mkdir(path.join(root, 'test-results'), { recursive: true });
  const reportPath = path.join(root, 'test-results', `package-${previousExecutable ? 'upgrade' : 'verification'}-${metadata.version}.json`);
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ ...report, payload: `${payload.length} matching files; detailed hashes in ${reportPath}`, reportPath }, null, 2));
} finally {
  await browser?.close();
  await instance?.close().catch(() => {});
  const relative = path.relative(tmpdir(), profile);
  if (relative.startsWith('haven-package-') && !relative.includes(path.sep)) await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  for (const check of mainErrorChecks) check();
}
