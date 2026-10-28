// End-to-end check of desktop automatic updates with real installers on this PC: installs an updater-enabled OLD
// build into a disposable directory, points that copy at a loopback release feed laid out like GitHub Releases
// (/<version>/latest.yml), then drives missing/invalid metadata, an interrupted download, a corrupted download, a
// verified differential download shared by two open Haven windows (separate profiles, one updater cache), the
// voice-call and other-window warnings (Later and Update & Restart), the silent NSIS update that closes both windows,
// the installer's relaunch into the same Local Mode profile, and data continuity in the NEW build. Uses disposable
// HAVEN_PROFILE_DIR profiles only; the real %APPDATA%\Haven profile is only listed to prove it is untouched, and
// %LOCALAPPDATA%\<updater cache> is restored afterwards. Nothing is published.
// Usage: node scripts/verify-auto-update.mjs <old-installer-dir> <new-installer-dir>
import assert from 'node:assert/strict';
import { createReadStream, existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { _electron as electron } from '@playwright/test';

const require = createRequire(import.meta.url);
const { updateFeed, appUpdateYml } = require('../apps/desktop/electron/update-config.cjs');
const [oldDir, newDir] = process.argv.slice(2).map(directory => path.resolve(directory || ''));
if (!process.argv[3]) throw new Error('Usage: node scripts/verify-auto-update.mjs <old-installer-dir> <new-installer-dir>');
const oldInfo = JSON.parse(await readFile(path.join(oldDir, 'INSTALLER-INFO.json'), 'utf8'));
const newInfo = JSON.parse(await readFile(path.join(newDir, 'INSTALLER-INFO.json'), 'utf8'));
assert.notEqual(oldInfo.version, newInfo.version, 'the two installers must have different versions');
const evidence = path.join(newDir, 'auto-update-verification');
await mkdir(evidence, { recursive: true });
const appId = 'electron.app.Haven';
const runKey = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const startMenuLink = path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Haven.lnk');
const realProfile = path.join(process.env.APPDATA, 'Haven');
const cacheDir = path.join(process.env.LOCALAPPDATA, updateFeed.updaterCacheDirName);
const work = await mkdtemp(path.join(tmpdir(), 'haven-autoupdate-'));
const installDir = path.join(work, 'Haven');
const profile = path.join(work, 'profile');
const secondProfile = path.join(work, 'second-profile');
const cacheBackup = path.join(work, 'updater-cache-backup');
const report = { oldVersion: oldInfo.version, newVersion: newInfo.version, startedAt: new Date().toISOString(), checks: [] };
const pass = (name, detail) => { report.checks.push({ name, ok: true, ...(detail === undefined ? {} : { detail }) }); console.log(`PASS ${name}${detail === undefined ? '' : ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`); };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const waitFor = async (condition, label, timeout = 120000) => {
  const deadline = Date.now() + timeout;
  while (!(await condition())) { if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`); await wait(500); }
};
const powershell = script => {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'psmodulepath'));
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true, env });
  if (result.status !== 0) throw new Error(`PowerShell failed: ${result.stderr || result.stdout}`);
  return result.stdout.trim();
};
const asArray = value => Array.isArray(value) ? value : value ? [value] : [];
// Both hives: a stale per-machine record makes NSIS choose an all-users (UAC) install, which HKCU checks alone miss.
const uninstallEntries = () => asArray(JSON.parse(powershell(`@(Get-ChildItem 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall' | ForEach-Object { Get-ItemProperty $_.PSPath } | Where-Object { $_.DisplayName -eq 'Haven' } | Select-Object DisplayVersion, UninstallString) | ConvertTo-Json -Compress -Depth 2`) || '[]'));
const perMachineRecord = () => powershell(`Get-ChildItem 'HKLM:\\Software' -ErrorAction SilentlyContinue | Where-Object { (Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue).ShortcutName -eq 'Haven' } | Select-Object -ExpandProperty Name`);
const ownsEntry = entry => (entry?.UninstallString || '').toLowerCase().includes(installDir.toLowerCase());
const runValue = () => powershell(`(Get-ItemProperty '${runKey}' -Name '${appId}' -ErrorAction SilentlyContinue).'${appId}'`);
// Processes started from the disposable installation only; never anything else named Haven.exe or node.exe.
const installedProcesses = () => asArray(JSON.parse(powershell(`@(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith('${installDir.replaceAll("'", "''")}', [StringComparison]::OrdinalIgnoreCase) } | Select-Object ProcessId, Name, ExecutablePath, CommandLine) | ConvertTo-Json -Compress -Depth 2`) || '[]'));
const stopInstalledProcesses = async () => {
  for (const process of installedProcesses()) spawnSync('taskkill.exe', ['/F', '/T', '/PID', String(process.ProcessId)], { windowsHide: true });
  await waitFor(async () => installedProcesses().length === 0, 'installed Haven processes to exit', 30000);
};
async function listing(directory, base = directory, out = new Map()) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) await listing(full, base, out);
    else { const { size, mtimeMs } = await stat(full); out.set(path.relative(base, full), `${size}:${Math.round(mtimeMs)}`); }
  }
  return out;
}
const localProfile = path.join(process.env.APPDATA, 'Haven Local');
const fingerprint = async (directory = realProfile) => existsSync(directory) ? JSON.stringify([...(await listing(directory))].sort()) : 'absent';
const installedVersion = async () => JSON.parse(await readFile(path.join(installDir, 'resources/app/package.json'), 'utf8').catch(() => '{}')).version;
const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !['haven_node', 'haven_profile_dir', 'electron_run_as_node', 'haven_server'].includes(key.toLowerCase())));
const launch = (profileDir = profile) => electron.launch({ executablePath: path.join(installDir, 'Haven.exe'), args: ['--local-mode', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'], env: { ...environment, HAVEN_PROFILE_DIR: profileDir } });
// Polls from Node: page.waitForFunction treats an async predicate's Promise as truthy and returns at once.
const waitForStatus = (target, status, timeout) => waitFor(async () => (await target.evaluate(() => window.haven.getUpdateState()).catch(() => null))?.status === status, `update status ${status}`, timeout);
const exited = pid => { try { process.kill(pid, 0); return false; } catch { return true; } };

// Loopback release feed laid out like https://github.com/<owner>/<repo>/releases/download/v<version>/.
// electron-updater reports progress at most once a second, so the interrupted download is paced like a real network.
const feed = { latest: 'ok', blockmaps: true, interruptAfter: 0, corrupt: false, paced: false, requests: [] };
const files = {
  [`/${newInfo.version}/latest.yml`]: path.join(newDir, 'latest.yml'),
  [`/${newInfo.version}/Haven-Setup.exe`]: path.join(newDir, 'Haven-Setup.exe'),
  [`/${newInfo.version}/Haven-Setup.exe.blockmap`]: path.join(newDir, 'Haven-Setup.exe.blockmap'),
  [`/${oldInfo.version}/Haven-Setup.exe.blockmap`]: path.join(oldDir, 'Haven-Setup.exe.blockmap'),
};
const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1').pathname;
  const record = { url, range: request.headers.range || null, status: 200, bytes: 0, startedAt: Date.now(), endedAt: null };
  response.on('close', () => { record.endedAt = Date.now(); });
  feed.requests.push(record);
  const file = files[url];
  if (!file || (url.endsWith('.blockmap') && !feed.blockmaps) || (url.endsWith('latest.yml') && feed.latest === 'missing')) { record.status = 404; response.writeHead(404).end('Not Found'); return; }
  if (url.endsWith('latest.yml') && feed.latest === 'invalid') { response.writeHead(200, { 'content-type': 'text/yaml' }).end('version: [not, valid\nfiles: {{{\n'); return; }
  const { size } = await stat(file);
  const match = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range || '');
  const start = match ? Number(match[1]) : 0;
  const end = match && match[2] ? Number(match[2]) : size - 1;
  record.status = match ? 206 : 200;
  response.writeHead(record.status, { 'content-type': 'application/octet-stream', 'content-length': end - start + 1, 'accept-ranges': 'bytes', ...(match ? { 'content-range': `bytes ${start}-${end}/${size}` } : {}) });
  let offset = start;
  const stream = createReadStream(file, { start, end });
  stream.on('data', chunk => {
    if (feed.corrupt && url.endsWith('.exe') && offset <= 1048576 && offset + chunk.length > 1048576) { chunk = Buffer.from(chunk); chunk[1048576 - offset] ^= 0xff; }
    offset += chunk.length;
    record.bytes += chunk.length;
    stream.pause();
    const resume = feed.paced && url.endsWith('.exe') ? () => setTimeout(() => stream.resume(), feed.paced) : () => stream.resume();
    if (response.write(chunk)) resume(); else response.once('drain', resume);
    if (feed.interruptAfter && url.endsWith('.exe') && record.bytes >= feed.interruptAfter) { stream.destroy(); response.destroy(); }
  });
  stream.on('end', () => response.end());
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const feedUrl = `http://127.0.0.1:${server.address().port}/${newInfo.version}/`;

const existing = uninstallEntries();
if (existing.length) throw new Error('Haven is already installed for this user. Uninstall it first; verification never replaces a real installation.');
if (runValue()) throw new Error(`A "${appId}" startup entry already exists; refusing to modify it.`);
if (existsSync(startMenuLink)) throw new Error(`${startMenuLink} already exists; refusing to replace it.`);
if (perMachineRecord()) throw new Error(`A per-machine Haven install record exists (${perMachineRecord()}); test installs would require administrator approval. Remove it first.`);
const profileBefore = await fingerprint();
const localProfileBefore = await fingerprint(localProfile);
const hadCache = existsSync(cacheDir);
if (hadCache) await cp(cacheDir, cacheBackup, { recursive: true });

let app;
let second;
try {
  // 1. Install the old updater-enabled build exactly as a user would have it.
  let result = spawnSync(path.join(oldDir, 'Haven-Setup.exe'), ['/S', '/currentuser', `/D=${installDir}`], { windowsHide: true, timeout: 300000 });
  assert.equal(result.status, 0, `old installer exit code ${result.status}`);
  assert.equal(await installedVersion(), oldInfo.version);
  assert.equal(uninstallEntries().filter(ownsEntry).length, 1, 'per-user Apps & Features entry');
  assert.equal(perMachineRecord(), '', 'installed per user, without elevation');
  assert.equal(await readFile(path.join(installDir, 'resources/app-update.yml'), 'utf8'), appUpdateYml());
  pass('installed old build carries the official GitHub update feed', path.join(installDir, 'resources/app-update.yml'));
  assert.ok(existsSync(path.join(cacheDir, 'installer.exe')), 'NSIS stored its installer for differential updates');
  await writeFile(path.join(installDir, 'resources/app-update.yml'), `provider: generic\nurl: ${feedUrl}\nuseMultipleRangeRequest: false\nupdaterCacheDirName: ${updateFeed.updaterCacheDirName}\n`);

  // 2. Launch it in Local Mode with a disposable profile and create data that must survive the update.
  app = await launch();
  let page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  assert.equal(await app.evaluate(({ app }) => app.getVersion()), oldInfo.version);
  const request = (endpoint, data) => page.evaluate(async ({ endpoint, data }) => {
    const response = await fetch(`/api${endpoint}`, { method: data ? 'POST' : 'GET', credentials: 'include', headers: data ? { 'Content-Type': 'application/json' } : undefined, body: data ? JSON.stringify(data) : undefined });
    return { status: response.status, body: await response.json().catch(() => null) };
  }, { endpoint, data });
  await waitFor(async () => (await request('/health').catch(() => ({ status: 0 }))).status === 200, 'local backend health');
  const username = `updater${Date.now().toString(36)}`;
  const password = 'Updater-Verification-2026';
  assert.equal((await request('/auth/register', { username, displayName: 'Update Check', password })).status, 201);
  const community = await request('/servers', { name: 'Update Continuity' });
  assert.equal(community.status, 201, JSON.stringify(community));
  assert.equal((await request('/messages', { channelId: community.body.channel.id, content: 'Written before the update' })).status, 201);
  await page.evaluate(() => window.haven.updateDesktopSettings({ minimizeToTray: true, muteShortcut: 'Control+Shift+F9' }));
  await page.reload();
  await page.locator('.topbar').waitFor({ state: 'visible', timeout: 30000 });
  let state = await page.evaluate(() => window.haven.getUpdateState());
  assert.deepEqual([state.status, state.currentVersion], ['idle', oldInfo.version]);
  pass('installed copy supports updates and starts idle with no toolbar indicator', { visible: await page.locator('[data-testid=desktop-update-button]').count() });
  assert.equal(await page.locator('[data-testid=desktop-update-button]').count(), 0);
  await page.evaluate(() => { window.updateStates = []; window.haven.onUpdateState(next => window.updateStates.push(next)); });
  const check = () => page.evaluate(() => window.haven.checkForUpdates());

  // 3. Broken release metadata.
  feed.latest = 'missing';
  state = await check();
  assert.deepEqual([state.status, state.errorKind], ['failed', 'metadata']);
  pass('missing latest.yml is reported and not retried aggressively', state.error);
  feed.latest = 'invalid';
  state = await check();
  assert.deepEqual([state.status, state.errorKind], ['failed', 'metadata']);
  pass('invalid latest.yml is reported', state.error);
  assert.deepEqual({ ...(await page.evaluate(() => window.haven.installUpdate({ confirmedDisconnect: true }))), message: undefined }, { ok: false, code: 'FAILED', message: undefined });
  pass('Update & Restart is refused before a verified download exists');

  // 4. Interrupted download (full download path), then a corrupted download.
  feed.latest = 'ok';
  feed.blockmaps = false;
  feed.interruptAfter = 24 * 1024 * 1024;
  feed.paced = 15;
  state = await check();
  feed.paced = 0;
  report.interruptedStates = await page.evaluate(() => window.updateStates.map(next => ({ status: next.status, progress: next.progress, error: next.error })));
  const progress = report.interruptedStates.filter(next => next.status === 'downloading' && next.progress?.percent > 0);
  assert.ok(progress.length > 0, 'download progress was reported');
  assert.equal(state.status === 'failed' || state.status === 'offline', true, JSON.stringify(state));
  assert.equal(state.availableVersion, newInfo.version);
  await page.screenshot({ path: path.join(evidence, 'interrupted-download.png') });
  pass('interrupted download reports progress, then a retryable error with the pending version still shown', { lastPercent: Math.round(progress.at(-1).progress.percent), error: state.error, kind: state.errorKind });
  assert.equal(await page.locator('[data-testid=desktop-update-button]').getAttribute('class').then(value => value.includes('is-attention')), true);
  feed.interruptAfter = 0;
  feed.corrupt = true;
  state = await check();
  assert.deepEqual([state.status, state.errorKind], ['failed', 'integrity'], JSON.stringify(state));
  pass('a corrupted download fails sha512 verification and is discarded', state.error);
  assert.equal((await readdir(path.join(cacheDir, 'pending')).catch(() => [])).some(name => name.endsWith('.exe') && !name.startsWith('temp')), false);

  // 5. A clean, differential download, while a second installed window (another disposable profile) shares the
  // per-user updater cache: it must wait instead of emptying pending\, then reuse the verified download.
  feed.corrupt = false;
  feed.blockmaps = true;
  second = await launch(secondProfile);
  const secondPage = await second.firstWindow();
  await secondPage.waitForLoadState('domcontentloaded');
  await waitFor(async () => (await secondPage.evaluate(() => window.haven?.getUpdateState?.()).catch(() => null))?.status === 'idle', 'second window updater');
  const before = feed.requests.length;
  await page.evaluate(() => { window.updateStates = []; });
  feed.paced = 60;
  const firstDownload = check();
  await waitForStatus(page, 'downloading', 60000);
  const secondState = await secondPage.evaluate(() => window.haven.checkForUpdates());
  assert.deepEqual([secondState.status, secondState.availableVersion], ['waiting', newInfo.version], JSON.stringify(secondState));
  await secondPage.screenshot({ path: path.join(evidence, 'second-window-waiting.png') });
  pass('a second window waits while the first downloads into the shared cache', { status: secondState.status, version: secondState.availableVersion });
  state = await firstDownload;
  if (state.status === 'downloading') await waitForStatus(page, 'ready', 300000);
  feed.paced = 0;
  state = await page.evaluate(() => window.haven.getUpdateState());
  assert.equal(state.status, 'ready', JSON.stringify(state));
  const transferred = feed.requests.slice(before).filter(entry => entry.url.endsWith('.exe')).reduce((sum, entry) => sum + entry.bytes, 0);
  pass('verified update downloaded in the background', { version: state.availableVersion, installerBytesTransferred: transferred, installerBytes: newInfo.bytes, differential: transferred < newInfo.bytes / 2 });
  const afterFirst = feed.requests.length;
  await waitForStatus(secondPage, 'ready', 60000);
  assert.ok((await secondPage.evaluate(() => window.haven.getUpdateState())).lastCheckedAt, 'the second window reached ready itself');
  const reused = feed.requests.slice(afterFirst).filter(entry => entry.url.endsWith('.exe')).reduce((sum, entry) => sum + entry.bytes, 0);
  assert.equal(reused, 0, 'the second window downloaded nothing');
  pass('the second window became ready from the first window\'s verified download', { installerBytesTransferred: reused });
  await page.locator('[data-testid=desktop-update-button].is-ready').waitFor({ state: 'visible' });
  // The dialog opens only from a click; an open one here means someone used the test window.
  assert.equal(await page.locator('[data-testid=desktop-update-dialog]').count(), 0, 'update dialog opened without a click from this test (do not use the test window while it runs)');
  await page.screenshot({ path: path.join(evidence, 'toolbar-ready.png') });
  pass('toolbar shows the update-ready indicator');

  // 6. Main-process guard: the renderer cannot install silently while voice or sharing is active.
  for (const voice of [{ connected: true, sharing: false }, { connected: false, sharing: true }]) {
    await page.evaluate(next => window.haven.setVoiceState({ muted: false, deafened: false, ...next }), voice);
    const refused = await page.evaluate(() => window.haven.installUpdate({ confirmedDisconnect: false }));
    assert.deepEqual([refused.ok, refused.code], [false, 'ACTIVE_CALL']);
  }
  await page.evaluate(() => window.haven.setVoiceState({ connected: false, muted: false, deafened: false, sharing: false }));
  assert.equal((await page.evaluate(() => window.haven.getUpdateState())).status, 'ready');
  pass('main process refuses an unconfirmed install during voice and during screen sharing');
  for (const [name, target] of [['first', page], ['second', secondPage]]) {
    const before = await target.evaluate(() => window.haven.getUpdateState());
    const refused = await target.evaluate(() => window.haven.installUpdate({ confirmedDisconnect: false }));
    assert.deepEqual([refused.ok, refused.code], [false, 'OTHER_WINDOWS'], JSON.stringify({ name, refused, before }));
    assert.match(refused.message, /also open in another window/);
  }
  assert.deepEqual(await Promise.all([page, secondPage].map(target => target.evaluate(async () => (await window.haven.getUpdateState()).status))), ['ready', 'ready']);
  pass('neither window installs unconfirmed while the other is open (the installer would close it)');

  // 7. A real Haven voice call, the warning, Later, then Update & Restart.
  await page.getByRole('button', { name: 'Update Continuity', exact: true }).click();
  await page.locator('.channel-row button', { hasText: 'Lounge' }).first().click();
  await page.getByRole('button', { name: 'Disconnect voice' }).waitFor({ state: 'visible', timeout: 30000 });
  pass('joined the Lounge voice channel with the fake microphone');
  await page.locator('[data-testid=desktop-update-button]').click();
  const dialog = page.locator('[data-testid=desktop-update-dialog]');
  await dialog.waitFor({ state: 'visible' });
  await wait(300);
  await page.screenshot({ path: path.join(evidence, 'update-dialog-ready.png') });
  const dialogText = await dialog.textContent();
  assert.match(dialogText, new RegExp(`Current version${oldInfo.version.replaceAll('.', '\\.')}`));
  assert.match(dialogText, new RegExp(`Available version${newInfo.version.replaceAll('.', '\\.')}`));
  assert.equal(await page.locator('[data-testid=desktop-update-install]').isVisible(), true);
  await page.locator('[data-testid=desktop-update-install]').click();
  const warning = page.locator('[data-testid=desktop-update-disconnect]');
  await warning.waitFor({ state: 'visible' });
  assert.match(await warning.textContent(), /Updating Haven will close the app and disconnect you from your current voice call or stream\. You'll need to rejoin after the update\./);
  assert.match(await warning.textContent(), /Haven is also open in another window \(a separate profile or Local Mode\); it will close too\./);
  await page.screenshot({ path: path.join(evidence, 'voice-warning.png') });
  await page.locator('[data-testid=desktop-update-disconnect-cancel]').click();
  await warning.waitFor({ state: 'detached' });
  await page.locator('[data-testid=desktop-update-later]').click();
  await dialog.waitFor({ state: 'detached' });
  await wait(1500);
  assert.equal(await page.getByRole('button', { name: 'Disconnect voice' }).isVisible(), true);
  assert.equal((await page.evaluate(() => window.haven.getUpdateState())).status, 'ready');
  assert.equal(installedProcesses().some(process => /Haven-Setup/i.test(process.Name)), false);
  pass('Later keeps the call connected, the app open and the update ready');

  await page.locator('[data-testid=desktop-update-button]').click();
  await page.locator('[data-testid=desktop-update-install]').click();
  await warning.waitFor({ state: 'visible' });
  const relaunchStarted = Date.now();
  const mainPid = app.process().pid;
  const secondPid = second.process().pid;
  await app.evaluate(({ app }) => { global.updateQuitTrace = []; for (const event of ['before-quit', 'will-quit', 'quit']) app.on(event, () => global.updateQuitTrace.push(event)); });
  await page.locator('[data-testid=desktop-update-disconnect-confirm]').click();
  // Playwright's close event can lag while the spawned installer holds inherited handles; watch the process itself.
  try { await waitFor(async () => exited(mainPid), 'Haven to exit for the installer', 60000); }
  catch (error) {
    report.quitDiagnostics = {
      processes: installedProcesses(),
      trace: await app.evaluate(() => global.updateQuitTrace).catch(failure => failure.message),
      state: await page.evaluate(() => window.haven.getUpdateState()).catch(failure => failure.message),
      dialog: await page.locator('[data-testid=desktop-update-disconnect]').textContent().catch(() => null),
    };
    await page.screenshot({ path: path.join(evidence, 'quit-timeout.png') }).catch(() => {});
    throw error;
  }
  await app.close().catch(() => {});
  app = undefined;
  pass('Update & Restart leaves voice and closes Haven for the installer');
  await waitFor(async () => exited(secondPid), 'the installer to close the second window', 120000);
  await second.close().catch(() => {});
  second = undefined;
  pass('the silent installer closed the second window too, as the warning said');

  // 8. The installer replaces the files silently and relaunches into the same Local Mode profile.
  await waitFor(async () => (await installedVersion()) === newInfo.version, 'installed files to reach the new version', 240000);
  await waitFor(async () => installedProcesses().some(process => process.Name === 'Haven.exe' && /--updated/.test(process.CommandLine || '')), 'installer to relaunch Haven', 120000);
  pass('silent NSIS update installed the new version and relaunched Haven', { version: await installedVersion() });
  await waitFor(async () => installedProcesses().some(process => process.Name === 'node.exe'), 'relaunched Local Mode backend', 60000);
  assert.equal(existsSync(path.join(cacheDir, 'relaunch.json')), false, 'relaunch intent consumed');
  assert.equal(installedProcesses().some(process => (process.CommandLine || '').toLowerCase().includes(secondProfile.toLowerCase())), false, 'only the installing window is relaunched');
  await waitFor(async () => !existsSync(path.join(cacheDir, 'installing.json')), 'the relaunched new version to clear the install marker', 30000);
  pass('the relaunched new version cleared the install marker; the other window was not relaunched');
  // Without the restored --profile the relaunch would write to %APPDATA%\Haven or %APPDATA%\Haven Local instead.
  await waitFor(async () => [...(await listing(profile)).values()].some(value => Number(value.split(':')[1]) >= relaunchStarted), 'relaunched instance to write to the disposable profile', 30000);
  assert.equal(await fingerprint(localProfile), localProfileBefore, 'default Local Mode profile untouched');
  pass('relaunch restored Local Mode and the disposable profile (bundled backend running, profile in use)');
  assert.equal(await readFile(path.join(installDir, 'resources/app-update.yml'), 'utf8'), appUpdateYml());
  pass('the update restored the official update feed');
  const entries = uninstallEntries();
  assert.equal(entries.filter(ownsEntry).length, 1, JSON.stringify(entries));
  assert.equal(entries[0].DisplayVersion, newInfo.version, JSON.stringify(entries));
  pass('exactly one Apps & Features entry, now at the new version');
  await stopInstalledProcesses();

  // 9. The new build keeps the session, local database and settings.
  app = await launch();
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  assert.equal(await app.evaluate(({ app }) => app.getVersion()), newInfo.version);
  await waitFor(async () => (await request('/health').catch(() => ({ status: 0 }))).status === 200, 'local backend health after update');
  const boot = await request('/bootstrap');
  assert.equal(boot.status, 200, 'still signed in without entering the password');
  assert.ok(boot.body.servers.some(item => item.name === 'Update Continuity'), 'community kept');
  const messages = await request(`/messages?channelId=${community.body.channel.id}`);
  assert.ok(messages.body.messages.some(message => message.content === 'Written before the update'), 'message history kept');
  const desktopState = await page.evaluate(() => window.haven.getDesktopSettings());
  assert.deepEqual([desktopState.settings.minimizeToTray, desktopState.settings.muteShortcut], [true, 'Control+Shift+F9']);
  state = await page.evaluate(() => window.haven.getUpdateState());
  assert.deepEqual([state.status, state.currentVersion], ['idle', newInfo.version]);
  await page.locator('.topbar').waitFor({ state: 'visible', timeout: 30000 });
  await page.screenshot({ path: path.join(evidence, 'after-update.png') });
  pass('after the update: same sign-in session, community, messages and desktop settings; updater idle on the new version');
  await app.close();
  app = undefined;

  // 10. Uninstall the disposable installation.
  result = spawnSync(path.join(installDir, 'Uninstall Haven.exe'), ['/S'], { windowsHide: true, timeout: 300000 });
  assert.equal(result.status, 0);
  await waitFor(async () => !uninstallEntries().some(ownsEntry), 'uninstall to finish');
  pass('disposable installation removed');
  report.success = true;
} catch (error) {
  report.success = false;
  report.failure = error.stack;
  console.error(error);
  process.exitCode = 1;
} finally {
  await app?.close().catch(() => {});
  await second?.close().catch(() => {});
  await stopInstalledProcesses().catch(() => {});
  if (uninstallEntries().some(ownsEntry) && existsSync(path.join(installDir, 'Uninstall Haven.exe'))) {
    spawnSync(path.join(installDir, 'Uninstall Haven.exe'), ['/S'], { windowsHide: true, timeout: 300000 });
    await waitFor(async () => !uninstallEntries().some(ownsEntry), 'cleanup uninstall').catch(() => {});
  }
  const leftover = runValue();
  if (leftover && leftover.includes(installDir)) powershell(`Remove-ItemProperty '${runKey}' -Name '${appId}'`);
  server.close();
  // Put the per-user updater cache back exactly as it was (it held the real v1.0.0 installer copy).
  await rm(cacheDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  if (hadCache) await cp(cacheBackup, cacheDir, { recursive: true });
  report.updaterCacheRestored = hadCache ? existsSync(path.join(cacheDir, 'installer.exe')) : !existsSync(cacheDir);
  report.realProfileUnchanged = profileBefore === await fingerprint();
  report.leftoverInstall = uninstallEntries().some(ownsEntry);
  report.success = report.success === true && report.realProfileUnchanged && report.updaterCacheRestored && !report.leftoverInstall;
  if (report.realProfileUnchanged) pass('real %APPDATA%\\Haven profile untouched (listing identical before and after)');
  report.feedRequests = feed.requests.map(({ url, range, status, bytes, startedAt, endedAt }) => ({ url, range, status, bytes, ms: endedAt && endedAt - startedAt }));
  report.finishedAt = new Date().toISOString();
  await writeFile(path.join(evidence, 'auto-update-verification.json'), `${JSON.stringify(report, null, 2)}\n`);
  if (report.leftoverInstall) console.error(`Test installation still registered at ${installDir}; run its "Uninstall Haven.exe" /S.`);
  else await rm(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }).catch(() => {});
  console.log(report.success ? 'AUTO-UPDATE VERIFICATION PASSED' : 'AUTO-UPDATE VERIFICATION FAILED');
  if (!report.success) process.exitCode = 1;
}
