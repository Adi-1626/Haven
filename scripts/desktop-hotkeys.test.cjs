const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const electronDir = fs.existsSync(path.resolve(__dirname, '../apps/desktop/electron')) ? path.resolve(__dirname, '../apps/desktop/electron') : path.resolve(__dirname, '../electron');
const { parseShortcut } = require(path.join(electronDir, 'desktop-settings.cjs'));
const { startNativeHotkeys } = require(path.join(electronDir, 'native-hotkeys.cjs'));

// Real Windows input: SendInput with hardware scan codes, observed by the real low-level hook.
const injector = `using System; using System.Runtime.InteropServices;
class Inject {
  [StructLayout(LayoutKind.Sequential)] struct KI { public ushort vk, scan; public uint flags, time; public IntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] struct IN { public uint type; public KI ki; public long pad; }
  [DllImport("user32.dll")] static extern uint SendInput(uint n, IN[] inputs, int size);
  [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  static void Send(int scan, bool extended, bool up) { IN[] i = new IN[1]; i[0].type = 1; i[0].ki.scan = (ushort)scan; i[0].ki.flags = 8u | (extended ? 1u : 0u) | (up ? 2u : 0u); SendInput(1, i, Marshal.SizeOf(typeof(IN))); }
  static void Main(string[] args) { foreach (string a in args) { string[] p = a.Split(':'); if (p[0][0] == 'v') { keybd_event(Convert.ToByte(p[0].Substring(1), 16), 0, p[2] == "u" ? 2u : 0u, UIntPtr.Zero); } else Send(Convert.ToInt32(p[0], 16), p[1] == "1", p[2] == "u"); System.Threading.Thread.Sleep(30); } }
}`;
const windows = process.platform === 'win32';
const compiler = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const key = (token, up) => { const entry = parseShortcut(token, { bare: true }); return `${entry.scanCode.toString(16)}:${entry.extended ? 1 : 0}:${up ? 'u' : 'd'}`; };
const press = token => key(token, false);
const release = token => key(token, true);

// This test injects real keystrokes (Backquote, F9, Numpad0, Ctrl, Shift...) into whichever window has focus, so it only runs when
// explicitly requested: HAVEN_REAL_KEYBOARD_TESTS=1 node --test scripts/desktop-hotkeys.test.cjs. Never run it while a game is open.
const optIn = process.env.HAVEN_REAL_KEYBOARD_TESTS === '1';
test('global push-to-talk follows physical keys, exact modifiers and recovers from lost releases', { skip: !windows || !fs.existsSync(compiler) || (!optIn && 'set HAVEN_REAL_KEYBOARD_TESTS=1 to inject real keystrokes') }, async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'haven-hotkeys-test-'));
  fs.writeFileSync(path.join(directory, 'inject.cs'), injector);
  const built = spawnSync(compiler, ['/nologo', `/out:${path.join(directory, 'inject.exe')}`, path.join(directory, 'inject.cs')], { encoding: 'utf8', windowsHide: true });
  assert.equal(built.status, 0, built.stdout);
  const inject = (...keys) => new Promise((resolve, reject) => { const child = spawn(path.join(directory, 'inject.exe'), keys, { windowsHide: true }); child.on('error', reject); child.on('exit', resolve); });
  const events = [];
  const helper = await startNativeHotkeys(directory, event => events.push(event.pressed));
  const configure = async value => { helper.configure(parseShortcut(value, { bare: true })); await wait(250); events.length = 0; };
  const expectEvents = async (expected, message) => { await wait(200); assert.deepEqual(events.splice(0), expected, message); };
  try {
    await configure('Backquote');
    await inject(press('Backquote'), release('Backquote'));
    await expectEvents([true, false], 'bare Backquote');
    await inject(press('ShiftLeft'), press('Backquote'), release('Backquote'), release('ShiftLeft'));
    await expectEvents([], 'extra Shift must not trigger a bare shortcut');

    // Macro tools and remappers inject by virtual key without a scan code; those must match too.
    await inject('vC0:0:d', 'vC0:0:u');
    await expectEvents([true, false], 'virtual-key-only injection of the Backquote key');

    await configure('Numpad0');
    await inject(press('Insert'), release('Insert'));
    await expectEvents([], 'dedicated Insert is not Numpad0');
    await inject(press('Numpad0'), release('Numpad0'));
    await expectEvents([true, false], 'Numpad0');

    await configure('ControlRight');
    await inject(press('ControlLeft'), release('ControlLeft'));
    await expectEvents([], 'left Control is not right Control');
    await inject(press('ControlRight'), press('ShiftLeft'), release('ShiftLeft'), release('ControlRight'));
    await expectEvents([true, false], 'modifier-only PTT ignores other modifiers');

    await configure('Control+Shift+F10');
    await inject(press('ControlLeft'), press('ShiftRight'), press('F10'));
    await expectEvents([true]);
    await inject(release('ShiftRight'));
    await expectEvents([false], 'releasing a modifier first closes transmission');
    await inject(release('F10'), release('ControlLeft'));
    await expectEvents([]);

    await configure('Slash');
    await inject(press('Slash'));
    await expectEvents([true]);
    helper.configure(null);
    await expectEvents([false], 'clearing or suspending the shortcut releases PTT');
    helper.configure(parseShortcut('Slash', { bare: true }));
    await wait(250); events.length = 0;
    await inject(release('Slash'));
    await expectEvents([], 'a key held through reconfiguration needs a fresh press');
    await inject(press('Slash'), release('Slash'));
    await expectEvents([true, false]);

    await configure('F9');
    helper.simulateDeadHook(true);
    await wait(100);
    helper.simulateDeadHook(false);
    await inject(press('F9'));
    await expectEvents([true]);
    helper.simulateDeadHook(true);
    await wait(100);
    await inject(release('F9'));
    await wait(900);
    assert.deepEqual(events.splice(0), [false], 'watchdog releases PTT when the hook never reports key-up');
    helper.simulateDeadHook(false);
  } finally {
    await inject(release('Backquote'), release('ShiftLeft'), release('Numpad0'), release('Insert'), release('ControlLeft'), release('ControlRight'), release('ShiftRight'), release('F10'), release('F9'), release('Slash')).catch(() => {});
    helper.stop();
    await wait(500);
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});
