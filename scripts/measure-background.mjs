import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir, cpus, totalmem } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, chromium } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const label = process.argv[2] || 'current';
const executablePath = process.argv[3] ? path.resolve(process.argv[3]) : undefined;
if (!/^[a-z0-9-]+$/i.test(label)) throw new Error('Use a simple measurement label');
const profile = await mkdtemp(path.join(tmpdir(), 'haven-measure-'));
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
let instance;
let browser;
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
    const before = performance.now(); await fetch('/api/health', { cache: 'no-store' });
    return { time: performance.now(), sent, received, packetsLost, packetsReceived, jitterMs, roundTripMs, httpRoundTripMs: performance.now() - before };
  });
}
const mean = values => values.reduce((total, value) => total + value, 0) / Math.max(1, values.length);
const percentile = (values, fraction) => [...values].sort((first, second) => first - second)[Math.min(values.length - 1, Math.floor(values.length * fraction))] ?? null;
try {
  instance = await electron.launch({ ...(executablePath ? { executablePath } : {}), args: [...(executablePath ? [] : [root]), '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'], env: { ...process.env, HAVEN_PROFILE_DIR: profile } });
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
    for (let sample = 0; sample < 7; sample++) {
      await wait(1500);
      const processes = await instance.evaluate(({ app }) => app.getAppMetrics().map(metric => ({ pid: metric.pid, type: metric.type, cpu: metric.cpu.percentCPUUsage, workingSetKB: metric.memory.workingSetSize, privateKB: metric.memory.privateBytes })));
      samples.push({ processes, media: await mediaSample(main) });
    }
    const first = samples[0].media; const last = samples.at(-1).media; const seconds = (last.time - first.time) / 1000;
    const phase = { name, minimized, samples, summary: { electronCpuMetricSumMean: mean(samples.map(sample => sample.processes.reduce((sum, process) => sum + process.cpu, 0))), electronWorkingSetMBMean: mean(samples.map(sample => sample.processes.reduce((sum, process) => sum + process.workingSetKB, 0) / 1024)), audioSentKbps: Math.max(0, last.sent - first.sent) * 8 / seconds / 1000, audioReceivedKbps: Math.max(0, last.received - first.received) * 8 / seconds / 1000, packetsLostDelta: last.packetsLost - first.packetsLost, packetsReceivedDelta: last.packetsReceived - first.packetsReceived, httpRTTMedianMs: percentile(samples.map(sample => sample.media.httpRoundTripMs), .5), httpRTTP95Ms: percentile(samples.map(sample => sample.media.httpRoundTripMs), .95), jitterMsMean: mean(samples.flatMap(sample => sample.media.jitterMs)), candidateRoundTripMsMean: mean(samples.flatMap(sample => sample.media.roundTripMs)) } };
    phases.push(phase); console.log(JSON.stringify({ phase: name, ...phase.summary }));
  }
  await measure('idle-visible', false);
  await main.getByRole('button', { name: 'Background measurement', exact: true }).click();
  await guest.getByRole('button', { name: 'Background measurement', exact: true }).click();
  await main.getByRole('button', { name: 'Lounge', exact: true }).click();
  await guest.getByRole('button', { name: 'Lounge', exact: true }).click();
  await main.waitForFunction(() => window.__measureConnections.some(connection => connection.connectionState === 'connected'));
  await measure('voice-visible', false);
  await measure('voice-minimized', true);
  const supportsGaming = await main.evaluate(() => Boolean(window.haven?.updateDesktopSettings));
  if (supportsGaming) {
    await main.evaluate(async () => { const values = JSON.parse(localStorage.getItem('haven.media.settings') || '{}'); localStorage.setItem('haven.media.settings', JSON.stringify({ ...values, gamingMode: true })); await window.haven.updateDesktopSettings({ gamingMode: true }); });
    await main.reload();
    await main.getByRole('button', { name: 'Background measurement', exact: true }).click();
    await main.getByRole('button', { name: 'Lounge', exact: true }).click();
    await main.waitForFunction(() => window.__measureConnections.some(connection => connection.connectionState === 'connected'));
    await measure('gaming-voice-minimized', true);
  }
  assert.ok(phases.find(phase => phase.name === 'voice-minimized').summary.audioReceivedKbps > 0, 'Voice must continue while minimized');
  const result = { label, executablePath: executablePath || 'source Electron', version: await instance.evaluate(({ app }) => app.getVersion()), measuredAt: new Date().toISOString(), profile, machine: { cpu: cpus()[0]?.model, logicalCores: cpus().length, ramGB: totalmem() / 1024 ** 3 }, boundaries: ['Disposable profile; synthetic microphones; one Electron sender and real headless Chrome receiver on the same Windows computer', 'Short sequential loopback samples, not gaming or internet ping benchmarks', 'Electron process tree metrics exclude embedded Node backend, keyboard helper, Chrome, driver and OS memory/CPU', 'RTP payload bytes exclude IP/UDP/SRTP/RTCP overhead; sampled loss/jitter and candidate RTT are localhost only', 'No game launched, no external probe traffic, no network saturation or GPU stress', 'Temporary measurement profile retained to avoid recursive cleanup during user work'], phases };
  await mkdir(path.join(root, 'measurements'), { recursive: true });
  await writeFile(path.join(root, 'measurements', `background-${label}.json`), JSON.stringify(result, null, 2));
} finally {
  await browser?.close();
  await instance?.close().catch(() => {});
}
