// End-to-end check of Haven-Setup.exe on this PC: silent install into a disposable directory, payload audit and
// byte comparison with the portable source, shortcut/registry checks, launch, reinstall (update) with data
// continuity, startup-entry cleanup and silent uninstall. Uses disposable HAVEN_PROFILE_DIR profiles only; the real
// %APPDATA%\Haven profile is only listed (names, sizes, times) to prove the installer never touches it.
// Usage: node scripts/verify-installer.mjs [path\to\Haven-Setup.exe]
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from '@playwright/test';
import { auditBundle } from './package-audit.mjs';
import { watchElectronErrors } from './electron-errors.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const installer = path.resolve(process.argv[2] || path.join(root, 'release', `Haven-${manifest.version}-installer`, 'Haven-Setup.exe'));
const info = JSON.parse(await readFile(path.join(path.dirname(installer), 'INSTALLER-INFO.json'), 'utf8'));
const portable = path.resolve(root, info.portableSource);
const evidence = path.join(path.dirname(installer), 'verification');
await mkdir(evidence, { recursive: true });
const appId = 'electron.app.Haven';
const runKey = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const startMenuLink = path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Haven.lnk');
const realProfile = path.join(process.env.APPDATA, 'Haven');
const work = await mkdtemp(path.join(tmpdir(), 'haven-installer-'));
const installDir = path.join(work, 'Haven');
const profile = path.join(work, 'profile');
const report = { installer, sha256: info.sha256, bytes: info.bytes, startedAt: new Date().toISOString(), checks: [] };
const pass = (name, detail) => { report.checks.push({ name, ok: true, ...(detail === undefined ? {} : { detail }) }); console.log(`PASS ${name}${detail === undefined ? '' : ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`); };

const powershell = script => {
  // PowerShell 7's inherited module path can hide Windows PowerShell's security module.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'psmodulepath'));
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true, env });
  if (result.status !== 0) throw new Error(`PowerShell failed: ${result.stderr || result.stdout}`);
  return result.stdout.trim();
};
const uninstallEntries = () => JSON.parse(powershell(`@(Get-ChildItem 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall' | ForEach-Object { Get-ItemProperty $_.PSPath } | Where-Object { $_.DisplayName -eq 'Haven' } | Select-Object DisplayName, DisplayVersion, Publisher, InstallLocation, UninstallString, QuietUninstallString, DisplayIcon) | ConvertTo-Json -Compress -Depth 2`) || '[]');
const asArray = value => Array.isArray(value) ? value : value ? [value] : [];
// electron-builder leaves InstallLocation empty in the Uninstall key; the uninstaller path identifies the installation.
const ownsEntry = entry => (entry?.UninstallString || '').toLowerCase().includes(installDir.toLowerCase());
const runValue = () => powershell(`(Get-ItemProperty '${runKey}' -Name '${appId}' -ErrorAction SilentlyContinue).'${appId}'`);
const shortcutTarget = link => powershell(`(New-Object -ComObject WScript.Shell).CreateShortcut('${link.replaceAll("'", "''")}').TargetPath`);
const sha256 = file => new Promise((resolve, reject) => { const hash = createHash('sha256'); createReadStream(file).on('data', chunk => hash.update(chunk)).on('error', reject).on('end', () => resolve(hash.digest('hex'))); });
async function listing(directory, base = directory, out = new Map()) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) await listing(full, base, out);
    else { const { size, mtimeMs } = await stat(full); out.set(path.relative(base, full), `${size}:${Math.round(mtimeMs)}`); }
  }
  return out;
}
const fingerprint = async () => existsSync(realProfile) ? JSON.stringify([...(await listing(realProfile))].sort()) : 'absent';
const waitFor = async (condition, label, timeout = 120000) => {
  const deadline = Date.now() + timeout;
  while (!(await condition())) { if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`); await new Promise(resolve => setTimeout(resolve, 500)); }
};
const runInstaller = () => {
  const result = spawnSync(installer, ['/S', `/D=${installDir}`], { windowsHide: true, timeout: 300000 });
  assert.equal(result.status, 0, `installer exit code ${result.status} ${result.error?.message || ''}`);
};
const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !['haven_node', 'haven_profile_dir', 'electron_run_as_node'].includes(key.toLowerCase())));
async function withInstalledApp(action, hosted = false, startup = false) {
  const selectedProfile = hosted ? path.join(work, 'hosted-profile') : profile;
  const app = await electron.launch({ executablePath: path.join(installDir, 'Haven.exe'), args: [...(hosted ? [] : ['--local-mode']), ...(startup ? ['--startup'] : [])], env: { ...environment, HAVEN_SERVER: '', HAVEN_PROFILE_DIR: selectedProfile } });
  const errors = await watchElectronErrors(app);
  try {
    const page = await app.firstWindow();
    if (hosted) await page.waitForURL('https://haven-ea6.pages.dev/**', { timeout: 30000 });
    await page.waitForLoadState('domcontentloaded');
    assert.equal(path.resolve(await app.evaluate(({ app }) => app.getPath('userData'))), path.resolve(selectedProfile));
    assert.equal(await app.evaluate(({ app }) => app.getVersion()), manifest.version);
    const request = (endpoint, data) => page.evaluate(async ({ endpoint, data }) => {
      const response = await fetch(`/api${endpoint}`, { method: data ? 'POST' : 'GET', credentials: 'include', headers: data ? { 'Content-Type': 'application/json' } : undefined, body: data ? JSON.stringify(data) : undefined });
      return { status: response.status, body: await response.json().catch(() => null) };
    }, { endpoint, data });
    if (!hosted) await waitFor(async () => (await request('/health').catch(() => ({ status: 0 }))).status === 200, 'local backend health');
    return await action({ app, page, request });
  } finally {
    await app.close();
    errors();
  }
}

// The Desktop may be redirected (for example into OneDrive); ask Windows rather than assuming %USERPROFILE%\Desktop.
const desktopLink = path.join(powershell(`[Environment]::GetFolderPath('Desktop')`), 'Haven.lnk');
const existing = asArray(uninstallEntries());
if (existing.length) throw new Error(`Haven is already installed for this user (${existing.map(entry => entry.InstallLocation).join(', ')}). Uninstall it first; verification never replaces a real installation.`);
if (runValue()) throw new Error(`A "${appId}" startup entry already exists; refusing to modify it.`);
if (existsSync(startMenuLink)) throw new Error(`${startMenuLink} already exists; refusing to replace it.`);
const profileBefore = await fingerprint();

try {
  assert.equal(await sha256(installer), info.sha256, 'installer checksum matches the build record');
  assert.equal((await stat(installer)).size, info.bytes);
  pass('installer checksum and byte size match build metadata');
  // 1. Fresh install.
  let started = Date.now();
  runInstaller();
  pass('silent install', `${((Date.now() - started) / 1000).toFixed(1)} s into ${installDir}`);

  const audit = await auditBundle(installDir);
  assert.deepEqual(audit.problems, []);
  pass('installed payload audit', { files: audit.files, bytes: audit.bytes, appBytes: audit.appBytes, notes: audit.notes });

  const installed = await listing(installDir);
  const source = await listing(portable);
  source.delete('PACKAGING-COMPLETE.txt');
  const missing = [...source.keys()].filter(file => !installed.has(file));
  const extra = [...installed.keys()].filter(file => !source.has(file));
  assert.deepEqual(missing, [], 'files missing from installation');
  assert.deepEqual(extra.sort(), ['Uninstall Haven.exe', 'uninstallerIcon.ico'], 'unexpected extra files');
  const mismatched = [];
  for (const file of source.keys()) if (await sha256(path.join(portable, file)) !== await sha256(path.join(installDir, file))) mismatched.push(file);
  assert.deepEqual(mismatched, []);
  pass('installed files are byte-identical to the verified portable bundle', `${source.size} files + uninstaller`);

  const [entry] = asArray(uninstallEntries());
  assert.equal(entry?.DisplayVersion, manifest.version);
  assert.ok(ownsEntry(entry), entry?.UninstallString);
  pass('Apps & Features entry', { version: entry.DisplayVersion, publisher: entry.Publisher, uninstall: entry.QuietUninstallString });
  assert.equal(path.resolve(shortcutTarget(startMenuLink)), path.join(installDir, 'Haven.exe'));
  pass('Start Menu shortcut', startMenuLink);
  assert.equal(existsSync(desktopLink), false);
  pass('no desktop shortcut without opting in');
  const signature = powershell(`(Get-AuthenticodeSignature '${path.join(installDir, 'Haven.exe')}').Status`);
  pass('code signature status', signature);
  const branding = JSON.parse(powershell(`(Get-Item '${path.join(installDir, 'Haven.exe')}').VersionInfo | Select-Object ProductName,ProductVersion,FileDescription,FileVersion,CompanyName,OriginalFilename | ConvertTo-Json -Compress`));
  assert.equal(branding.ProductName, 'Haven');
  assert.equal(branding.ProductVersion, manifest.version);
  assert.equal(branding.FileVersion, manifest.version);
  assert.equal(branding.OriginalFilename, 'Haven.exe');
  pass('installed Windows executable branding and version', branding);

  // 2. A fresh installed executable must launch Hosted without arguments or a local server.
  await withInstalledApp(async ({ app, page }) => {
    assert.equal(new URL(page.url()).origin, 'https://haven-ea6.pages.dev');
    const connection = await page.evaluate(() => window.haven.getConnection());
    assert.equal(connection.url, 'https://haven-backend.getvoroa.com');
    assert.equal(connection.local, false);
    assert.equal(existsSync(path.join(work, 'hosted-profile', 'server')), false);
    await page.locator('input[type="password"]').first().waitFor({ state: 'visible', timeout: 30000 });
    const resources = await page.evaluate(() => performance.getEntriesByType('resource').map(entry => entry.name));
    assert.ok(resources.some(url => url.startsWith('https://haven-backend.getvoroa.com/api/')), 'hosted renderer actually requests the production API');
    assert.ok(!resources.some(url => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url)), 'no loopback requests from the hosted renderer');
    const state = await page.evaluate(() => ({ title: document.title, headings: [...document.querySelectorAll('h1,h2,h3')].map(e => e.textContent), buttons: [...document.querySelectorAll('button')].map(e => e.textContent), scripts: [...document.scripts].map(s => s.src).filter(Boolean), orbitalCanvas: Boolean(document.querySelector('canvas.orbital-canvas')), apiOrigin: window.haven.getApiOrigin(), secureContext: isSecureContext }));
    assert.equal(state.apiOrigin, connection.url);
    assert.equal(state.secureContext, true);
    assert.ok(state.buttons.some(text => /sign in/i.test(text)), 'application authentication controls exist');
    await page.screenshot({ path: path.join(evidence, 'installed-hosted.png') });
    await writeFile(path.join(evidence, 'hosted-runtime.json'), JSON.stringify({ connection, state, resources }, null, 2));
    report.hostedRuntime = state;
    pass('fresh installed app shows authentication UI and requests real Hosted API without SQLite or loopback requests', connection);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.locator('input[type="password"]').first().waitFor({ state: 'visible' });
    await page.screenshot({ path: path.join(evidence, 'installed-hosted-signin.png') });
    pass('Hosted registration to sign-in routing without submitting production data');
  }, true);

  // Explicit Local Mode remains separately testable without touching production accounts.
  const username = `installer${Date.now().toString(36)}`;
  const password = 'Installer-Verification-2026';
  await withInstalledApp(async ({ page, request }) => {
    await page.locator('.orbital-bg-wrap').waitFor({ state: 'visible' });
    await page.waitForFunction(() => Boolean(document.querySelector('.orbital-canvas,.orbital-fallback-image')));
    const orbital = await page.evaluate(() => ({ canvas: Boolean(document.querySelector('.orbital-canvas')), fallback: Boolean(document.querySelector('.orbital-fallback-image')), quality: document.querySelector('[data-orbital-quality]')?.getAttribute('data-orbital-quality') }));
    await page.screenshot({ path: path.join(evidence, 'installed-bundled-planetary-auth.png') });
    pass('bundled planetary authentication scene preserved', orbital);
    const created = await request('/auth/register', { username, displayName: 'Installer Check', password });
    assert.equal(created.status, 201, JSON.stringify(created));
  });
  assert.ok(existsSync(path.join(profile, 'server')), 'local SQLite data directory created in the profile');
  pass('installed Haven launches, starts its bundled backend and stores Local Mode data in the profile');

  const gaming = spawnSync(process.execPath, [path.join(root, 'scripts/verify-desktop-gaming.mjs'), path.join(installDir, 'Haven.exe')], { env: environment, encoding: 'utf8', windowsHide: true, timeout: 240000 });
  await writeFile(path.join(evidence, 'installed-desktop-gaming.log'), `${gaming.stdout || ''}\n${gaming.stderr || ''}`);
  assert.equal(gaming.status, 0, `installed desktop/media suite failed: ${gaming.error?.message || gaming.stderr || gaming.stdout}`);
  pass('installed executable native tray/PTT/microphone/screen-share/background suite', 'see installed-desktop-gaming.log for checks and limitations');

  // 3. Reinstall over the existing installation (the update path) and confirm data continuity.
  started = Date.now();
  runInstaller();
  assert.equal(asArray(uninstallEntries()).length, 1, 'exactly one Apps & Features entry after update');
  assert.equal(existsSync(path.join(installDir, 'Haven.exe')), true);
  pass('silent reinstall/update', `${((Date.now() - started) / 1000).toFixed(1)} s`);
  await withInstalledApp(async ({ app, page, request }) => {
    const login = await request('/auth/login', { username, password });
    assert.equal(login.status, 200, JSON.stringify(login));
    await page.evaluate(() => window.haven.updateDesktopSettings({ startAtLogin: true, startMinimized: true, closeToTray: true }));
    // Electron compares the arguments too; the default [] cannot match a Local Mode login item.
    assert.equal(await app.evaluate(({ app }) => app.getLoginItemSettings({ path: process.execPath, args: ['--local-mode', '--startup'] }).openAtLogin), true);
  });
  pass('account created before the update signs in after it');
  assert.ok(runValue().includes(path.join(installDir, 'Haven.exe')));
  assert.ok(runValue().includes('--startup'));
  pass('actual Electron start-at-login API registers the installed executable');
  await withInstalledApp(async ({ app }) => {
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), false);
    pass('startup argument launches minimized to tray with saved settings');
  }, false, true);

  // Another installation can share this directory prefix. Its startup entry must survive.
  const foreignStartup = `"${installDir}-other\\Haven.exe" --startup`;
  powershell(`Set-ItemProperty '${runKey}' -Name '${appId}' -Value '${foreignStartup.replaceAll("'", "''")}'`);
  const foreignRemoval = spawnSync(path.join(installDir, 'Uninstall Haven.exe'), ['/S'], { windowsHide: true, timeout: 300000 });
  assert.equal(foreignRemoval.status, 0);
  await waitFor(async () => !existsSync(path.join(installDir, 'Haven.exe')) && asArray(uninstallEntries()).length === 0, 'foreign-startup uninstall');
  assert.equal(runValue(), foreignStartup, 'uninstall must preserve another installation with the same directory prefix');
  powershell(`Remove-ItemProperty '${runKey}' -Name '${appId}'`);
  pass('uninstall preserves a different executable sharing the installation-directory prefix');
  runInstaller();
  await withInstalledApp(async ({ page }) => {
    // Registration is restored explicitly, since uninstall intentionally preserved the other copy's value.
    await page.evaluate(async () => {
      await window.haven.updateDesktopSettings({ startAtLogin: false });
      await window.haven.updateDesktopSettings({ startAtLogin: true });
    });
  });
  assert.ok(runValue().includes(path.join(installDir, 'Haven.exe')));

  // 4. Uninstall with a real start-at-login entry registered by the installed app.
  const uninstaller = path.join(installDir, 'Uninstall Haven.exe');
  started = Date.now();
  const removal = spawnSync(uninstaller, ['/S'], { windowsHide: true, timeout: 300000 });
  assert.equal(removal.status, 0, `uninstaller exit code ${removal.status}`);
  await waitFor(async () => !existsSync(path.join(installDir, 'Haven.exe')) && asArray(uninstallEntries()).length === 0, 'uninstall to finish');
  pass('silent uninstall', `${((Date.now() - started) / 1000).toFixed(1)} s`);
  assert.equal(existsSync(startMenuLink), false);
  pass('Start Menu shortcut removed');
  assert.equal(runValue(), '');
  pass('startup entry for this installation removed');
  assert.ok(existsSync(path.join(profile, 'server')), 'profile data kept by uninstall');
  pass('user data kept by default uninstall');
  report.success = true;
} catch (error) {
  report.success = false;
  report.failure = error.stack;
  throw error;
} finally {
  let leftoverInstall = asArray(uninstallEntries()).some(ownsEntry);
  if (leftoverInstall && existsSync(path.join(installDir, 'Uninstall Haven.exe'))) {
    spawnSync(path.join(installDir, 'Uninstall Haven.exe'), ['/S'], { windowsHide: true, timeout: 300000 });
    await waitFor(async () => !asArray(uninstallEntries()).some(ownsEntry), 'cleanup uninstall').catch(() => {});
    leftoverInstall = asArray(uninstallEntries()).some(ownsEntry);
    report.cleanup = leftoverInstall ? 'cleanup uninstall did not finish' : 'test installation removed after failure';
  }
  const leftover = runValue();
  if (leftover && leftover.includes(installDir)) powershell(`Remove-ItemProperty '${runKey}' -Name '${appId}'`);
  const profileAfter = await fingerprint();
  report.realProfileUnchanged = profileBefore === profileAfter;
  report.success = report.success === true && report.realProfileUnchanged && !leftoverInstall;
  if (report.realProfileUnchanged) pass('real %APPDATA%\\Haven profile untouched (listing identical before and after)');
  report.finishedAt = new Date().toISOString();
  await mkdir(path.join(root, 'test-results'), { recursive: true });
  await writeFile(path.join(evidence, 'installer-verification.json'), `${JSON.stringify(report, null, 2)}\n`);
  // Keep the directory if a registered installation still points into it, so its uninstaller stays usable.
  if (leftoverInstall) console.error(`Test installation still registered at ${installDir}; run its "Uninstall Haven.exe" /S.`);
  else if (path.relative(tmpdir(), work).startsWith('haven-installer-')) await rm(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
}
assert.equal(report.realProfileUnchanged, true, `${realProfile} changed during verification`);
