const { app, BrowserWindow, desktopCapturer, ipcMain, shell, Tray, Menu, nativeImage, globalShortcut, powerMonitor, safeStorage, clipboard } = require('electron');
const { createDesktopRuntime } = require('./desktop-runtime.cjs');
const { createClientSettings } = require('./client-settings.cjs');
const { permissionAllowed } = require('./permissions.cjs');
const { describeSources } = require('./capture-sources.cjs');
const { liveWindowContents, trustedClientEvent } = require('./client-access.cjs');
const { createAuthVault } = require('./auth-vault.cjs');
const { validateReleaseConfig, selectConnection } = require('./release-config.cjs');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const net = require('node:net');
const { randomUUID } = require('node:crypto');

let backend;
let window;
let picker;
let capturePending;
let permittedSources = new Map();
let origin;
let backendOrigin;
let captureAudioRequested = false;
const clients = new Set();
let captureOwner;
let desktop;
let clientSettings;
app.setName('Haven');
const profileArg = process.argv.find(argument => argument.startsWith('--profile='))?.slice(10);
const profileDir = process.env.HAVEN_PROFILE_DIR || profileArg;
if (profileDir) app.setPath('userData', path.resolve(profileDir));
else if (process.argv.includes('--local-mode')) app.setPath('userData', path.join(app.getPath('appData'), 'Haven Local'));

async function availablePort() {
  return new Promise((resolve, reject) => { const server = net.createServer(); server.on('error', reject); server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); }); });
}

function captureComplete(source, shareAudio = false) {
  const callback = capturePending;
  const closingPicker = picker;
  const audioRequested = captureAudioRequested;
  capturePending = null;
  captureOwner = null;
  captureAudioRequested = false;
  picker = null;
  permittedSources.clear();
  if (closingPicker && !closingPicker.isDestroyed()) closingPicker.close();
  if (callback) {
    try { callback(source ? { video: source, ...(shareAudio && audioRequested && process.platform === 'win32' ? { audio: 'loopback' } : {}) } : {}); }
    catch (error) { console.warn('Screen capture request ended before selection:', error.message); }
  }
}

function connectionAddress(address) {
  if (typeof address !== 'string' || address.length > 2000) throw new Error('Enter a Haven server URL or full invitation link');
  let url;
  try { url = new URL(address.trim()); } catch { throw new Error('Enter a full Haven server URL. To redeem a community code, use Join a community.'); }
  if (url.username || url.password || url.search || url.hash || (url.pathname !== '/' && !/^\/invite\/[A-Za-z0-9_-]+\/?$/.test(url.pathname))) throw new Error('Use a server URL or a full /invite/code invitation link');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('Use HTTPS, or HTTP on this computer’s localhost');
  return url;
}

async function rendererAddress(backend) {
  // Trust only the frontend explicitly advertised by the selected backend. Redirects
  // themselves never expand the native bridge allowlist.
  try {
    const response = await fetch(`${backend}/api/config`, { signal: AbortSignal.timeout(8000), redirect: 'error' });
    const config = response.ok ? await response.json() : null;
    return config?.publicUrl ? connectionAddress(config.publicUrl).origin : backend;
  } catch { return backend; }
}

function trusted(webContents) {
  try { return clients.has(webContents) && !webContents.isDestroyed() && new URL(webContents.getURL()).origin === origin; } catch { return false; }
}

function configureSession(clientSession) {
  clientSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => permissionAllowed(trusted(webContents), permission, requestingOrigin, origin, details.isMainFrame));
  clientSession.setPermissionRequestHandler((webContents, permission, callback, details) => callback(permissionAllowed(trusted(webContents), permission, details.requestingUrl || webContents?.getURL(), origin, details.isMainFrame)));
  clientSession.setDisplayMediaRequestHandler(async (request, callback) => {
    const owner = [...clients].find(contents => trusted(contents) && request.frame === contents.mainFrame);
    if (capturePending || !owner || !request.videoRequested) { callback({}); return; }
    capturePending = callback;
    captureOwner = owner;
    captureAudioRequested = request.audioRequested;
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 360, height: 220 }, fetchWindowIcons: false });
      if (capturePending !== callback) return;
      permittedSources = new Map(sources.map(source => [source.id, source]));
      picker = new BrowserWindow({ width: 790, height: 600, minWidth: 500, minHeight: 400, parent: BrowserWindow.fromWebContents(owner), modal: true, title: 'Haven · Share a screen', backgroundColor: '#202738', autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname, 'capture-preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
      picker.on('closed', () => { if (capturePending === callback) captureComplete(null); });
      picker.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      picker.webContents.on('will-navigate', event => event.preventDefault());
      await picker.loadFile(path.join(__dirname, 'capture.html'));
    } catch { if (capturePending === callback) captureComplete(null); }
  });
}

function findBackendEntry() {
  const candidates = [
    path.join(__dirname, '..', 'build', 'server', 'index.js'),
    path.join(__dirname, '..', 'build', 'index.js'),
    path.join(__dirname, '..', '..', 'backend', 'build', 'index.js'),
    path.join(__dirname, '..', '..', 'backend', 'build', 'server', 'index.js'),
    path.join(__dirname, '..', '..', '..', 'build', 'server', 'index.js'),
  ];
  return candidates.find(candidate => fs.existsSync(candidate));
}

function findIconPath() {
  const candidates = [
    path.join(__dirname, '..', 'public', 'haven.ico'),
    path.join(__dirname, '..', '..', 'web', 'public', 'haven.ico'),
    path.join(__dirname, '..', '..', '..', 'public', 'haven.ico'),
  ];
  return candidates.find(candidate => fs.existsSync(candidate)) || path.join(__dirname, '..', 'public', 'haven.ico');
}

function createClient(partition) {
  const client = new BrowserWindow({ width: 1440, height: 940, minWidth: 500, minHeight: 550, show: partition || !desktop?.startHidden(), backgroundColor: '#20222c', title: partition ? 'Haven · Independent test client' : 'Haven', autoHideMenuBar: true, icon: findIconPath(), webPreferences: { ...(partition ? { partition } : {}), preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, backgroundThrottling: false } });
  clients.add(client.webContents);
  desktop?.attachWindow(client, !partition);
  configureSession(client.webContents.session);
  client.webContents.setWindowOpenHandler(({ url }) => {
    try { if (new URL(url).protocol === 'https:') void shell.openExternal(url); } catch {}
    return { action: 'deny' };
  });
  client.webContents.on('will-navigate', (event, url) => { try { if (new URL(url).origin !== origin) event.preventDefault(); } catch { event.preventDefault(); } });
  client.webContents.on('will-redirect', (event, url) => { try { if (new URL(url).origin !== origin) event.preventDefault(); } catch { event.preventDefault(); } });
  const contents = client.webContents;
  const clientSession = contents.session;
  const cancelCapture = () => { if (captureOwner === contents) captureComplete(null); };
  contents.on('did-start-navigation', (_event, _url, _isInPlace, isMainFrame) => { if (isMainFrame) cancelCapture(); });
  contents.on('render-process-gone', cancelCapture);
  client.on('closed', () => { cancelCapture(); clients.delete(contents); if (partition) void clientSession.clearStorageData().catch(() => {}); });
  return client;
}

async function start() {
  clientSettings = createClientSettings(app.getPath('userData'));
  const connectionFile = path.join(app.getPath('userData'), 'connection.json');
  let savedServer;
  try { savedServer = JSON.parse(fs.readFileSync(connectionFile, 'utf8')).server; } catch {}
  // Source development remains Local Mode. Distributed builds must carry validated public defaults.
  const release = app.isPackaged ? validateReleaseConfig(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'release-config.json'), 'utf8'))) : undefined;
  const { remote, webUrl } = selectConnection({ args: process.argv, env: process.env, savedServer, release });
  const dev = process.argv.includes('--dev');
  if (!dev && process.env.NODE_ENV !== 'development') Menu.setApplicationMenu(null);
  let target;
  if (remote) {
    const url = connectionAddress(remote);
    backendOrigin = url.origin;
    origin = webUrl || await rendererAddress(backendOrigin);
    target = new URL(url.pathname, origin).href;
  } else if (dev) origin = 'http://127.0.0.1:5173';
  else {
    const entry = findBackendEntry();
    if (!entry) throw new Error('Run npm run build before starting Haven desktop');
    const port = await availablePort();
    origin = `http://127.0.0.1:${port}`;
    const bundledNode = path.join(process.resourcesPath, 'node', 'node.exe');
    const backendCwd = path.dirname(path.dirname(entry));
    const dataDir = path.join(app.getPath('userData'), 'server');
    fs.mkdirSync(dataDir, { recursive: true });
    // Local Mode is private SQLite on this PC: never let Hosted database/Supabase settings from the shell reach it.
    const localEnv = { ...process.env, HAVEN_MODE: 'local', PORT: String(port), HOST: '127.0.0.1', DATA_DIR: dataDir, SERVE_STATIC: 'true' };
    for (const key of Object.keys(localEnv)) if (/SUPABASE|DATABASE_URL|HAVEN_ENV_FILE/.test(key)) delete localEnv[key];
    backend = spawn(process.env.HAVEN_NODE || (fs.existsSync(bundledNode) ? bundledNode : 'node'), [entry], { cwd: backendCwd, env: localEnv, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let startupError = '';
    backend.stderr.on('data', chunk => { startupError = (startupError + chunk).slice(-3000); });
    backend.on('error', error => { startupError = error.message; });
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      try { const response = await fetch(`${origin}/api/health`); if (response.ok) { ready = true; break; } } catch {}
      if (backend.exitCode !== null) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!ready) throw new Error(`Local server failed to start. ${startupError}`);
  }
  backendOrigin ||= origin;
  ipcMain.handle('capture:sources', event => {
    if (event.sender !== liveWindowContents(picker)) return [];
    return describeSources([...permittedSources.values()], require('electron').screen.getAllDisplays());
  });
  ipcMain.on('capture:select', (event, selection) => { if (event.sender === liveWindowContents(picker)) captureComplete(permittedSources.get(selection?.id), selection?.audio === true); });
  ipcMain.handle('server:connect', async (event, address) => {
    if (!trustedClientEvent(event, trusted, window, true)) throw new Error('Change backend connections in the main Haven window');
    const url = connectionAddress(address);
    let response;
    try { response = await fetch(`${url.origin}/api/health`, { signal: AbortSignal.timeout(8000), redirect: 'error' }); }
    catch { throw new Error('Cannot reach that Haven backend. Check its address, HTTPS certificate and network connection.'); }
    const health = await response.json().catch(() => null);
    if (!response.ok || health?.ok !== true) throw new Error('That address does not appear to be a running Haven backend');
    const previousOrigin = origin;
    const previousBackend = backendOrigin;
    const nextOrigin = await rendererAddress(url.origin);
    captureComplete(null);
    if (!trustedClientEvent(event, trusted, window, true)) throw new Error('The Haven window closed while checking the backend');
    for (const contents of clients) if (!contents.isDestroyed() && contents !== liveWindowContents(window)) BrowserWindow.fromWebContents(contents)?.close();
    backendOrigin = url.origin;
    origin = nextOrigin;
    try { await window.loadURL(new URL(url.pathname, origin).href); }
    catch (error) { origin = previousOrigin; backendOrigin = previousBackend; await window.loadURL(previousOrigin); throw error; }
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    fs.writeFileSync(connectionFile, JSON.stringify({ server: url.origin }));
  });
  const assertClient = event => { if (!trustedClientEvent(event, trusted, window)) throw new Error('Invalid client request'); };
  ipcMain.on('server:api-origin', event => { event.returnValue = trustedClientEvent(event, trusted, window) ? backendOrigin : null; });
  ipcMain.handle('server:current', event => {
    assertClient(event);
    return { url: backendOrigin, local: ['localhost', '127.0.0.1', '[::1]'].includes(new URL(backendOrigin).hostname) };
  });
  ipcMain.handle('client:browser', async event => { assertClient(event); await shell.openExternal(origin); });
  ipcMain.handle('client:test', async event => {
    assertClient(event);
    if (clients.size >= 5) throw new Error('Close an existing test client before opening another');
    const client = createClient(`haven-test-${randomUUID()}`);
    try { await client.loadURL(origin); } catch (error) { client.close(); throw error; }
  });
  desktop = createDesktopRuntime({ app, Tray, Menu, nativeImage, iconPath: findIconPath(), globalShortcut, getWindow: () => window, getClients: () => clients, onQuit: () => captureComplete(null) });
  for (const event of ['suspend', 'resume', 'lock-screen', 'unlock-screen']) powerMonitor.on(event, () => desktop.releasePtt());
  ipcMain.handle('desktop:settings', event => { assertClient(event); return desktop.snapshot(event.sender); });
  ipcMain.handle('desktop:shortcut-recording', async (event, active) => {
    assertClient(event);
    if (!trustedClientEvent(event, trusted, window, true) || typeof active !== 'boolean') throw new Error('Record desktop shortcuts in the main Haven window');
    if (active && !window.isFocused()) throw new Error('Focus Haven before recording a shortcut');
    await desktop.setRecording(active);
  });
  ipcMain.handle('desktop:update-settings', async (event, patch) => {
    assertClient(event);
    if (!trustedClientEvent(event, trusted, window, true)) throw new Error('Change desktop settings in the main Haven window');
    await desktop.apply(patch);
    return desktop.snapshot(event.sender);
  });
  ipcMain.on('desktop:voice-state', (event, state) => {
    if (trustedClientEvent(event, trusted, window, true)) desktop.setVoiceState(state);
  });
  ipcMain.on('desktop:client-setting-read', (event, key) => {
    event.returnValue = trustedClientEvent(event, trusted, window, true) ? clientSettings.read(key) : null;
  });
  ipcMain.on('desktop:client-setting-write', (event, key, value) => {
    event.returnValue = trustedClientEvent(event, trusted, window, true) ? clientSettings.write(key, value) : { ok: false, error: 'Save client settings in the main Haven window' };
  });
  ipcMain.on('desktop:client-setting-status', (event, key) => {
    event.returnValue = trustedClientEvent(event, trusted, window, true) ? clientSettings.status(key) : { value: null, error: null, canPersist: false };
  });
  const authVault = createAuthVault(app.getPath('userData'), safeStorage);
  const authScope = () => JSON.stringify([backendOrigin, origin]);
  ipcMain.handle('desktop:auth:store-session', (event, sessionJson) => {
    assertClient(event);
    return authVault.write(event.sender, authScope(), event.sender === liveWindowContents(window), sessionJson);
  });
  ipcMain.handle('desktop:auth:get-session', event => {
    assertClient(event);
    return authVault.read(event.sender, authScope(), event.sender === liveWindowContents(window));
  });
  ipcMain.handle('desktop:auth:clear-session', event => {
    assertClient(event);
    return authVault.clear(event.sender, authScope(), event.sender === liveWindowContents(window));
  });
  ipcMain.handle('desktop:clipboard:write', (event, text) => {
    assertClient(event);
    if (typeof text !== 'string') throw new Error('Invalid clipboard payload');
    if (text.length > 2 * 1024 * 1024) throw new Error('Clipboard payload exceeds maximum size');
    clipboard.writeText(text);
    return true;
  });
  window = createClient();
  window.on('closed', () => { captureComplete(null); for (const contents of clients) if (!contents.isDestroyed()) BrowserWindow.fromWebContents(contents)?.close(); });
  await window.loadURL(target || origin);
}

app.whenReady().then(start).catch(error => { require('electron').dialog.showErrorBox('Haven could not start', error.message); app.quit(); });
app.on('before-quit', () => { desktop?.beforeQuit(); clientSettings?.flush(); captureComplete(null); backend?.kill(); });
app.on('activate', () => desktop?.restore());
app.on('window-all-closed', () => app.quit());
