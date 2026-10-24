const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const readline = require('node:readline');

async function startNativeHotkeys(userData, onEvent) {
  if (process.platform !== 'win32') throw new Error('Global hold-to-talk is currently supported on Windows only');
  const source = path.join(__dirname, 'HavenHotkeys.cs');
  const digest = crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex').slice(0, 16);
  const directory = path.join(userData, 'native');
  const bundled = path.join(__dirname, 'HavenHotkeys.exe');
  const executable = fs.existsSync(bundled) ? bundled : path.join(directory, `HavenHotkeys-${digest}.exe`);
  if (!fs.existsSync(executable)) {
    fs.mkdirSync(directory, { recursive: true });
    const compiler = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
    if (!fs.existsSync(compiler)) throw new Error('Windows .NET Framework compiler is unavailable; global push-to-talk cannot start');
    await new Promise((resolve, reject) => {
      const compilation = spawn(compiler, ['/nologo', '/optimize+', '/target:exe', `/out:${executable}`, source], { windowsHide: true });
      let diagnostic = '';
      compilation.stdout.on('data', chunk => { diagnostic += chunk; });
      compilation.stderr.on('data', chunk => { diagnostic += chunk; });
      compilation.on('error', reject);
      compilation.on('exit', code => code === 0 ? resolve() : reject(new Error(`Global keyboard helper compilation failed: ${diagnostic.slice(-1000)}`)));
    });
  }
  const child = spawn(executable, [], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
  const lines = readline.createInterface({ input: child.stdout });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Global keyboard helper did not become ready')), 6000);
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('exit', () => { clearTimeout(timeout); reject(new Error('Global keyboard helper stopped')); });
    lines.on('line', line => {
      let event;
      try { event = JSON.parse(line); } catch { return; }
      if (event.type === 'ready') { clearTimeout(timeout); resolve(); }
      else if (event.type === 'error') { clearTimeout(timeout); reject(new Error(event.message)); }
      else if (event.type === 'ptt') onEvent({ action: 'ptt', pressed: event.pressed === true });
    });
  }).catch(error => { child.kill(); throw error; });
  child.stdin.on('error', () => {});
  child.on('exit', () => onEvent({ action: 'ptt', pressed: false, unavailable: true }));
  return { simulateDeadHook: dead => { if (!child.killed && child.stdin.writable) child.stdin.write(`IGNORE ${dead ? 1 : 0}\n`); }, configure: shortcut => { if (!child.killed && child.stdin.writable) child.stdin.write(shortcut?.scanCode ? `CONFIG ${shortcut.scanCode} ${shortcut.extended ? 1 : 0} ${shortcut.modifiers}\n` : 'STOP\n'); }, stop: () => { child.kill(); lines.close(); } };
}
module.exports = { startNativeHotkeys };
