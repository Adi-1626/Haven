import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir, cpus, totalmem } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { createServer } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const label = process.argv[2] || 'current';
const executablePath = process.argv[3] ? path.resolve(process.argv[3]) : undefined;
if (!/^[a-z0-9-]+$/i.test(label)) throw new Error('Use a simple measurement label');
const profile = await mkdtemp(path.join(tmpdir(), 'haven-measure-'));
const sampleCount = 5;
const sampleInterval = 1200;
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
let instance;
let browser;
let fixtureBackend;
let fixtureFrontend;
const request = (page, endpoint, data) => page.evaluate(async ({ endpoint, data }) => {
  const response = await fetch(`/api${endpoint}`, { method: data ? 'POST' : 'GET', headers: data ? { 'Content-Type': 'application/json' } : undefined, body: data ? JSON.stringify(data) : undefined });
  const body = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(body));
  return body;
}, { endpoint, data });
const instrument = page => page.addInitScript(() => {
  window.__measureConnections = [];
  const Original = window.RTCPeerConnection;
  window.RTCPeerConnection = class extends Original {
    constructor(configuration) { super(configuration); window.__measureConnections.push(this); }
  };
  navigator.mediaDevices.getDisplayMedia = async () => {
    const canvas = document.createElement('canvas'); canvas.width = 1920; canvas.height = 1080;
    const context = canvas.getContext('2d'); let frame = 0;
    const draw = () => { context.fillStyle = `hsl(${frame++ % 360} 45% 40%)`; context.fillRect(0, 0, canvas.width, canvas.height); };
    draw(); const timer = setInterval(draw, 1000 / 30);
    const stream = canvas.captureStream(30);
    const track = stream.getVideoTracks()[0]; const stop = track.stop.bind(track);
    track.stop = () => { clearInterval(timer); stop(); };
    return stream;
  };
});
async function mediaSample(page) {
  return page.evaluate(async () => {
    const reports = await Promise.all((window.__measureConnections || []).filter(connection => connection.connectionState !== 'closed').map(connection => connection.getStats()));
    let sent = 0; let received = 0; let packetsLost = 0; let packetsReceived = 0;
    const jitterMs = []; const roundTripMs = [];
    for (const report of reports) for (const stat of report.values()) {
      if (stat.type === 'outbound-rtp' && stat.kind === 'audio') sent += stat.bytesSent || 0;
      if (stat.type === 'inbound-rtp' && stat.kind === 'audio') {
        received += stat.bytesReceived || 0; packetsLost += stat.packetsLost || 0; packetsReceived += stat.packetsReceived || 0;
        if (Number.isFinite(stat.jitter)) jitterMs.push(stat.jitter * 1000);
      }
      if (stat.type === 'candidate-pair' && stat.state === 'succeeded' && stat.nominated && Number.isFinite(stat.currentRoundTripTime)) roundTripMs.push(stat.currentRoundTripTime * 1000);
    }
    let videoSent = 0; let concealedSamples = 0; let totalSamplesReceived = 0; const encoded = [];
    for (const report of reports) for (const stat of report.values()) {
      if (stat.type === 'outbound-rtp' && stat.kind === 'video') { videoSent += stat.bytesSent || 0; encoded.push({ width: stat.frameWidth, height: stat.frameHeight, fps: stat.framesPerSecond, framesEncoded: stat.framesEncoded, totalEncodeTime: stat.totalEncodeTime, qualityLimitationReason: stat.qualityLimitationReason }); }
      if (stat.type === 'inbound-rtp' && stat.kind === 'audio') { concealedSamples += stat.concealedSamples || 0; totalSamplesReceived += stat.totalSamplesReceived || 0; }
    }
    return { time: performance.now(), sent, received, videoSent, concealedSamples, totalSamplesReceived, packetsLost, packetsReceived, jitterMs, roundTripMs, encoded };
  });
}
const mean = values => values.reduce((total, value) => total + value, 0) / Math.max(1, values.length);
const percentile = (values, fraction) => [...values].sort((first, second) => first - second)[Math.min(values.length - 1, Math.floor(values.length * fraction))] ?? null;
try {
  let fixtureOrigin;
  if (process.env.HAVEN_MEASURE_BACKEND) {
    const port = await new Promise((resolve, reject) => { const socket = net.createServer(); socket.on('error', reject); socket.listen(0, '127.0.0.1', () => { const port = socket.address().port; socket.close(() => resolve(port)); }); });
    fixtureOrigin = `http://127.0.0.1:${port}`;
    fixtureBackend = spawn(process.execPath, [process.env.HAVEN_MEASURE_BACKEND], { cwd: root, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: path.join(profile, 'server'), SERVE_STATIC: 'true' }, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let error = ''; fixtureBackend.stderr.on('data', chunk => { error += chunk; });
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      try { if ((await fetch(`${fixtureOrigin}/api/health`)).ok) { ready = true; break; } } catch {}
      if (fixtureBackend.exitCode !== null) break;
      await wait(100);
    }
    if (!ready) throw new Error(`Isolated benchmark backend failed: ${error.slice(-1000)}`);
    // Keep the backend fixed while serving the exact selected frontend snapshot.
    // Older packaged fixtures do not support STATIC_DIR themselves.
    fixtureFrontend = await createServer({ root: process.env.STATIC_DIR || path.join(root, 'apps/web/dist'), configFile: false, server: { host: '127.0.0.1', port: 0, proxy: { '/api': { target: fixtureOrigin, changeOrigin: true }, '/socket.io': { target: fixtureOrigin, ws: true, changeOrigin: true } } } });
    await fixtureFrontend.listen();
    fixtureOrigin = `http://127.0.0.1:${fixtureFrontend.httpServer.address().port}`;
  }
  instance = await electron.launch({ ...(executablePath ? { executablePath } : {}), args: [...(executablePath ? [] : [process.env.HAVEN_MEASURE_ENTRY || root]), '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'], env: { ...process.env, HAVEN_PROFILE_DIR: profile, ...(fixtureOrigin ? { HAVEN_SERVER: fixtureOrigin } : {}) } });
  const main = await instance.firstWindow();
  await main.waitForLoadState('domcontentloaded');
  await instrument(main);
  await request(main, '/auth/register', { username: 'measureowner', displayName: 'Measure owner', password: 'Measure-Only-2026' });
  const community = (await request(main, '/servers', { name: 'Background measurement' })).server;
  const invite = await request(main, `/servers/${community.id}/invites`, {});
  await main.reload();
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const context = await browser.newContext({ permissions: ['microphone'] });
  const guest = await context.newPage();
  await instrument(guest);
  await guest.goto(main.url());
  await request(guest, '/auth/register', { username: 'measureguest', displayName: 'Measure guest', password: 'Measure-Only-2026' });
  await request(guest, `/invites/${invite.code}/join`, {});
  await guest.reload();
  const phases = [];
  async function measure(name, minimized) {
    await instance.evaluate(({ BrowserWindow }, minimized) => { const target = BrowserWindow.getAllWindows().find(candidate => !candidate.isDestroyed()); if (minimized) target.minimize(); else { target.restore(); target.show(); } }, minimized);
    await wait(2000);
    await instance.evaluate(({ app }) => app.getAppMetrics());
    const samples = [];
    for (let sample = 0; sample < sampleCount; sample++) {
      await wait(sampleInterval);
      const processes = await instance.evaluate(({ app }) => app.getAppMetrics().map(metric => ({ pid: metric.pid, type: metric.type, cpu: metric.cpu.percentCPUUsage, workingSetKB: metric.memory.workingSetSize, privateKB: metric.memory.privateBytes })));
      samples.push({ processes, media: await mediaSample(main) });
    }
    const first = samples[0].media; const last = samples.at(-1).media; const seconds = (last.time - first.time) / 1000;
    const phase = { name, minimized, samples, summary: { electronCpuMetricSumMean: mean(samples.map(sample => sample.processes.reduce((sum, process) => sum + process.cpu, 0))), electronWorkingSetMBMean: mean(samples.map(sample => sample.processes.reduce((sum, process) => sum + process.workingSetKB, 0) / 1024)), audioSentKbps: Math.max(0, last.sent - first.sent) * 8 / seconds / 1000, audioReceivedKbps: Math.max(0, last.received - first.received) * 8 / seconds / 1000, packetsLostDelta: last.packetsLost - first.packetsLost, packetsReceivedDelta: last.packetsReceived - first.packetsReceived, videoSentKbps: Math.max(0, last.videoSent - first.videoSent) * 8 / seconds / 1000, concealedSamplesDelta: last.concealedSamples - first.concealedSamples, jitterMsMean: mean(samples.flatMap(sample => sample.media.jitterMs)), candidateRoundTripMsMean: mean(samples.flatMap(sample => sample.media.roundTripMs)) } };
    phases.push(phase); console.log(JSON.stringify({ phase: name, ...phase.summary }));
  }
  await measure('idle-visible', false);
  await measure('idle-minimized', true);
  await instance.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.restore(); window.show(); });
  await main.getByRole('button', { name: 'Background measurement', exact: true }).click();
  await guest.getByRole('button', { name: 'Background measurement', exact: true }).click();
  await main.getByRole('button', { name: 'Lounge', exact: true }).click();
  await guest.getByRole('button', { name: 'Lounge', exact: true }).click();
  await main.waitForFunction(() => window.__measureConnections.some(connection => connection.connectionState === 'connected'));
  await measure('voice-visible', false);
  await measure('voice-minimized', true);
  await instance.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.restore(); window.show(); });
  await main.getByRole('button', { name: 'Voice & video settings', exact: true }).click();
  await main.getByRole('button', { name: 'voice & video', exact: true }).click();
  await main.getByRole('combobox', { name: 'Noise suppression mode', exact: true }).selectOption('enhanced');
  await main.getByRole('status').filter({ hasText: 'Outgoing microphone:' }).filter({ hasText: 'RNNoise active' }).waitFor();
  await main.evaluate(() => document.querySelector('dialog[open] button[aria-label="Close dialog"]')?.click());
  await measure('rnnoise-visible', false);
  await measure('rnnoise-minimized', true);
  await instance.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.restore(); window.show(); });
  await main.locator('.voice-connected').getByRole('button', { name: 'Share screen', exact: true }).click();
  await main.locator('.voice-connected').getByRole('button', { name: 'Stop sharing', exact: true }).waitFor();
  await measure('sharing-visible', false);
  await measure('sharing-minimized', true);
  const supportsGaming = await main.evaluate(() => Boolean(window.haven?.updateDesktopSettings));
  if (supportsGaming) {
    await main.evaluate(() => window.haven.updateDesktopSettings({ gamingMode: true }));
    await measure('gaming-sharing-minimized', true);
    await main.evaluate(() => window.haven.updateDesktopSettings({ gamingMode: false }));
    await measure('restored-sharing-minimized', true);
  }
  assert.ok(phases.find(phase => phase.name === 'voice-minimized').summary.audioReceivedKbps > 0, 'Voice must continue while minimized');
  const result = { label, executablePath: executablePath || 'source Electron', version: await instance.evaluate(({ app }) => app.getVersion()), measuredAt: new Date().toISOString(), profile, machine: { cpu: cpus()[0]?.model, logicalCores: cpus().length, ramGB: totalmem() / 1024 ** 3 }, boundaries: ['Disposable profile; synthetic microphones; one Electron sender and real headless Chrome receiver on the same Windows computer', 'Short sequential loopback samples, not gaming or internet ping benchmarks', 'Electron process tree metrics exclude embedded Node backend, keyboard helper, Chrome, driver and OS memory/CPU', 'RTP payload bytes exclude IP/UDP/SRTP/RTCP overhead; sampled loss/jitter and candidate RTT are localhost only', 'No game launched, no external probe traffic, no network saturation or GPU stress', 'Temporary measurement profile retained to avoid recursive cleanup during user work'], phases };
  await mkdir(path.join(root, 'measurements'), { recursive: true });
  await writeFile(path.join(root, 'measurements', `background-${label}.json`), JSON.stringify(result, null, 2));
} finally {
  await browser?.close();
  await instance?.close().catch(() => {});
  fixtureBackend?.kill();
  await fixtureFrontend?.close();
}
