const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const electronDir = fs.existsSync(path.resolve(__dirname, '../apps/desktop/electron')) ? path.resolve(__dirname, '../apps/desktop/electron') : path.resolve(__dirname, '../electron');
const { parseShortcut } = require(path.join(electronDir, 'desktop-settings.cjs'));

// The main-process half of global push-to-talk, driven by a stand-in for the Windows keyboard helper.
// No hook is installed and no keystroke is injected: the fake reports key-down/key-up exactly as the helper's
// stdout protocol would, so window-state, recording, power, crash and quit handling can run anywhere.
// The real hook (scan codes, exact modifiers, lost key-up watchdog) is covered by desktop-hotkeys.test.cjs (opt-in).
const helpers = [];
let startGate = null;
const nativeModule = path.join(electronDir, 'native-hotkeys.cjs');
require.cache[nativeModule] = { id: nativeModule, filename: nativeModule, loaded: true, exports: { startNativeHotkeys: async (_userData, onEvent) => {
  const helper = { configs: [], stopped: false,
    configure: shortcut => { helper.configs.push(shortcut ? shortcut.shortcut : null); },
    // Like the real helper: killing the child process later reports a release flagged unavailable.
    stop: () => { if (helper.stopped) return; helper.stopped = true; setImmediate(() => onEvent({ action: 'ptt', pressed: false, unavailable: true })); },
    press: () => onEvent({ action: 'ptt', pressed: true }),
    release: () => onEvent({ action: 'ptt', pressed: false }),
    crash: () => { helper.stopped = true; onEvent({ action: 'ptt', pressed: false, unavailable: true }); } };
  helpers.push(helper);
  if (startGate) await startGate;
  return helper;
} } };
const { createDesktopRuntime } = require(path.join(electronDir, 'desktop-runtime.cjs'));
const settle = () => new Promise(resolve => setImmediate(resolve));

function harness() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'haven-ptt-unit-'));
  const window = new EventEmitter();
  const shortcuts = [];
  const states = [];
  const order = [];
  let visible = true; let minimized = false; let focused = true;
  window.webContents = { send: (name, data) => { if (name === 'desktop:shortcut') { shortcuts.push(data); order.push(`ptt:${data.pressed}`); } if (name === 'desktop:state') states.push(data); }, isDestroyed: () => false };
  Object.assign(window, { isDestroyed: () => false, isMinimized: () => minimized, isVisible: () => visible, isFocused: () => focused,
    hide: () => { visible = false; focused = false; window.emit('hide'); }, show: () => { visible = true; window.emit('show'); }, focus: () => { focused = true; window.emit('focus'); }, restore: () => { minimized = false; window.emit('restore'); } });
  const registered = new Map();
  let tray;
  class FakeTray extends EventEmitter { constructor() { super(); tray = this; } setToolTip(value) { this.tooltip = value; } setContextMenu(value) { this.menu = value; } destroy() { this.destroyed = true; } }
  const app = { getPath: () => profile, getAppPath: () => 'C:\\Haven', isPackaged: false, setLoginItemSettings() {}, quit: () => order.push('app.quit') };
  const runtime = createDesktopRuntime({ app, Tray: FakeTray, Menu: { buildFromTemplate: items => items }, nativeImage: { createFromBitmap: () => ({}) },
    globalShortcut: { unregisterAll: () => registered.clear(), register: (key, callback) => { registered.set(key, callback); return true; }, unregister: key => registered.delete(key) },
    getWindow: () => window, getClients: () => [window.webContents], onQuit: () => order.push('onQuit') });
  runtime.attachWindow(window);
  const blur = () => { focused = false; window.emit('blur'); };
  const minimize = () => { minimized = true; focused = false; window.emit('minimize'); };
  const cleanup = () => { runtime.beforeQuit(); fs.rmSync(profile, { recursive: true, force: true }); };
  return { runtime, window, shortcuts, states, order, registered, tray: () => tray, blur, minimize, cleanup, available: () => runtime.snapshot(window.webContents).runtime.globalPttAvailable };
}
const ptt = list => list.filter(event => event.action === 'ptt').map(event => event.pressed);

test('global PTT keeps working while the window is unfocused, minimized or hidden to the tray, and restore does not key the mic', async () => {
  helpers.length = 0;
  const h = harness();
  try {
    await h.runtime.apply({ minimizeToTray: true, closeToTray: true });
    h.runtime.setVoiceState({ connected: true, pushToTalk: true });
    await settle();
    assert.equal(helpers.length, 1);
    const helper = helpers[0];
    assert.deepEqual(helper.configs, ['Control+Shift+Space'], 'the helper watches the configured shortcut');
    assert.equal(h.available(), true);
    assert.equal(h.states.at(-1).runtime.globalPttAvailable, true, 'the renderer is told global PTT is active');
    h.shortcuts.length = 0;

    // Background PTT: each window-state change leaves the helper running, configured and forwarding both edges.
    for (const change of [h.blur, h.minimize, () => h.window.hide()]) {
      change();
      await settle();
      assert.equal(h.shortcuts.length, 0, 'window-state changes alone must not send PTT events');
      assert.deepEqual(helper.configs, ['Control+Shift+Space'], 'window-state changes must not reconfigure or stop the hook');
      helper.press(); helper.release();
      assert.deepEqual(ptt(h.shortcuts.splice(0)), [true, false]);
      assert.equal(h.available(), true);
      assert.equal(h.runtime.snapshot(h.window.webContents).runtime.background, true);
    }
    // A key held while backgrounded is released normally after the window returns.
    helper.press();
    h.runtime.restore();
    await settle();
    assert.deepEqual(ptt(h.shortcuts.splice(0)), [true], 'restoring the window neither opens nor closes the mic by itself');
    helper.release();
    assert.deepEqual(ptt(h.shortcuts.splice(0)), [false]);
    assert.equal(h.runtime.snapshot(h.window.webContents).runtime.background, false);
    assert.equal(helpers.length, 1, 'no second hook is started by window-state changes');
  } finally { h.cleanup(); }
});

test('recording, power events and shortcut changes release or re-arm PTT without opening the mic', async () => {
  helpers.length = 0;
  const h = harness();
  try {
    h.runtime.setVoiceState({ connected: true, pushToTalk: true });
    await settle();
    const helper = helpers[0];
    h.shortcuts.length = 0;

    // Recording a new shortcut: PTT is released, presses are suppressed, releases still pass through.
    helper.press();
    await h.runtime.setRecording(true);
    assert.deepEqual(ptt(h.shortcuts.splice(0)), [true, false]);
    assert.equal(helper.configs.at(-1), null, 'the hook stops matching while recording');
    assert.equal(h.available(), false, 'the renderer falls back to local handling while recording');
    helper.press();
    helper.release();
    assert.deepEqual(ptt(h.shortcuts.splice(0)), [false], 'presses never reach the renderer while recording');
    await h.runtime.setRecording(false);
    assert.equal(helper.configs.at(-1), 'Control+Shift+Space');
    assert.equal(h.available(), true);

    // Suspend / lock screen: release and re-arm so a key held across the transition needs a fresh press.
    helper.press();
    h.shortcuts.length = 0;
    const configured = helper.configs.length;
    h.runtime.releasePtt();
    assert.deepEqual(ptt(h.shortcuts.splice(0)), [false]);
    assert.equal(helper.configs.length, configured + 1);
    assert.equal(helper.configs.at(-1), 'Control+Shift+Space');

    // Bare keys and lone modifiers are passed to the hook as physical keys.
    for (const shortcut of ['Backquote', 'ControlRight', 'F9', 'Control+Shift+F10']) {
      await h.runtime.apply({ pttShortcut: shortcut });
      assert.equal(helper.configs.at(-1), parseShortcut(shortcut, { bare: true }).shortcut);
      assert.equal(helpers.length, 1, 'changing the shortcut reuses the running hook');
    }
  } finally { h.cleanup(); }
});

test('leaving voice, turning PTT off, a helper crash and quitting all release PTT', async () => {
  helpers.length = 0;
  const h = harness();
  try {
    // Leaving voice stops the hook and releases.
    h.runtime.setVoiceState({ connected: true, pushToTalk: true });
    await settle();
    helpers[0].press();
    h.shortcuts.length = 0;
    h.runtime.setVoiceState({ connected: false });
    await settle();
    assert.equal(helpers[0].stopped, true);
    assert.equal(ptt(h.shortcuts.splice(0))[0], false);
    assert.equal(h.available(), false);
    assert.equal(h.runtime.snapshot(h.window.webContents).runtime.shortcutErrors.length, 0, 'an intentional stop is not reported as a failure');

    // Turning push-to-talk off while connected does the same.
    h.runtime.setVoiceState({ connected: true, pushToTalk: true });
    await settle();
    assert.equal(helpers.length, 2);
    h.shortcuts.length = 0;
    h.runtime.setVoiceState({ pushToTalk: false });
    await settle();
    assert.equal(helpers[1].stopped, true);
    assert.equal(ptt(h.shortcuts.splice(0))[0], false);

    // A crashed helper releases PTT, is reported, and the renderer falls back to in-window PTT.
    h.runtime.setVoiceState({ pushToTalk: true });
    await settle();
    helpers[2].press();
    h.shortcuts.length = 0;
    helpers[2].crash();
    assert.deepEqual(ptt(h.shortcuts.splice(0)), [false]);
    assert.equal(h.available(), false);
    assert.match(h.runtime.snapshot(h.window.webContents).runtime.shortcutErrors.join(), /keyboard helper stopped/);
    assert.equal(h.states.at(-1).runtime.globalPttAvailable, false);

    // Reconnecting voice retries the helper.
    h.runtime.setVoiceState({ connected: false });
    h.runtime.setVoiceState({ connected: true });
    await settle();
    assert.equal(helpers.length, 4);
    assert.equal(h.available(), true);

    // Tray quit releases PTT before the app is told to quit, and the helper's exit is not reported as an error.
    await h.runtime.apply({ closeToTray: true });
    helpers[3].press();
    h.order.length = 0;
    h.tray().menu.find(item => item.label === 'Quit Haven (disconnect voice)').click();
    assert.deepEqual(h.order, ['ptt:false', 'onQuit', 'app.quit']);
    h.runtime.beforeQuit();
    await settle();
    assert.equal(helpers[3].stopped, true);
    assert.equal(h.registered.size, 0);
    assert.equal(h.runtime.snapshot(h.window.webContents).runtime.shortcutErrors.length, 0);
  } finally { h.cleanup(); }
});

test('leaving voice while the helper is still starting never leaves a hook running', async () => {
  helpers.length = 0;
  let open;
  startGate = new Promise(resolve => { open = resolve; });
  const h = harness();
  try {
    h.runtime.setVoiceState({ connected: true, pushToTalk: true });
    await settle();
    h.runtime.setVoiceState({ connected: false });
    open();
    await settle(); await settle();
    assert.equal(helpers.length, 1);
    assert.equal(helpers[0].stopped, true, 'a helper that finishes starting after voice ended is stopped');
    assert.equal(h.available(), false);
  } finally { startGate = null; h.cleanup(); }
});
