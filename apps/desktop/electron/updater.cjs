const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { updateFeed, parseAppUpdateYml, trustedFeed } = require('./update-config.cjs');

const FIRST_CHECK_DELAY = 20 * 1000;
const CHECK_INTERVAL = 4 * 60 * 60 * 1000;
// Network failures retry quickly at first; a release without valid metadata waits for the next regular check.
const RETRY_DELAYS = [60 * 1000, 5 * 60 * 1000, 15 * 60 * 1000, 60 * 60 * 1000];
const PROGRESS_INTERVAL = 250;
const RELAUNCH_TTL = 30 * 60 * 1000;
const RELEASE_NOTES_LIMIT = 8000;
// How often a window that found another window downloading looks again (a local check, never a GitHub request).
const LOCK_RETRY = 5 * 1000;

function updateSupport({ app, platform = process.platform, execPath = process.execPath, resourcesPath = process.resourcesPath, readFile = file => fs.readFileSync(file, 'utf8'), exists = fs.existsSync }) {
  if (!app.isPackaged) return { supported: false, reason: 'Automatic updates are available in installed Haven releases.' };
  if (platform !== 'win32') return { supported: false, reason: 'Automatic updates are available on Windows.' };
  let config;
  try { config = parseAppUpdateYml(readFile(path.join(resourcesPath, 'app-update.yml'))); }
  catch { return { supported: false, reason: 'This copy of Haven predates automatic updates. Install the latest Haven-Setup.exe from GitHub Releases once.' }; }
  if (!trustedFeed(config)) return { supported: false, reason: 'This copy of Haven is not configured for official updates.' };
  // electron-updater replaces an NSIS installation in place. A portable folder has no uninstaller and no install record.
  if (!exists(path.join(path.dirname(execPath), 'Uninstall Haven.exe'))) return { supported: false, reason: 'Portable copies of Haven cannot update themselves. Install Haven with Haven-Setup.exe to receive automatic updates.' };
  return { supported: true, cacheDirName: config.updaterCacheDirName || updateFeed.updaterCacheDirName };
}

// GitHub's release feed delivers notes as HTML. The renderer shows plain text only.
function plainReleaseNotes(notes) {
  const html = Array.isArray(notes) ? notes.map(entry => `${entry?.version ? `${entry.version}\n` : ''}${entry?.note ?? ''}`).join('\n\n') : typeof notes === 'string' ? notes : '';
  const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
  const text = html
    .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '\n• ')
    .replace(/<\s*\/\s*(p|div|h[1-6]|ul|ol|pre|blockquote)\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (entity, name) => {
      if (name[0] === '#') { const code = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1)); return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : ''; }
      return entities[name.toLowerCase()] ?? entity;
    })
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text.length > RELEASE_NOTES_LIMIT ? `${text.slice(0, RELEASE_NOTES_LIMIT).trimEnd()}…` : text;
}

const offlinePattern = /ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ERR_NETWORK_CHANGED|ERR_NETWORK_IO_SUSPENDED|ERR_CONNECTION_(?:REFUSED|TIMED_OUT)|ERR_TIMED_OUT|ERR_ADDRESS_UNREACHABLE|ERR_PROXY_CONNECTION_FAILED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNREFUSED|ENETUNREACH/;
const interruptedPattern = /ERR_CONNECTION_(?:RESET|CLOSED|ABORTED)|ERR_CONTENT_LENGTH_MISMATCH|ERR_INCOMPLETE_CHUNKED_ENCODING|ERR_EMPTY_RESPONSE|ERR_HTTP2_[A-Z_]+|ECONNRESET|EPIPE|socket hang up|premature close|aborted/i;
const metadataCodes = new Set(['ERR_UPDATER_CHANNEL_FILE_NOT_FOUND', 'ERR_UPDATER_INVALID_UPDATE_INFO', 'ERR_UPDATER_INVALID_VERSION', 'ERR_UPDATER_NO_PUBLISHED_VERSIONS', 'ERR_UPDATER_INVALID_RELEASE_FEED', 'ERR_UPDATER_LATEST_VERSION_NOT_FOUND', 'ERR_UPDATER_NO_FILES_PROVIDED', 'ERR_UPDATER_ASSET_NOT_FOUND']);

function classifyUpdateError(error, online = true) {
  const code = error?.code || '';
  const message = String(error?.message || error || '');
  const status = error?.statusCode;
  if (code === 'ENOSPC' || /ENOSPC|not enough space/i.test(message)) return { status: 'failed', kind: 'disk', retry: true, message: 'Not enough free disk space to download the update. Free some space; Haven will try again.' };
  if (!online || offlinePattern.test(`${code} ${message}`)) return { status: 'offline', kind: 'offline', retry: true, message: 'You appear to be offline. Haven will check for updates again when it can reach GitHub.' };
  if (interruptedPattern.test(`${code} ${message}`)) return { status: 'failed', kind: 'network', retry: true, message: 'The update download was interrupted. Haven will try again shortly.' };
  if (code === 'ERR_CHECKSUM_MISMATCH' || /checksum mismatch/i.test(message)) return { status: 'failed', kind: 'integrity', retry: true, message: 'The downloaded update failed its integrity check and was discarded. Haven will download it again.' };
  if (metadataCodes.has(code)) return { status: 'failed', kind: 'metadata', retry: false, message: 'The latest Haven release has no valid update information yet. Haven will check again later.' };
  if (code === 'ERR_UPDATER_INVALID_SIGNATURE') return { status: 'failed', kind: 'integrity', retry: false, message: 'The downloaded update is not signed by Haven and was discarded.' };
  if (typeof status === 'number') return { status: 'failed', kind: 'http', retry: true, message: status === 403 || status === 429 ? 'GitHub is limiting update requests right now. Haven will try again later.' : `GitHub could not provide the update (HTTP ${status}). Haven will try again.` };
  return { status: 'failed', kind: 'unknown', retry: true, message: 'Haven could not finish checking for or downloading the update. It will try again.' };
}

// Installer silently replaces the files, then starts Haven through the Start Menu shortcut with only
// --updated. Remember the arguments that select Local Mode or a separate profile so they survive.
function relaunchFile(env, cacheDirName = updateFeed.updaterCacheDirName) {
  return env?.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, cacheDirName, 'relaunch.json') : null;
}

function relaunchArgs({ argv, env, userData }) {
  const args = [];
  if (argv.includes('--local-mode')) args.push('--local-mode');
  if (env.HAVEN_PROFILE_DIR || argv.some(argument => argument.startsWith('--profile='))) args.push(`--profile=${userData}`);
  return args;
}

const allowedRelaunchArg = argument => argument === '--local-mode' || (/^--profile=.+/.test(argument) && path.isAbsolute(argument.slice(10)));

function takeRelaunchArgs(argv, file, { now = Date.now(), files = fs } = {}) {
  if (!file || !argv.includes('--updated')) return [];
  let intent;
  try { intent = JSON.parse(files.readFileSync(file, 'utf8')); } catch { return []; }
  finally { try { files.unlinkSync(file); } catch {} }
  if (!Array.isArray(intent?.args) || typeof intent.createdAt !== 'number' || now - intent.createdAt > RELAUNCH_TTL || intent.createdAt > now + 60 * 1000) return [];
  return intent.args.filter(argument => typeof argument === 'string' && allowedRelaunchArg(argument) && !argv.some(existing => existing === argument || (argument.startsWith('--profile=') && existing.startsWith('--profile='))));
}

function relaunchStore(file, args, { now = Date.now, files = fs } = {}) {
  if (!file) return undefined;
  const clear = () => { try { files.unlinkSync(file); } catch {} };
  return {
    save: () => {
      const list = args();
      if (!list.length) { clear(); return; }
      try { files.mkdirSync(path.dirname(file), { recursive: true }); files.writeFileSync(file, JSON.stringify({ createdAt: now(), args: list })); } catch {}
    },
    clear,
  };
}

const hashFile = file => new Promise((resolve, reject) => {
  const hash = createHash('sha512');
  fs.createReadStream(file).on('error', reject).on('data', chunk => hash.update(chunk)).on('end', () => resolve(hash.digest('base64')));
});

// Before Update & Restart: the silent installer closes every installed Haven window, not only this one.
function confirmationMessage(inCall, otherWindows) {
  const others = otherWindows === 1 ? 'Haven is also open in another window (a separate profile or Local Mode)' : `Haven is also open in ${otherWindows} other windows (separate profiles or Local Mode)`;
  if (!inCall) return `${others}. Updating closes every Haven window and disconnects any call in them.`;
  const call = 'Updating Haven will close the app and disconnect you from your current voice call or stream. You\'ll need to rejoin after the update.';
  return otherWindows ? `${call} ${others}; ${otherWindows === 1 ? 'it' : 'they'} will close too.` : call;
}

function freeBytes(directory, files = fs) {
  try { const stats = files.statfsSync(directory); return Number(stats.bavail) * Number(stats.bsize); } catch { return Infinity; }
}

function createUpdater({ app, net, loadAutoUpdater = () => require('electron-updater').autoUpdater, support, coordinator, getVoiceState, onState, relaunch, logger = console, timers = { setTimeout, clearTimeout }, now = Date.now, diskFree = freeBytes, env = process.env, sha512 = hashFile, files = fs }) {
  const state = { status: support.supported ? 'idle' : 'unsupported', currentVersion: app.getVersion(), availableVersion: null, releaseName: null, releaseNotes: '', releaseDate: null, progress: null, error: null, errorKind: null, lastCheckedAt: null, reason: support.supported ? null : support.reason };
  let updater;
  let timer;
  let failures = 0;
  let lastProgressAt = 0;
  let disposed = false;
  // The installer this window downloaded: electron-updater's path and the sha512 latest.yml promised for it.
  let downloaded = null;
  let installLock = null;
  const snapshot = () => ({ ...state, progress: state.progress && { ...state.progress } });
  const emit = () => { if (!disposed) onState(snapshot()); };
  const set = patch => { Object.assign(state, patch); emit(); };
  const schedule = (delay, task = check) => {
    timers.clearTimeout(timer);
    if (!disposed) timer = timers.setTimeout(() => { timer = undefined; void task(); }, delay);
  };
  const fail = error => {
    const result = classifyUpdateError(error, net.isOnline());
    logger.warn?.(`Haven update ${result.kind} error: ${error?.stack || error}`);
    failures += 1;
    set({ status: result.status, error: result.message, errorKind: result.kind, progress: null, lastCheckedAt: now() });
    schedule(result.retry ? RETRY_DELAYS[Math.min(failures - 1, RETRY_DELAYS.length - 1)] : CHECK_INTERVAL);
  };
  const describe = info => ({ availableVersion: info?.version ?? null, releaseName: info?.releaseName ?? null, releaseNotes: plainReleaseNotes(info?.releaseNotes), releaseDate: info?.releaseDate ?? null });

  const download = async info => {
    Object.assign(state, describe(info));
    const size = Math.max(0, ...(info?.files || []).map(file => Number(file?.size) || 0));
    // The cached installer, NSIS's temporary extraction and the replaced installation all need room.
    const needed = Math.max(size * 4, 512 * 1024 * 1024);
    const cache = env.LOCALAPPDATA || app.getPath('userData');
    if (diskFree(cache) < needed) throw Object.assign(new Error(`ENOSPC: ${Math.ceil(needed / 1048576)} MB needed`), { code: 'ENOSPC' });
    // Another window is downloading or installing into the shared cache. Wait for it, then reuse its
    // download: electron-updater re-verifies the cached installer's sha512 and skips the network.
    const release = await coordinator.lock();
    if (!release) {
      set({ status: 'waiting', progress: null, error: null, errorKind: null });
      schedule(LOCK_RETRY, () => resume(info));
      return;
    }
    try {
      if (disposed) return;
      set({ status: 'downloading', progress: { percent: 0, transferred: 0, total: size, bytesPerSecond: 0 }, error: null, errorKind: null });
      await updater.downloadUpdate();
    } finally { await release(); }
  };
  const resume = async info => {
    if (state.status !== 'waiting' || disposed) return;
    try { await download(info); } catch (error) { fail(error); }
  };

  async function check({ manual = false } = {}) {
    if (!updater || disposed) return snapshot();
    if (['checking', 'waiting', 'downloading', 'ready', 'installing'].includes(state.status)) return snapshot();
    timers.clearTimeout(timer);
    if (manual) failures = 0;
    if (!net.isOnline()) { fail(Object.assign(new Error('ERR_INTERNET_DISCONNECTED'), { code: 'ERR_INTERNET_DISCONNECTED' })); return snapshot(); }
    set({ status: 'checking', error: null, errorKind: null });
    try {
      const result = await updater.checkForUpdates();
      if (result?.isUpdateAvailable) await download(result.updateInfo);
      else { failures = 0; set({ status: 'idle', availableVersion: null, progress: null, lastCheckedAt: now() }); schedule(CHECK_INTERVAL); }
    } catch (error) { fail(error); }
    return snapshot();
  }

  function start() {
    if (!support.supported || updater) return;
    updater = loadAutoUpdater();
    Object.assign(updater, {
      logger,
      autoDownload: false,
      // Installing is always the user's choice, never a side effect of quitting.
      autoInstallOnAppQuit: false,
      autoRunAppAfterInstall: true,
      allowPrerelease: false,
      allowDowngrade: false,
      disableWebInstaller: true,
      fullChangelog: false,
    });
    updater.on('download-progress', progress => {
      if (state.status !== 'downloading') return;
      const at = now();
      const percent = Math.max(0, Math.min(100, Number(progress?.percent) || 0));
      if (at - lastProgressAt < PROGRESS_INTERVAL && percent < 100) return;
      lastProgressAt = at;
      set({ progress: { percent, transferred: Number(progress?.transferred) || 0, total: Number(progress?.total) || state.progress?.total || 0, bytesPerSecond: Number(progress?.bytesPerSecond) || 0 } });
    });
    updater.on('update-downloaded', info => {
      const file = info?.downloadedFile;
      const entry = (info?.files || []).find(candidate => file && path.basename(String(candidate?.url || '')) === path.basename(file));
      downloaded = { file, sha512: entry?.sha512 || info?.sha512 };
      failures = 0;
      timers.clearTimeout(timer);
      set({ status: 'ready', ...describe(info), progress: { percent: 100, transferred: state.progress?.total || 0, total: state.progress?.total || 0, bytesPerSecond: 0 }, error: null, errorKind: null, lastCheckedAt: now() });
    });
    // Failures are handled where checkForUpdates/downloadUpdate reject. An installer that cannot start
    // after quitAndInstall arrives only here.
    updater.on('error', error => {
      if (state.status !== 'installing') return;
      relaunch?.clear();
      coordinator.clearInstalling();
      void installLock?.();
      installLock = null;
      logger.error?.(`Haven update installer failed to start: ${error?.stack || error}`);
      set({ status: 'ready', error: 'Haven could not start the update installer. Try again, or install Haven-Setup.exe from GitHub Releases.', errorKind: 'install' });
    });
    coordinator.register();
    schedule(FIRST_CHECK_DELAY);
  }

  // The installer on disk must still be the one this window downloaded: until this window held the lock,
  // another window could have replaced it with a different release or a broken download.
  async function verifiedInstaller() {
    const file = updater.installerPath ?? downloaded?.file;
    if (!file || !downloaded?.file || !downloaded.sha512 || path.resolve(file) !== path.resolve(downloaded.file)) return false;
    try { return await sha512(file) === downloaded.sha512; } catch { return false; }
  }

  // electron-updater would reuse a corrupted copy of this release without a checksum; remove it so the next
  // download fetches it again. A different release that another window stored there is left alone.
  function discardCorruptInstaller() {
    if (!downloaded?.file) return;
    let cached = null;
    try { cached = JSON.parse(files.readFileSync(path.join(path.dirname(downloaded.file), 'update-info.json'), 'utf8')); } catch {}
    if (!cached || cached.sha512 === downloaded.sha512) try { files.unlinkSync(downloaded.file); } catch {}
  }

  // `active` is the renderer's view (it also knows about watching a stream); voice state is the main process's own.
  async function install({ confirmedDisconnect = false, active = false } = {}) {
    if (state.status !== 'ready') throw new Error('The update has not finished downloading yet');
    const voice = getVoiceState();
    const inCall = Boolean(active || voice?.connected || voice?.sharing);
    const otherWindows = coordinator.others().length;
    if ((inCall || otherWindows) && !confirmedDisconnect) throw Object.assign(new Error(confirmationMessage(inCall, otherWindows)), { code: inCall ? 'ACTIVE_CALL' : 'OTHER_WINDOWS' });
    timers.clearTimeout(timer);
    set({ status: 'installing', error: null, errorKind: null });
    const release = await coordinator.lock();
    if (!release) {
      set({ status: 'ready' });
      throw Object.assign(new Error('Another Haven window is downloading or installing an update. Try again in a moment.'), { code: 'BUSY' });
    }
    if (disposed || !(await verifiedInstaller())) {
      if (!disposed) discardCorruptInstaller();
      await release();
      if (disposed) throw new Error('Haven is closing');
      logger.warn?.('Haven update installer changed on disk before installing; downloading it again.');
      set({ status: 'failed', progress: null, error: 'The downloaded update changed on disk before it could be installed. Haven is downloading it again.', errorKind: 'integrity' });
      schedule(1000);
      throw new Error(state.error);
    }
    // Held until this process exits; the marker covers the installer that keeps running after that.
    installLock = release;
    coordinator.markInstalling(state.availableVersion);
    relaunch?.save();
    // Let the IPC reply reach the renderer before the app begins quitting.
    timers.setTimeout(() => {
      try { updater.quitAndInstall(true, true); }
      catch (error) { updater.emit('error', error); }
    }, 150);
    return snapshot();
  }

  return { start, check, install, snapshot, dispose: () => { disposed = true; timers.clearTimeout(timer); if (updater) coordinator.unregister(); } };
}

module.exports = { createUpdater, updateSupport, classifyUpdateError, plainReleaseNotes, confirmationMessage, relaunchFile, relaunchArgs, relaunchStore, takeRelaunchArgs, freeBytes, hashFile, CHECK_INTERVAL, FIRST_CHECK_DELAY, RETRY_DELAYS, LOCK_RETRY };
