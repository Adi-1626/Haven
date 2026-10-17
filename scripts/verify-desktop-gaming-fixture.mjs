// Runs the existing desktop verifier unchanged against an isolated legacy service.
// This fixture does not verify the concurrent backend/authentication integration.
import { spawn } from 'node:child_process';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const entry = path.join(root, 'release/Haven-0.4.1-win32-x64/resources/app/build/server/index.js');
const web = path.join(root, 'apps/web/dist');
await Promise.all([access(entry), access(path.join(web, 'index.html'))]);
const fixture = await mkdtemp(path.join(tmpdir(), 'haven-gaming-fixture-'));
let service;
let verifier;
let frontend;
let serviceOutput = '';
let verifierOutput = '';
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function availablePort() {
  const listener = createNetServer();
  await new Promise((resolve, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', resolve); });
  const port = listener.address().port;
  await new Promise((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
  return port;
}

async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise(resolve => child.once('exit', resolve));
  child.kill();
  let timeout;
  await Promise.race([exited, new Promise(resolve => { timeout = setTimeout(resolve, 3000); })]);
  clearTimeout(timeout);
  if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await exited; }
}

try {
  const serviceOrigin = `http://127.0.0.1:${await availablePort()}`;
  frontend = await createServer({
    root: web,
    configFile: false,
    server: {
      host: '127.0.0.1', port: 0,
      proxy: {
        '/api': { target: serviceOrigin, changeOrigin: true },
        '/socket.io': { target: serviceOrigin, ws: true, changeOrigin: true },
      },
    },
  });
  await frontend.listen();
  const origin = `http://127.0.0.1:${frontend.httpServer.address().port}`;
  service = spawn(process.execPath, [entry], {
    cwd: fixture,
    env: { ...process.env, HOST: '127.0.0.1', PORT: new URL(serviceOrigin).port, DATA_DIR: path.join(fixture, 'data'), SERVE_STATIC: 'true', ALLOWED_ORIGINS: origin },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serviceError;
  service.on('error', error => { serviceError = error; });
  const retainServiceOutput = chunk => { serviceOutput = (serviceOutput + chunk).slice(-8000); };
  service.stdout.on('data', retainServiceOutput);
  service.stderr.on('data', retainServiceOutput);
  let ready = false;
  let lastHealth = '';
  for (let attempt = 0; attempt < 150; attempt++) {
    if (serviceError || service.exitCode !== null) break;
    try {
      const response = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) { ready = true; break; }
      lastHealth = `${response.status} ${(await response.text()).slice(0, 500)}`;
    } catch (error) { lastHealth = error.message; }
    await delay(100);
  }
  if (!ready) throw new Error(`Isolated legacy service/proxy failed to start: ${serviceError?.message || serviceOutput}; health ${lastHealth}; ${origin} -> ${serviceOrigin}`);
  console.log(JSON.stringify({ fixture: 'isolated legacy service + current built frontend', origin, serviceOrigin, limitations: ['Does not validate current backend/authentication integration.', 'Unchanged verifier expects restart to change origin; HAVEN_SERVER fixture deliberately keeps a stable remote origin.'] }));
  verifier = spawn(process.execPath, [path.join(root, 'scripts/verify-desktop-gaming.mjs'), ...process.argv.slice(2)], {
    cwd: root,
    env: { ...process.env, HAVEN_SERVER: origin },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  verifier.stdout.on('data', chunk => { verifierOutput += chunk; process.stdout.write(chunk); });
  verifier.stderr.on('data', chunk => { verifierOutput += chunk; process.stderr.write(chunk); });
  const result = await new Promise((resolve, reject) => { verifier.once('error', reject); verifier.once('exit', (code, signal) => resolve({ code, signal })); });
  if (result.code !== 0) {
    const restartOriginMismatch = /assert\.notEqual\(secondOrigin, firstOrigin\)|Expected "actual" to be strictly unequal to/.test(verifierOutput);
    console.error(JSON.stringify({
      fixturePass: false,
      classification: restartOriginMismatch ? 'unchanged verifier restart-origin assertion is incompatible with fixed HAVEN_SERVER fixture' : 'desktop verifier failure; inspect its unchanged assertion output',
      code: result.code,
      signal: result.signal,
      ...(restartOriginMismatch ? {
        evidence: 'Reached the sequential restart-origin assertion; preceding unchanged assertions passed.',
        completedChecks: [
          'desktop setting conflict validation, persistence, and isolated client access',
          'capture picker Cancel, native close, and Escape preserve synthetic microphone',
          'actual tray mute/deafen callbacks and native Windows PTT helper readiness',
          'shortcut recording suspension, restoration, and held-key repeat protection',
          'global PTT press/release, modifier release, mute/deafen behind own fullscreen test window',
          'global bindings restored on minimize',
          'captured-window video and synthetic microphone RTP bytes increase while minimized',
          'live media tracks and connected peers survive close-to-tray',
          'Gaming Mode persists across renderer reload',
        ],
        unverified: ['restart preference assertions after the origin check', 'final tray Quit assertion', 'physical microphone, game FPS, and anti-cheat compatibility'],
      } : {}),
    }));
    process.exitCode = result.code || 1;
  }
} finally {
  await stop(verifier);
  await frontend?.close();
  await stop(service);
  const relative = path.relative(path.resolve(tmpdir()), path.resolve(fixture));
  if (relative.startsWith('haven-gaming-fixture-') && !relative.includes(path.sep)) await rm(fixture, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
