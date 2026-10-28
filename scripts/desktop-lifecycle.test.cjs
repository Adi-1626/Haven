const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const electronDir = fs.existsSync(path.resolve(__dirname, '../apps/desktop/electron')) ? path.resolve(__dirname, '../apps/desktop/electron') : path.resolve(__dirname, '../electron');
const { liveWindowContents, trustedClientEvent } = require(path.join(electronDir, 'client-access.cjs'));

test('desktop IPC ignores queued requests after the main window is destroyed', async () => {
  const listeners = new Map();
  const handlers = new Map();
  const windows = [];
  const written = [];
  const voiceStates = [];
  const menus = [];
  const desktop = { attachWindow: () => {}, startHidden: () => false, snapshot: () => ({}), setVoiceState: state => voiceStates.push(state) };
  class FakeWindow extends EventEmitter {
    constructor() {
      super();
      this.destroyed = false;
      this.contents = new EventEmitter();
      Object.assign(this.contents, { isDestroyed: () => false, getURL: () => 'http://127.0.0.1:3107', mainFrame: {}, session: { setPermissionCheckHandler: () => {}, setPermissionRequestHandler: () => {}, setDisplayMediaRequestHandler: () => {} }, setWindowOpenHandler: () => {} });
      windows.push(this);
    }
    get webContents() { if (this.destroyed) throw new TypeError('Object has been destroyed'); return this.contents; }
    isDestroyed() { return this.destroyed; }
    async loadURL() {}
  }
  const application = new EventEmitter();
  Object.assign(application, { setName: () => {}, getPath: () => __dirname, getVersion: () => '1.0.0', isPackaged: false, whenReady: () => Promise.resolve(), quit: () => {} });
  const electron = { app: application, BrowserWindow: FakeWindow, Menu: { setApplicationMenu: menu => menus.push(menu) }, ipcMain: { on: (name, listener) => listeners.set(name, listener), handle: (name, handler) => handlers.set(name, handler) }, powerMonitor: new EventEmitter() };
  const directory = electronDir;
  const sandbox = {
    __dirname: directory, console, URL, setTimeout,
    process: { env: {}, argv: ['electron', '.', '--server=http://127.0.0.1:3107'] },
    require: name => name === 'electron' ? electron : name === './desktop-runtime.cjs' ? { createDesktopRuntime: () => desktop } : name === './client-settings.cjs' ? { createClientSettings: () => ({ read: () => 'saved', write: (...values) => written.push(values) }) } : name.startsWith('./') ? require(path.join(directory, name)) : require(name),
  };
  vm.runInNewContext(fs.readFileSync(path.join(directory, 'main.cjs'), 'utf8'), sandbox);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(menus, [null]);
  const main = windows[0];
  const event = { sender: main.contents, senderFrame: main.contents.mainFrame, returnValue: undefined };
  listeners.get('desktop:client-setting-read')(event, 'haven.voice.state');
  assert.equal(event.returnValue, 'saved');
  listeners.get('desktop:client-setting-write')(event, 'setting', 'value');
  assert.equal(written.length, 1);
  await handlers.get('client:test')(event);
  const independent = windows[1];
  for (const denied of [
    { sender: independent.contents, senderFrame: independent.contents.mainFrame },
    { sender: main.contents, senderFrame: {} },
  ]) {
    listeners.get('desktop:client-setting-write')(denied, 'setting', 'unauthorized');
    assert.equal(denied.returnValue.ok, false);
    listeners.get('desktop:client-setting-status')(denied, 'haven.media.settings');
    assert.equal(denied.returnValue.canPersist, false);
    assert.equal(denied.returnValue.value, null);
  }
  assert.equal(written.length, 1);
  // Source runs never self-update, and only the main window may inspect or install updates.
  assert.equal(handlers.get('updates:state')(event).status, 'unsupported');
  assert.deepEqual({ ...await handlers.get('updates:install')(event, { confirmedDisconnect: true }) },{ ok: false, code: 'FAILED', message: 'The update has not finished downloading yet' });
  for (const handler of ['updates:state', 'updates:check', 'updates:install']) {
    assert.throws(() => handlers.get(handler)({ sender: independent.contents, senderFrame: independent.contents.mainFrame }), /main Haven window/);
  }
  main.destroyed = true;
  assert.throws(() => main.webContents, /Object has been destroyed/);
  for (const sender of [main.contents, independent.contents]) {
    const queued = { sender, senderFrame: sender.mainFrame, returnValue: undefined };
    assert.doesNotThrow(() => listeners.get('desktop:client-setting-read')(queued, 'setting'));
    assert.equal(queued.returnValue, null);
    assert.doesNotThrow(() => listeners.get('desktop:client-setting-write')(queued, 'setting', 'late'));
    assert.doesNotThrow(() => listeners.get('desktop:voice-state')(queued, { connected: true }));
  }
  assert.equal(written.length, 1);
  assert.equal(voiceStates.length, 0);
  await assert.rejects(handlers.get('desktop:update-settings')(event, {}), /main Haven window/);
});

test('destroyed windows and detached IPC frames cannot regain main-client privileges', () => {
  const destroyed = { isDestroyed: () => true, get webContents() { throw new TypeError('Object has been destroyed'); } };
  assert.equal(liveWindowContents(destroyed), null);
  assert.equal(liveWindowContents(undefined), null);
  const sender = { isDestroyed: () => false, mainFrame: {} };
  assert.equal(trustedClientEvent({ sender, get senderFrame() { throw new Error('Frame was destroyed'); } }, () => true, destroyed), false);
  assert.equal(trustedClientEvent({ sender, senderFrame: sender.mainFrame }, () => true, destroyed, true), false);
  assert.equal(trustedClientEvent({ sender, senderFrame: {} }, () => true), false);
});
