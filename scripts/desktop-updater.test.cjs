const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const root = path.resolve(__dirname, '..');
const electronDir = path.join(root, 'apps/desktop/electron');
const { updateFeed, appUpdateYml, parseAppUpdateYml, trustedFeed } = require(path.join(electronDir, 'update-config.cjs'));
const { createUpdater, updateSupport, classifyUpdateError, plainReleaseNotes, confirmationMessage, relaunchArgs, relaunchStore, takeRelaunchArgs, hashFile, CHECK_INTERVAL, FIRST_CHECK_DELAY, RETRY_DELAYS, LOCK_RETRY } = require(path.join(electronDir, 'updater.cjs'));
const { createUpdateCoordinator, listenExclusive, lockName, INSTALL_GRACE } = require(path.join(electronDir, 'update-coordination.cjs'));

const installed = { 'C:\\Haven\\resources\\app-update.yml': appUpdateYml(), 'C:\\Haven\\Uninstall Haven.exe': '' };
const support = (overrides = {}, files = installed) => updateSupport({ app: { isPackaged: true }, platform: 'win32', execPath: 'C:\\Haven\\Haven.exe', resourcesPath: 'C:\\Haven\\resources', readFile: file => { if (!(file in files)) throw Object.assign(new Error('missing'), { code: 'ENOENT' }); return files[file]; }, exists: file => file in files, ...overrides });

const scratch = [];
test.after(() => { for (const directory of scratch) fs.rmSync(directory, { recursive: true, force: true }); });
const temporary = prefix => { const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); scratch.push(directory); return directory; };

// One user's %LOCALAPPDATA%\haven-monorepo-updater as every Haven window sees it: the coordination files are
// real, the named-pipe lock is an in-process mutex, and the pending installer is a map of file -> sha512.
function sharedCache() {
  const held = new Map();
  return {
    dir: temporary('haven-update-cache-'), live: new Set(), disk: new Map(), updateInfo: null,
    acquire: async (name, owner) => { if (held.has(name)) return null; held.set(name, owner); return async () => { held.delete(name); }; },
    // Windows closes a process's pipes when it exits.
    exited: owner => { for (const [name, holder] of held) if (holder === owner) held.delete(name); },
  };
}

function harness({ online = true, free = 50 * 1024 ** 3, voice = {}, version = '1.0.0', shared = sharedCache(), pid = 101 } = {}) {
  const timers = [];
  const states = [];
  const calls = { check: 0, download: 0, quit: [] };
  const relaunch = { saved: 0, cleared: 0, save() { this.saved++; }, clear() { this.cleared++; } };
  const autoUpdater = new EventEmitter();
  const responses = { check: [], download: [] };
  const installer = path.join(shared.dir, 'pending', 'Haven-Setup.exe');
  Object.assign(autoUpdater, {
    installerPath: null,
    checkForUpdates: async () => { calls.check++; const next = responses.check.shift(); if (next instanceof Error) throw next; return next; },
    downloadUpdate: async () => {
      calls.download++;
      const next = responses.download.shift();
      if (next instanceof Error) throw next;
      shared.disk.set(installer, next.files[0].sha512);
      shared.updateInfo = { fileName: 'Haven-Setup.exe', sha512: next.files[0].sha512 };
      autoUpdater.installerPath = installer;
      autoUpdater.emit('update-downloaded', { ...next, downloadedFile: installer });
      return [installer];
    },
    quitAndInstall: (...args) => { calls.quit.push(args); if (responses.quit) throw responses.quit; },
  });
  const clock = { now: 1_000_000 };
  const network = { online };
  const voiceState = { connected: false, sharing: false, ...voice };
  shared.live.add(pid);
  const coordinator = createUpdateCoordinator({ dir: shared.dir, version, pid, alive: other => shared.live.has(other), acquire: name => shared.acquire(name, pid), now: () => clock.now });
  const files = {
    readFileSync: () => { if (!shared.updateInfo) throw Object.assign(new Error('missing'), { code: 'ENOENT' }); return JSON.stringify(shared.updateInfo); },
    unlinkSync: file => { shared.disk.delete(file); },
  };
  const updater = createUpdater({
    app: { getVersion: () => version, getPath: () => os.tmpdir() }, net: { isOnline: () => network.online },
    loadAutoUpdater: () => autoUpdater, support: { supported: true }, coordinator, getVoiceState: () => voiceState, onState: state => states.push(state), relaunch,
    logger: { warn: () => {}, error: () => {}, info: () => {} }, now: () => clock.now, diskFree: () => free, env: { LOCALAPPDATA: os.tmpdir() },
    sha512: async file => { if (!shared.disk.has(file)) throw Object.assign(new Error('missing'), { code: 'ENOENT' }); return shared.disk.get(file); }, files,
    timers: { setTimeout: (callback, delay) => { const timer = { callback, delay }; timers.push(timer); return timer; }, clearTimeout: timer => { const index = timers.indexOf(timer); if (index >= 0) timers.splice(index, 1); } },
  });
  const fire = async () => { const timer = timers.shift(); assert.ok(timer, 'a timer is scheduled'); timer.callback(); await new Promise(resolve => setImmediate(resolve)); return timer.delay; };
  const exit = () => { updater.dispose(); shared.live.delete(pid); shared.exited(pid); };
  return { updater, autoUpdater, responses, calls, timers, states, relaunch, clock, network, voiceState, fire, shared, installer, coordinator, exit };
}
// Two installed windows of the same user (for example the default profile and Local Mode).
const pair = () => { const shared = sharedCache(); return [harness({ shared, pid: 101 }), harness({ shared, pid: 202 })]; };
const readyHarness = async (options) => {
  const run = harness(options);
  run.updater.start();
  run.responses.check.push({ isUpdateAvailable: true, updateInfo: release() });
  run.responses.download.push(release());
  await run.fire();
  assert.equal(run.updater.snapshot().status, 'ready');
  return run;
};
const release = (version = '1.0.1', size = 130 * 1024 * 1024) => ({ version, files: [{ url: 'Haven-Setup.exe', sha512: 'hash', size }], path: 'Haven-Setup.exe', releaseName: `Haven v${version}`, releaseNotes: '<p>Fixes &amp; polish</p>', releaseDate: '2026-11-01T00:00:00.000Z' });

test('the update feed is the official stable GitHub repository and matches the installer cache folder', () => {
  assert.deepEqual({ ...updateFeed }, { provider: 'github', owner: 'Adi-1626', repo: 'Haven', releaseType: 'release', updaterCacheDirName: 'haven-monorepo-updater' });
  // electron-builder stores installer.exe for differential updates in "<root package name>-updater".
  assert.equal(updateFeed.updaterCacheDirName, `${JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).name.toLowerCase()}-updater`);
  assert.deepEqual(parseAppUpdateYml(appUpdateYml()), { provider: 'github', owner: 'Adi-1626', repo: 'Haven', releaseType: 'release', updaterCacheDirName: 'haven-monorepo-updater' });
  const config = require(path.join(root, 'apps/desktop/installer/electron-builder.config.cjs'));
  assert.deepEqual(config.publish, [{ provider: 'github', owner: 'Adi-1626', repo: 'Haven', releaseType: 'release' }]);
  assert.equal(config.nsis.differentialPackage, true);
  assert.equal(config.nsis.perMachine, false, 'per-user updates never need elevation');
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'apps/desktop/package.json'), 'utf8')).dependencies['electron-updater'], '6.8.10');
});

test('only the official repository or a loopback test feed is trusted', () => {
  assert.equal(trustedFeed(parseAppUpdateYml(appUpdateYml())), true);
  assert.equal(trustedFeed({ provider: 'github', owner: 'someone-else', repo: 'Haven' }), false);
  assert.equal(trustedFeed({ provider: 'github', owner: 'Adi-1626', repo: 'Haven', releaseType: 'prerelease' }), false);
  assert.equal(trustedFeed({ provider: 'generic', url: 'http://127.0.0.1:4100/' }), true);
  assert.equal(trustedFeed({ provider: 'generic', url: 'http://updates.example.com/' }), false);
  assert.equal(trustedFeed({ provider: 's3', bucket: 'x' }), false);
  assert.throws(() => parseAppUpdateYml('provider: github\n  nested: value'), /Unsupported/);
});

test('updates run only from an official NSIS installation on Windows', () => {
  assert.deepEqual(support(), { supported: true, cacheDirName: 'haven-monorepo-updater' });
  assert.match(support({ app: { isPackaged: false } }).reason, /installed Haven releases/);
  assert.match(support({ platform: 'linux' }).reason, /Windows/);
  assert.match(support({}, { 'C:\\Haven\\Uninstall Haven.exe': '' }).reason, /predates automatic updates/);
  assert.match(support({}, { ...installed, 'C:\\Haven\\resources\\app-update.yml': 'provider: generic\nurl: https://evil.example/\n' }).reason, /not configured for official updates/);
  assert.match(support({}, { 'C:\\Haven\\resources\\app-update.yml': appUpdateYml() }).reason, /Portable copies/);
});

test('failures are classified into offline, disk, integrity, metadata and HTTP states', () => {
  assert.equal(classifyUpdateError(new Error('anything'), false).status, 'offline');
  assert.equal(classifyUpdateError(Object.assign(new Error('getaddrinfo ENOTFOUND github.com'), { code: 'ENOTFOUND' })).status, 'offline');
  assert.equal(classifyUpdateError(new Error('net::ERR_INTERNET_DISCONNECTED')).kind, 'offline');
  assert.equal(classifyUpdateError(new Error('net::ERR_CONNECTION_REFUSED')).kind, 'offline');
  for (const interrupted of ['net::ERR_CONNECTION_RESET', 'net::ERR_CONTENT_LENGTH_MISMATCH', 'socket hang up', 'read ECONNRESET']) {
    assert.deepEqual([classifyUpdateError(new Error(interrupted)).kind, classifyUpdateError(new Error(interrupted)).retry], ['network', true], interrupted);
  }
  assert.equal(classifyUpdateError(new Error('net::ERR_CONNECTION_RESET'), false).kind, 'offline', 'no network at all is reported as offline');
  assert.equal(classifyUpdateError(Object.assign(new Error('mismatch'), { code: 'ERR_CHECKSUM_MISMATCH' })).kind, 'integrity');
  assert.deepEqual(classifyUpdateError(Object.assign(new Error('write failed'), { code: 'ENOSPC' })).kind, 'disk');
  assert.equal(classifyUpdateError(new Error('sha512 checksum mismatch, expected abc, got def')).kind, 'integrity');
  const missing = classifyUpdateError(Object.assign(new Error('Cannot find latest.yml in the latest release artifacts'), { code: 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND' }));
  assert.deepEqual([missing.kind, missing.retry], ['metadata', false]);
  assert.equal(classifyUpdateError(Object.assign(new Error('bad yaml'), { code: 'ERR_UPDATER_INVALID_UPDATE_INFO' })).kind, 'metadata');
  assert.match(classifyUpdateError(Object.assign(new Error('Not Found'), { statusCode: 404 })).message, /HTTP 404/);
  assert.match(classifyUpdateError(Object.assign(new Error('rate limit'), { statusCode: 403 })).message, /limiting/);
  assert.equal(classifyUpdateError(Object.assign(new Error('unsigned'), { code: 'ERR_UPDATER_INVALID_SIGNATURE' })).retry, false);
});

test('release notes reach the renderer as bounded plain text', () => {
  assert.equal(plainReleaseNotes('<h2>New</h2><ul><li>Faster &amp; <b>smaller</b></li><li>Fixes</li></ul><script>alert(1)</script><img src=x onerror=alert(1)>'), 'New\n\n• Faster & smaller\n• Fixes');
  assert.equal(plainReleaseNotes([{ version: '1.0.1', note: '<p>One</p>' }, { version: '1.0.2', note: 'Two' }]), '1.0.1\nOne\n\n1.0.2\nTwo');
  assert.equal(plainReleaseNotes(null), '');
  assert.equal(plainReleaseNotes('&#x1F600; &#39;quoted&#39; &unknown;'), "😀 'quoted' &unknown;");
  assert.ok(plainReleaseNotes('x'.repeat(20000)).length <= 8001);
});

test('a newer release is detected after launch, downloaded once in the background and then left for the user', async () => {
  const run = harness();
  run.updater.start();
  assert.deepEqual(Object.fromEntries(['autoDownload', 'autoInstallOnAppQuit', 'allowPrerelease', 'allowDowngrade', 'disableWebInstaller'].map(key => [key, run.autoUpdater[key]])), { autoDownload: false, autoInstallOnAppQuit: false, allowPrerelease: false, allowDowngrade: false, disableWebInstaller: true });
  assert.equal(run.timers[0].delay, FIRST_CHECK_DELAY);
  run.responses.check.push({ isUpdateAvailable: true, updateInfo: release() });
  let finishDownload;
  run.autoUpdater.downloadUpdate = () => { run.calls.download++; return new Promise(resolve => { finishDownload = () => { run.autoUpdater.emit('update-downloaded', release()); resolve(['installer']); }; }); };
  await run.fire();
  assert.equal(run.updater.snapshot().status, 'downloading');
  assert.equal(run.updater.snapshot().availableVersion, '1.0.1');
  assert.equal(run.updater.snapshot().releaseNotes, 'Fixes & polish');
  for (const [at, percent] of [[0, 10], [100, 11], [300, 40]]) { run.clock.now = 2_000_000 + at; run.autoUpdater.emit('download-progress', { percent, transferred: percent * 1e6, total: 100e6, bytesPerSecond: 5e6 }); }
  const progress = run.states.filter(state => state.status === 'downloading').map(state => state.progress.percent);
  assert.deepEqual(progress, [0, 10, 40], 'progress is throttled for the renderer');
  // Repeated checks while downloading never start a second download.
  await run.updater.check({ manual: true });
  assert.equal(run.calls.check, 1);
  finishDownload();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(run.updater.snapshot().status, 'ready');
  assert.equal(run.timers.length, 0, 'no further periodic checks once an update is ready');
  await run.updater.check({ manual: true });
  assert.deepEqual([run.calls.check, run.calls.download, run.calls.quit.length], [1, 1, 0], 'never installs or re-downloads on its own');
});

test('no update keeps the indicator idle and checks again periodically', async () => {
  const run = harness();
  run.updater.start();
  run.responses.check.push({ isUpdateAvailable: false, updateInfo: { version: '1.0.0' } });
  await run.fire();
  assert.equal(run.updater.snapshot().status, 'idle');
  assert.equal(run.updater.snapshot().availableVersion, null);
  assert.equal(run.timers[0].delay, CHECK_INTERVAL);
  // A slow check is not duplicated by a concurrent manual one.
  let finish;
  run.autoUpdater.checkForUpdates = () => { run.calls.check++; return new Promise(resolve => { finish = resolve; }); };
  const first = run.updater.check({ manual: true });
  await run.updater.check({ manual: true });
  finish({ isUpdateAvailable: false });
  await first;
  assert.equal(run.calls.check, 2);
});

test('interrupted downloads, offline starts and missing release metadata recover without user action', async () => {
  const run = harness();
  run.updater.start();
  run.responses.check.push({ isUpdateAvailable: true, updateInfo: release() }, { isUpdateAvailable: true, updateInfo: release() });
  run.responses.download.push(Object.assign(new Error('net::ERR_CONNECTION_RESET'), { code: 'ERR_CONNECTION_RESET' }), release());
  await run.fire();
  assert.deepEqual([run.updater.snapshot().status, run.updater.snapshot().errorKind], ['failed', 'network']);
  assert.match(run.updater.snapshot().error, /interrupted/);
  assert.equal(run.updater.snapshot().availableVersion, '1.0.1', 'the pending version stays visible while retrying');
  assert.equal(run.timers[0].delay, RETRY_DELAYS[0]);
  await run.fire();
  assert.equal(run.updater.snapshot().status, 'ready');
  assert.equal(run.calls.download, 2);

  const offline = harness({ online: false });
  offline.updater.start();
  await offline.fire();
  assert.equal(offline.updater.snapshot().status, 'offline');
  assert.equal(offline.calls.check, 0, 'no request is attempted without a network');
  assert.equal(offline.timers[0].delay, RETRY_DELAYS[0]);
  offline.network.online = true;
  offline.responses.check.push({ isUpdateAvailable: false });
  await offline.updater.check({ manual: true });
  assert.equal(offline.updater.snapshot().status, 'idle');

  const metadata = harness();
  metadata.updater.start();
  metadata.responses.check.push(Object.assign(new Error('Cannot find latest.yml'), { code: 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND' }));
  await metadata.fire();
  assert.equal(metadata.updater.snapshot().status, 'failed');
  assert.match(metadata.updater.snapshot().error, /no valid update information/);
  assert.equal(metadata.timers[0].delay, CHECK_INTERVAL, 'broken metadata is not hammered');

  const failures = harness();
  failures.updater.start();
  for (let attempt = 0; attempt < 6; attempt++) failures.responses.check.push(Object.assign(new Error('Server Error'), { statusCode: 502 }));
  const delays = [];
  for (let attempt = 0; attempt < 6; attempt++) { await failures.fire(); delays.push(failures.timers[0].delay); }
  assert.deepEqual(delays, [...RETRY_DELAYS, RETRY_DELAYS.at(-1), RETRY_DELAYS.at(-1)]);
});

test('a download that cannot fit on disk is not started', async () => {
  const run = harness({ free: 300 * 1024 * 1024 });
  run.updater.start();
  run.responses.check.push({ isUpdateAvailable: true, updateInfo: release() });
  await run.fire();
  assert.equal(run.calls.download, 0);
  assert.equal(run.updater.snapshot().errorKind, 'disk');
  assert.match(run.updater.snapshot().error, /disk space/);
});

test('installing during voice or screen sharing needs explicit confirmation and then hands off to the installer', async () => {
  for (const voice of [{ connected: true }, { sharing: true }]) {
    const run = harness({ voice });
    run.updater.start();
    await assert.rejects(run.updater.install(), /not finished downloading/);
    run.responses.check.push({ isUpdateAvailable: true, updateInfo: release() });
    run.responses.download.push(release());
    await run.fire();
    assert.equal(run.updater.snapshot().status, 'ready');
    await assert.rejects(run.updater.install(), error => error.code === 'ACTIVE_CALL' && /disconnect you from your current voice call or stream/.test(error.message));
    assert.equal(run.updater.snapshot().status, 'ready', 'a refused install changes nothing');
    assert.equal(run.relaunch.saved, 0);
    assert.equal((await run.updater.install({ confirmedDisconnect: true })).status, 'installing');
    assert.equal(run.relaunch.saved, 1);
    assert.equal(run.calls.quit.length, 0, 'the IPC reply is sent before quitting');
    await run.fire();
    assert.deepEqual(run.calls.quit, [[true, true]], 'silent NSIS update that relaunches Haven');
  }
  // Watching someone else's stream is known only to the renderer.
  const watching = await readyHarness();
  await assert.rejects(watching.updater.install({ active: true }), error => error.code === 'ACTIVE_CALL');
  const idle = await readyHarness();
  assert.equal((await idle.updater.install()).status, 'installing', 'no confirmation is needed outside a call');
});

test('an installer that cannot start returns to the ready state with an explanation', async () => {
  const run = await readyHarness();
  run.responses.quit = new Error('spawn EACCES');
  await run.updater.install();
  assert.ok(fs.existsSync(path.join(run.shared.dir, 'installing.json')));
  await run.fire();
  assert.equal(run.updater.snapshot().status, 'ready');
  assert.equal(run.updater.snapshot().errorKind, 'install');
  assert.equal(run.relaunch.cleared, 1);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(fs.existsSync(path.join(run.shared.dir, 'installing.json')), false, 'the install marker is withdrawn');
  const lock = await run.coordinator.lock();
  assert.ok(lock, 'and the update lock released');
  await lock();
});

test('two windows never download into the shared cache at the same time; the second reuses the first download', async () => {
  const [first, second] = pair();
  for (const run of [first, second]) { run.updater.start(); run.responses.check.push({ isUpdateAvailable: true, updateInfo: release() }); }
  let finish;
  first.autoUpdater.downloadUpdate = () => { first.calls.download++; return new Promise(resolve => { finish = () => { first.shared.disk.set(first.installer, 'hash'); first.autoUpdater.installerPath = first.installer; first.autoUpdater.emit('update-downloaded', { ...release(), downloadedFile: first.installer }); resolve([first.installer]); }; }); };
  await first.fire();
  assert.equal(first.updater.snapshot().status, 'downloading');
  await second.fire();
  assert.deepEqual([second.updater.snapshot().status, second.calls.download], ['waiting', 0], 'the second window waits instead of emptying pending\\');
  assert.equal(second.updater.snapshot().availableVersion, '1.0.1');
  // Waiting polls only the local lock: no further GitHub requests.
  assert.equal(await second.fire(), LOCK_RETRY);
  assert.deepEqual([second.updater.snapshot().status, second.calls.check, second.calls.download], ['waiting', 1, 0]);
  await second.updater.check({ manual: true });
  assert.equal(second.calls.check, 1, 'a manual check while waiting does not start another download');
  finish();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(first.updater.snapshot().status, 'ready');
  // electron-updater then finds the verified installer already in the cache.
  second.responses.download.push(release());
  await second.fire();
  assert.deepEqual([second.updater.snapshot().status, second.calls.download, second.calls.check], ['ready', 1, 1]);
});

test('installing from one window warns about the others, keeps them out of the cache and survives the installer', async () => {
  const shared = sharedCache();
  const first = await readyHarness({ shared, pid: 101 });
  const second = harness({ shared, pid: 202 });
  second.updater.start();
  assert.match(confirmationMessage(false, 1), /also open in another window.*closes every Haven window/);
  await assert.rejects(first.updater.install(), error => error.code === 'OTHER_WINDOWS' && /another window/.test(error.message));
  assert.equal(first.updater.snapshot().status, 'ready');
  first.voiceState.connected = true;
  await assert.rejects(first.updater.install(), error => error.code === 'ACTIVE_CALL' && /it will close too/.test(error.message));
  first.voiceState.connected = false;
  // A window that has quit no longer counts.
  second.exit();
  assert.equal((await first.updater.install()).status, 'installing', 'nothing to confirm once the other window has closed');
  const third = harness({ shared, pid: 303 });
  third.updater.start();
  third.responses.check.push({ isUpdateAvailable: true, updateInfo: release('1.0.2') });
  await third.fire();
  assert.deepEqual([third.updater.snapshot().status, third.calls.download], ['waiting', 0], 'no download while another window installs');
  // The installing window has quit; its installer is still running.
  first.exit();
  third.clock.now += 60 * 1000;
  await third.fire();
  assert.equal(third.updater.snapshot().status, 'waiting', 'the install marker outlives the window that started the installer');
  third.clock.now += INSTALL_GRACE;
  third.responses.download.push(release('1.0.2'));
  await third.fire();
  assert.equal(third.updater.snapshot().status, 'ready', 'an abandoned install no longer blocks updates');
});

test('a window that cannot take the lock does not install, and an installer replaced on disk is never launched', async () => {
  const shared = sharedCache();
  const first = await readyHarness({ shared, pid: 101 });
  const held = await first.coordinator.lock();
  await assert.rejects(first.updater.install(), error => error.code === 'BUSY');
  assert.deepEqual([first.updater.snapshot().status, first.calls.quit.length], ['ready', 0]);
  await held();

  // The cached copy of this very release is corrupt: remove it so electron-updater cannot reuse it.
  shared.disk.set(first.installer, 'tampered');
  await assert.rejects(first.updater.install(), /changed on disk/);
  assert.deepEqual([first.updater.snapshot().status, first.updater.snapshot().errorKind, first.calls.quit.length, first.relaunch.saved], ['failed', 'integrity', 0, 0]);
  assert.equal(shared.disk.has(first.installer), false);
  assert.equal(fs.existsSync(path.join(shared.dir, 'installing.json')), false);
  first.responses.check.push({ isUpdateAvailable: true, updateInfo: release() });
  first.responses.download.push(release());
  await first.fire();
  assert.equal(first.updater.snapshot().status, 'ready', 'downloaded again');

  // Another window stored a newer release there: leave it for that window and fetch this one again.
  shared.disk.set(first.installer, 'newer');
  shared.updateInfo = { fileName: 'Haven-Setup.exe', sha512: 'newer' };
  await assert.rejects(first.updater.install(), /changed on disk/);
  assert.equal(shared.disk.get(first.installer), 'newer');
});

test('install coordination files: dead windows are pruned and a finished install marker is cleared by the new version', () => {
  const dir = temporary('haven-coordination-');
  const live = new Set([1, 2]);
  let now = 5_000;
  const make = (pid, version = '1.0.0') => createUpdateCoordinator({ dir, version, pid, alive: other => live.has(other), acquire: async () => async () => {}, now: () => now });
  const one = make(1);
  const two = make(2);
  one.register();
  two.register();
  assert.deepEqual(one.others(), [2]);
  live.delete(2);
  assert.deepEqual(one.others(), []);
  assert.equal(fs.existsSync(path.join(dir, 'instances', '2.json')), false, 'a crashed window leaves no lasting record');
  one.unregister();
  assert.deepEqual(fs.readdirSync(path.join(dir, 'instances')), []);
  one.markInstalling('1.0.1');
  live.delete(1);
  make(3, '1.0.0').register();
  assert.ok(fs.existsSync(path.join(dir, 'installing.json')), 'still installing: the old version is the one running');
  make(4, '1.0.1').register();
  assert.equal(fs.existsSync(path.join(dir, 'installing.json')), false, 'the relaunched new version clears it');
  assert.match(lockName(dir), /^\\\\\.\\pipe\\haven-update-[0-9a-f]{24}$/);
  assert.equal(lockName(dir.toUpperCase()), lockName(dir), 'Windows paths are case-insensitive');
});

test('the update lock is a named pipe that another process cannot take and a crash releases', { skip: process.platform !== 'win32' && 'named pipes are Windows-only' }, async () => {
  const { spawn } = require('node:child_process');
  const dir = temporary('haven-pipe-');
  const holder = spawn(process.execPath, ['-e', `require(${JSON.stringify(path.join(electronDir, 'update-coordination.cjs'))}).listenExclusive(${JSON.stringify(lockName(dir))}).then(release => { console.log(release ? 'held' : 'busy'); setInterval(() => {}, 1000); });`], { stdio: ['ignore', 'pipe', 'inherit'] });
  try {
    assert.equal(await new Promise(resolve => holder.stdout.once('data', data => resolve(String(data).trim()))), 'held');
    const coordinator = createUpdateCoordinator({ dir, version: '1.0.0' });
    assert.equal(await coordinator.lock(), null, 'held by another Haven process');
    holder.kill();
    await new Promise(resolve => holder.once('exit', resolve));
    const release = await coordinator.lock();
    assert.equal(typeof release, 'function', 'free again after that process was killed');
    assert.equal(await listenExclusive(lockName(dir)), null, 'and exclusive within one process too');
    await release();
  } finally { holder.kill(); }
});

test('installers are hashed as latest.yml describes them (base64 sha512)', async () => {
  const file = path.join(temporary('haven-hash-'), 'Haven-Setup.exe');
  fs.writeFileSync(file, 'installer bytes');
  assert.equal(await hashFile(file), require('node:crypto').createHash('sha512').update('installer bytes').digest('base64'));
});

test('unsupported copies never load electron-updater or schedule checks', async () => {
  let loaded = false;
  const timers = [];
  const updater = createUpdater({ app: { getVersion: () => '1.0.0' }, net: { isOnline: () => true }, loadAutoUpdater: () => { loaded = true; }, support: { supported: false, reason: 'Portable copies of Haven cannot update themselves.' }, getVoiceState: () => ({}), onState: () => {}, timers: { setTimeout: () => timers.push(1), clearTimeout: () => {} } });
  updater.start();
  assert.equal(await updater.check({ manual: true }).then(state => state.status), 'unsupported');
  assert.deepEqual([loaded, timers.length], [false, 0]);
  assert.match(updater.snapshot().reason, /Portable/);
});

test('the installer relaunch keeps Local Mode and a separate profile, and nothing else', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'haven-relaunch-'));
  try {
    const file = path.join(directory, 'cache', 'relaunch.json');
    const profile = path.join(directory, 'profile');
    const args = relaunchArgs({ argv: ['Haven.exe', '--local-mode', '--profile=relative'], env: {}, userData: profile });
    assert.deepEqual(args, ['--local-mode', `--profile=${profile}`]);
    assert.deepEqual(relaunchArgs({ argv: ['Haven.exe'], env: { HAVEN_PROFILE_DIR: 'x' }, userData: profile }), [`--profile=${profile}`]);
    assert.deepEqual(relaunchArgs({ argv: ['Haven.exe'], env: {}, userData: profile }), []);
    const store = relaunchStore(file, () => args, { now: () => 1000 });
    store.save();
    assert.deepEqual(takeRelaunchArgs(['Haven.exe'], file, { now: 1000 }), [], 'only an installer relaunch consumes it');
    assert.deepEqual(takeRelaunchArgs(['Haven.exe', '--updated'], file, { now: 2000 }), args);
    assert.equal(fs.existsSync(file), false, 'consumed once');
    store.save();
    assert.deepEqual(takeRelaunchArgs(['Haven.exe', '--updated'], file, { now: 1000 + 31 * 60 * 1000 }), [], 'stale intents are ignored');
    fs.writeFileSync(file, JSON.stringify({ createdAt: 1000, args: ['--server=https://evil.example', '--profile=relative', '--local-mode', '--disable-web-security'] }));
    assert.deepEqual(takeRelaunchArgs(['Haven.exe', '--updated'], file, { now: 1000 }), ['--local-mode']);
    fs.writeFileSync(file, '{not json');
    assert.deepEqual(takeRelaunchArgs(['Haven.exe', '--updated'], file, { now: 1000 }), []);
    assert.equal(fs.existsSync(file), false);
    relaunchStore(file, () => [], { now: () => 1000 }).save();
    assert.equal(fs.existsSync(file), false, 'a default launch leaves no intent behind');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
