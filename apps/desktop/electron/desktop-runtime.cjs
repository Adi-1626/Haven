const fs = require('node:fs');
const path = require('node:path');
const { defaults, parseShortcut, validateSettings } = require('./desktop-settings.cjs');
const { startNativeHotkeys } = require('./native-hotkeys.cjs');
const { liveWindowContents } = require('./client-access.cjs');

function createDesktopRuntime({ app, Tray, Menu, nativeImage, iconPath, globalShortcut, getWindow, getClients, onQuit }) {
  const settingsFile = path.join(app.getPath('userData'), 'desktop-settings.json');
  let settings = { ...defaults };
  let shortcutErrors = [];
  try { settings = validateSettings(settings, JSON.parse(fs.readFileSync(settingsFile, 'utf8'))); } catch {}
  let voice = { connected: false, muted: false, deafened: false, sharing: false, pushToTalk: false };
  let tray;
  let trayState;
  const deliveredStates = new WeakMap();
  let quitting = false;
  let helper;
  let helperStarting;
  let helperGeneration = 0;
  const backgrounds = new WeakMap();
  let recording = false;
  const send = event => { if (recording && (event.action !== 'ptt' || event.pressed)) return; liveWindowContents(getWindow())?.send('desktop:shortcut', event); };
  const snapshot = contents => { const mainContents = liveWindowContents(getWindow()); const mainClient = Boolean(mainContents && contents === mainContents); return { settings: { ...settings }, runtime: { globalPttAvailable: !!helper && !recording && mainClient, shortcutErrors: [...shortcutErrors], background: backgrounds.get(contents) ?? true, canConfigureDesktop: mainClient } }; };
  const broadcast = () => {
    for (const contents of getClients()) {
      if (contents.isDestroyed()) continue;
      const state = snapshot(contents);
      const serialized = JSON.stringify(state);
      if (deliveredStates.get(contents) === serialized) continue;
      contents.send('desktop:state', state);
      deliveredStates.set(contents, serialized);
    }
  };
  const restore = () => { const window = getWindow(); if (!window || window.isDestroyed()) return; if (window.isMinimized()) window.restore(); window.show(); window.focus(); };
  const quit = () => { quitting = true; send({ action: 'ptt', pressed: false }); onQuit(); app.quit(); };
  const updateTray = () => {
    if (!tray) return;
    // Hold-to-talk state does not change the menu; avoid rebuilding native menus
    // for repeated renderer reports or unrelated settings updates.
    const next = JSON.stringify([voice.connected, voice.muted, voice.deafened, voice.sharing]);
    if (trayState === next) return;
    tray.setToolTip(`Haven${voice.connected ? ` · ${voice.deafened ? 'Deafened' : voice.muted ? 'Muted' : 'Voice connected'}${voice.sharing ? ' · Sharing screen' : ''}` : ''}`);
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Open Haven', click: restore },
      { type: 'separator' },
      { label: voice.muted ? 'Unmute microphone' : 'Mute microphone', enabled: voice.connected, click: () => send({ action: 'mute' }) },
      { label: voice.deafened ? 'Undeafen audio' : 'Deafen audio', enabled: voice.connected, click: () => send({ action: 'deafen' }) },
      { type: 'separator' },
      { label: 'Quit Haven (disconnect voice)', click: quit }
    ]));
    trayState = next;
  };
  const ensureTray = () => {
    if (!settings.closeToTray && !settings.minimizeToTray) { tray?.destroy(); tray = undefined; trayState = undefined; return; }
    if (!tray) {
      // A multi-resolution .ico path lets Windows pick the tray size for the current DPI.
      let image = iconPath && fs.existsSync(iconPath) ? iconPath : undefined;
      if (!image) {
        // Fallback when the bundled icon is missing: a plain lavender disc rather than an empty tray slot.
        const pixels = Buffer.alloc(32 * 32 * 4);
        for (let vertical = 0; vertical < 32; vertical++) for (let horizontal = 0; horizontal < 32; horizontal++) {
          const index = (vertical * 32 + horizontal) * 4;
          const inside = (horizontal - 15.5) ** 2 + (vertical - 15.5) ** 2 <= 13 ** 2;
          pixels[index] = 255; pixels[index + 1] = 193; pixels[index + 2] = 192; pixels[index + 3] = inside ? 255 : 0;
        }
        image = nativeImage.createFromBitmap(pixels, { width: 32, height: 32 });
      }
      tray = new Tray(image);
      tray.on('double-click', restore);
    }
    updateTray();
  };
  const registerShortcuts = next => {
    globalShortcut.unregisterAll();
    const failures = [];
    const attempt = (shortcut, callback) => { try { return globalShortcut.register(shortcut, callback); } catch { return false; } };
    for (const [setting, action] of [['muteShortcut', 'mute'], ['deafenShortcut', 'deafen']]) {
      const accelerator = next[setting] && parseShortcut(next[setting]).accelerator;
      if (accelerator && !attempt(accelerator, () => send({ action }))) failures.push(`${action}: ${next[setting]} is already registered by another application`);
    }
    // Push-to-talk is observed by the keyboard hook, which works even when another
    // application owns the hotkey. Probe it only to warn about the conflict.
    const probe = next.pttShortcut && parseShortcut(next.pttShortcut, { bare: true }).accelerator;
    if (probe) {
      if (!attempt(probe, () => {})) failures.push(`push-to-talk: ${next.pttShortcut} is already registered by another application`);
      else globalShortcut.unregister(probe);
    }
    return failures;
  };
  const syncHelper = async () => {
    // A hotkey conflict is reported but does not disable the hook-based helper.
    const wanted = voice.connected && voice.pushToTalk && !!settings.pttShortcut;
    if (!wanted) {
      helperGeneration++;
      helper?.stop(); helper = undefined;
      send({ action: 'ptt', pressed: false });
      broadcast();
      return;
    }
    if (helper) { helper.configure(recording ? null : parseShortcut(settings.pttShortcut, { bare: true })); return; }
    if (helperStarting) return;
    const generation = ++helperGeneration;
    helperStarting = startNativeHotkeys(app.getPath('userData'), event => {
      send({ action: 'ptt', pressed: event.pressed });
      if (event.unavailable && helperGeneration === generation && !quitting) {
        helper = undefined;
        shortcutErrors = [...shortcutErrors.filter(error => !error.startsWith('Global push-to-talk:')), 'Global push-to-talk: keyboard helper stopped; reconnect voice to retry'];
        broadcast();
      }
    });
    try {
      const started = await helperStarting;
      if (generation !== helperGeneration || quitting) started.stop();
      else { helper = started; helper.configure(recording ? null : parseShortcut(settings.pttShortcut, { bare: true })); shortcutErrors = shortcutErrors.filter(error => !error.startsWith('Global push-to-talk:')); }
    } catch (error) { if (generation === helperGeneration) shortcutErrors.push(`Global push-to-talk: ${error.message}`); }
    finally { helperStarting = undefined; broadcast(); if (generation !== helperGeneration && !quitting && voice.connected && voice.pushToTalk && !helper) void syncHelper(); }
  };
  const apply = async patch => {
    if (recording) throw new Error('Finish or cancel recording before applying settings');
    const next = validateSettings(settings, patch);
    const failures = registerShortcuts(next);
    if (failures.length) { registerShortcuts(settings); throw new Error(failures.join('; ')); }
    try {
      if (process.platform === 'win32' && next.startAtLogin !== settings.startAtLogin) app.setLoginItemSettings({ openAtLogin: next.startAtLogin, path: process.execPath, args: [...(app.isPackaged ? [] : [app.getAppPath()]), ...(process.argv.includes('--local-mode') ? ['--local-mode'] : []), '--startup'] });
      fs.mkdirSync(app.getPath('userData'), { recursive: true });
      const temporary = `${settingsFile}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify(next, null, 2));
      fs.renameSync(temporary, settingsFile);
    } catch (error) { registerShortcuts(settings); throw new Error(`Desktop settings could not be saved: ${error.message}`); }
    settings = next;
    shortcutErrors = [];
    ensureTray();
    await syncHelper();
    broadcast();
  };
  const setRecording = async active => {
    if (recording === active || quitting) return;
    recording = active;
    send({ action: 'ptt', pressed: false });
    if (recording) { globalShortcut.unregisterAll(); helper?.configure(null); }
    else { shortcutErrors = registerShortcuts(settings); await syncHelper(); }
    broadcast();
  };
  const attachWindow = (window, mainClient = true) => {
    const contents = liveWindowContents(window);
    if (!contents) return;
    window.on('close', event => { if (mainClient && !quitting && settings.closeToTray && tray) { event.preventDefault(); window.hide(); } });
    window.on('minimize', () => { if (mainClient && !quitting && settings.minimizeToTray && tray) window.hide(); });
    // Keep Chromium's realtime scheduling enabled; the renderer uses this state
    // only to suspend optional visual work, including while a game has focus.
    const windowState = () => { backgrounds.set(contents, window.isDestroyed() || !window.isVisible() || window.isMinimized() || !window.isFocused()); broadcast(); };
    for (const event of ['minimize', 'restore', 'show', 'hide', 'focus', 'blur']) window.on(event, windowState);
    window.on('closed', () => { backgrounds.delete(contents); deliveredStates.delete(contents); });
    if (!mainClient) { windowState(); return; }
    for (const event of ['blur', 'hide', 'closed']) window.on(event, () => { void setRecording(false); });
    window.webContents.on?.('did-start-navigation', (_event, _url, _isInPlace, isMainFrame) => { if (isMainFrame) void setRecording(false); });
    window.webContents.on?.('render-process-gone', () => { void setRecording(false); });
    windowState();
  };
  shortcutErrors = registerShortcuts(settings);
  ensureTray();
  return {
    snapshot, apply, attachWindow, restore, quit, setRecording,
    releasePtt: () => { send({ action: 'ptt', pressed: false }); helper?.configure(recording ? null : parseShortcut(settings.pttShortcut, { bare: true })); },
    startHidden: () => process.argv.includes('--startup') && settings.startMinimized && (settings.closeToTray || settings.minimizeToTray),
    setVoiceState: next => { const previous = voice; voice = { ...voice }; for (const key of Object.keys(voice)) if (typeof next?.[key] === 'boolean') voice[key] = next[key]; updateTray(); if (previous.connected !== voice.connected || previous.pushToTalk !== voice.pushToTalk) void syncHelper(); },
    beforeQuit: () => { quitting = true; helperGeneration++; helper?.stop(); helper = undefined; globalShortcut.unregisterAll(); tray?.destroy(); tray = undefined; }
  };
}
module.exports = { createDesktopRuntime };
