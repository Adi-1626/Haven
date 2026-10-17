// Isolated real useMedia/WebRTC integration. No Haven account, auth or cloud backend.
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { Server } from 'socket.io';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../apps/web/', import.meta.url));
const output = fileURLToPath(new URL('../test-results/gaming-runtime.json', import.meta.url));
const checks = [];
const measurements = {};
const errors = [];
const blockedExternalRequests = [];
const harness = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {io} from 'socket.io-client';
import {useMedia} from '/src/media.ts';
import {readConnectionStatistics} from '/src/connection-stats.ts';
const client = new URLSearchParams(location.search).get('client');
window.__HAVEN_CONFIG__={apiUrl:location.origin};
const socket = io({transports:['websocket'],auth:{client}});
window.probeErrors=[]; window.probeSocket=socket; window.probeCaptures=[]; window.probeDisplays=[];
const getUserMedia=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
navigator.mediaDevices.getUserMedia=async constraints=>{const stream=await getUserMedia(constraints);window.probeCaptures.push(stream);return stream;};
navigator.mediaDevices.getDisplayMedia=async()=>{
  const canvas=document.createElement('canvas'); canvas.width=1920;canvas.height=1080;
  const context=canvas.getContext('2d');context.fillStyle='#315078';context.fillRect(0,0,1920,1080);
  let frame=0;const timer=setInterval(()=>{context.fillStyle=frame++%2?'#112244':'#aaccee';context.fillRect((frame*11)%1800,100,100,100);},1000/60);
  const stream=canvas.captureStream(60);const track=stream.getVideoTracks()[0];const stop=track.stop.bind(track);
  track.stop=()=>{clearInterval(timer);stop();};window.probeDisplays.push(stream);return stream;
};
const report=message=>window.probeErrors.push(message);
function Probe(){const media=useMedia(socket,client,report);window.media=media;return React.createElement('main',null,React.createElement('button',{id:'gesture'},'Media probe '+client),React.createElement('pre',null,JSON.stringify({status:media.connectionStatus,background:media.background,settings:media.settings,processing:media.microphoneProcessing})));}
createRoot(document.getElementById('probe')).render(React.createElement(Probe));
window.probeSample=async()=>{
  const samples=[];
  window.probeHistories??=new Map();
  for(const source of window.media.connectionStatsSources()){
    const report=await source.connection.getStats();let history=window.probeHistories.get(source.connection);if(!history){history=new Map();window.probeHistories.set(source.connection,history);}
    const stats=Array.from(report.values());const audio=stats.filter(s=>s.type==='outbound-rtp'&&s.kind==='audio');const video=stats.filter(s=>s.type==='outbound-rtp'&&s.kind==='video');const inbound=stats.filter(s=>s.type==='inbound-rtp'&&s.kind==='audio');
    samples.push({peer:source.socketId,quality:readConnectionStatistics(source,report,history),audioBytes:audio.reduce((n,s)=>n+s.bytesSent,0),videoBytes:video.reduce((n,s)=>n+s.bytesSent,0),audioPackets:audio.reduce((n,s)=>n+s.packetsSent,0),concealedSamples:inbound.reduce((n,s)=>n+(s.concealedSamples||0),0),concealmentEvents:inbound.reduce((n,s)=>n+(s.concealmentEvents||0),0),receivedAudioPackets:inbound.reduce((n,s)=>n+(s.packetsReceived||0),0),lostAudioPackets:inbound.reduce((n,s)=>n+(s.packetsLost||0),0)});
  }
  return {at:performance.now(),samples,background:window.media.background,processing:window.media.microphoneProcessing,quality:window.media.quality,captures:window.probeCaptures.length};
};
`;
const vite = await createServer({
  root, configFile: false, esbuild: { jsx: 'automatic' }, server: { host: '127.0.0.1', port: 0 },
  plugins: [{
    name: 'isolated-gaming-runtime-probe',
    resolveId(id) { if (id === 'virtual:gaming-probe') return '\0virtual:gaming-probe'; },
    load(id) { if (id === '\0virtual:gaming-probe') return harness; },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url?.startsWith('/api/rtc')) { response.setHeader('Content-Type', 'application/json'); response.end('{"iceServers":[]}'); }
        else if (request.url?.startsWith('/gaming-probe')) { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><html><body><div id="probe"></div><script type="module" src="/@id/virtual:gaming-probe"></script></body></html>'); }
        else next();
      });
    },
  }],
});
const relay = new Server(vite.httpServer);
const members = new Map();
relay.on('connection', socket => {
  const user = { id: String(socket.handshake.auth.client), displayName: String(socket.handshake.auth.client) };
  const leave = () => { if (!members.delete(socket.id)) return; socket.broadcast.emit('voice:peer-left', { socketId: socket.id }); };
  socket.on('voice:join', (_request, acknowledge) => {
    const peers = [...members.values()];
    members.set(socket.id, { socketId: socket.id, user, muted: false, deafened: false, sharing: false });
    acknowledge({ peers }); socket.broadcast.emit('voice:peer-joined', members.get(socket.id));
  });
  socket.on('voice:leave', leave); socket.on('disconnect', leave);
  socket.on('voice:signal', ({ target, ...signal }) => { if (members.has(socket.id) && members.has(target)) relay.to(target).emit('voice:signal', { from: socket.id, ...signal }); });
  socket.on('voice:state', state => { if (members.has(socket.id)) { Object.assign(members.get(socket.id), state); socket.broadcast.emit('voice:state', { ...state, socketId: socket.id }); } });
  socket.on('voice:activity', state => { if (members.has(socket.id)) socket.broadcast.emit('voice:activity', { ...state, socketId: socket.id }); });
});
let browser;
const contexts = [];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const connected = page => page.waitForFunction(() => window.media?.connectionStatus === 'connected' && window.media.connectionStatsSources().length === 1 && window.media.connectionStatsSources()[0].connection.connectionState === 'connected', { timeout: 30_000 });
const snapshot = page => page.evaluate(() => window.probeSample());
async function quality(page, height, fps, bitrate) {
  await page.waitForFunction(({ height, fps, bitrate }) => {
    const media = window.media; const q = media.quality;
    const sender = media.connectionStatsSources()[0]?.connection.getSenders().find(value => value.track?.kind === 'video');
    const encoding = sender?.getParameters().encodings[0];
    return q.height === height && q.fps === fps && q.bitrateMbps === bitrate && encoding?.maxBitrate === bitrate * 1_000_000 && encoding?.maxFramerate === fps;
  }, { height, fps, bitrate }, { timeout: 15_000 });
}
async function continuity(page, label, operation = () => wait(1800)) {
  const before = await snapshot(page); await operation(); const after = await snapshot(page);
  assert.ok(after.samples[0].audioBytes > before.samples[0].audioBytes, `${label}: audio RTP must advance`);
  const elapsedSeconds = (after.at - before.at) / 1000;
  measurements[label] = { before, after, elapsedSeconds, audioKbps: (after.samples[0].audioBytes - before.samples[0].audioBytes) * 8 / elapsedSeconds / 1000, videoMbps: (after.samples[0].videoBytes - before.samples[0].videoBytes) * 8 / elapsedSeconds / 1_000_000, concealedSamplesDelta: after.samples[0].concealedSamples - before.samples[0].concealedSamples, concealmentEventsDelta: after.samples[0].concealmentEvents - before.samples[0].concealmentEvents };
}
try {
  await vite.listen();
  const port = vite.httpServer.address().port;
  const origin = `http://127.0.0.1:${port}`;
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const pages = [];
  for (const client of ['Alpha', 'Beta']) {
    const context = await browser.newContext({ permissions: ['microphone'], viewport: { width: 900, height: 700 } }); contexts.push(context);
    await context.route('**/*', route => { const url = new URL(route.request().url()); if (url.hostname === '127.0.0.1') return route.continue(); blockedExternalRequests.push(url.origin); return route.abort(); });
    const page = await context.newPage(); page.on('pageerror', error => errors.push(`${client}: ${error.message}`));
    await page.goto(`${origin}/gaming-probe?client=${client}`);
    await page.waitForFunction(() => window.media && window.probeSocket.connected);
    await page.locator('#gesture').click();
    await page.evaluate(() => window.media.setSettings({ inputSensitivity: -60, voiceBitrateKbps: 64, shareHeight: 1080, shareFps: 60, shareBitrateMbps: 12, noiseSuppression: false }));
    await page.waitForFunction(() => window.media.settings.voiceBitrateKbps === 64);
    await page.evaluate(() => window.media.join('isolated-room')); pages.push(page);
  }
  const [alpha, beta] = pages;
  await Promise.all(pages.map(connected));
  checks.push('two actual useMedia hooks exchange audio over browser WebRTC via isolated local Socket.IO signaling');
  await continuity(alpha, 'voiceNormal');
  await alpha.evaluate(() => window.media.startShare());
  await quality(alpha, 1080, 60, 12);
  await alpha.evaluate(() => {
    const pc = window.media.connectionStatsSources()[0].connection;
    window.originalRuntime = { pc, senders: pc.getSenders(), screen: window.media.screenStream, captureCount: window.probeCaptures.length };
  });
  await continuity(alpha, 'voiceAndSyntheticScreen');
  for (let index = 0; index < 3; index++) {
    await alpha.evaluate(() => window.media.setSettings({ gamingMode: true })); await quality(alpha, 720, 30, 3);
    const settings = await alpha.evaluate(() => window.media.settings);
    assert.deepEqual([settings.voiceBitrateKbps, settings.shareHeight, settings.shareFps, settings.shareBitrateMbps], [64, 1080, 60, 12]);
    if (!index) await continuity(alpha, 'gamingScreen');
    await alpha.evaluate(() => window.media.setSettings({ gamingMode: false })); await quality(alpha, 1080, 60, 12);
  }
  assert.equal(await alpha.evaluate(() => { const current = window.media.connectionStatsSources()[0].connection; const original = window.originalRuntime; return current === original.pc && current.getSenders().every(sender => original.senders.includes(sender)) && window.media.screenStream === original.screen && window.probeCaptures.length === original.captureCount; }), true);
  checks.push('three Gaming Mode cycles restore active 1080p/60/12 Mbps preferences from 720p/30/3 Mbps caps without replacing capture, peer connection or RTP senders');
  await alpha.evaluate(async () => { window.media.setSettings({ gamingMode: true }); await window.media.setShareQuality(900, 60, 6); }); await quality(alpha, 720, 30, 3);
  await alpha.evaluate(() => window.media.setSettings({ gamingMode: false })); await quality(alpha, 900, 60, 6);
  checks.push('explicit share preference edits during Gaming Mode become the restored normal settings');
  await alpha.bringToFront();
  await alpha.evaluate(() => window.media.setSettings({ pushToTalk: true }));
  await alpha.waitForFunction(() => !window.media.localStream.getAudioTracks()[0].enabled);
  await alpha.keyboard.down('Control'); await alpha.keyboard.down('Shift'); await alpha.keyboard.down('Space');
  await alpha.waitForFunction(() => window.media.localStream.getAudioTracks()[0].enabled);
  await alpha.keyboard.up('Space'); await alpha.keyboard.up('Shift'); await alpha.keyboard.up('Control');
  await alpha.waitForFunction(() => !window.media.localStream.getAudioTracks()[0].enabled);
  await alpha.evaluate(() => window.media.setSettings({ pushToTalk: false }));
  await alpha.waitForFunction(() => window.media.localStream.getAudioTracks()[0].enabled);
  checks.push('browser PTT press, release and restored open microphone operate on the real capture/output pipeline');
  await alpha.evaluate(() => { window.oldMic = window.media.localStream; window.media.setSettings({ inputDevice: 'default' }); });
  await alpha.waitForFunction(() => window.media.localStream !== window.oldMic && window.oldMic.getTracks().every(track => track.readyState === 'ended'));
  assert.equal(await alpha.evaluate(() => { const pc = window.media.connectionStatsSources()[0].connection; return pc === window.originalRuntime.pc && pc.getSenders().every(sender => window.originalRuntime.senders.includes(sender)); }), true);
  checks.push('default-device reselection reacquires capture while preserving the peer connection');
  await alpha.evaluate(() => window.media.setSettings({ noiseSuppression: true, noiseSuppressionMode: 'enhanced' }));
  await alpha.waitForFunction(() => window.media.microphoneProcessing === 'rnnoise', null, { timeout: 15_000 });
  await continuity(alpha, 'voiceRnnoise');
  // Synthetic focus event tests hook policy only; this is not an OS tray test.
  await alpha.evaluate(() => { window.originalHasFocus = document.hasFocus.bind(document); document.hasFocus = () => false; window.dispatchEvent(new Event('blur')); });
  await alpha.waitForFunction(() => window.media.background);
  await continuity(alpha, 'backgroundVoiceAndScreen');
  assert.equal(await alpha.evaluate(() => window.media.microphoneProcessing), 'rnnoise');
  await alpha.evaluate(() => { document.hasFocus = window.originalHasFocus; window.dispatchEvent(new Event('focus')); });
  await alpha.bringToFront();
  await alpha.waitForFunction(() => !window.media.background);
  await alpha.evaluate(() => window.media.setSettings({ noiseSuppression: false }));
  await alpha.waitForFunction(() => window.media.microphoneProcessing === 'off');
  checks.push('actual RNNoise WASM processes live foreground/background voice and releases processing when disabled');
  await continuity(alpha, 'rendererPressure', () => alpha.evaluate(async () => {
    const started = performance.now(); let blocks = 0;
    while (performance.now() - started < 2200) { const until = performance.now() + 80; while (performance.now() < until) Math.sqrt(Math.random()); blocks++; await new Promise(resolve => setTimeout(resolve, 20)); }
    window.pressureBlocks = blocks;
  }));
  measurements.rendererPressure.blocks = await alpha.evaluate(() => window.pressureBlocks);
  checks.push('real RTP audio advances during synthetic background focus and repeated 80 ms renderer stalls');
  // Inject counters, never alter packets or claim a real network-loss experiment.
  await alpha.evaluate(() => {
    const pc = window.media.connectionStatsSources()[0].connection;
    window.realGetStats = pc.getStats.bind(pc); window.simulatedLoss = .12; let measurement = 100;
    pc.getStats = async () => { const real = await window.realGetStats(); const report = new Map(real); report.set('injected-audio-feedback', { id: 'injected-audio-feedback', type: 'remote-inbound-rtp', kind: 'audio', fractionLost: window.simulatedLoss, roundTripTime: .02, roundTripTimeMeasurements: measurement++, timestamp: performance.now() }); return report; };
    window.media.setVideoDetailsOpen(true);
  });
  await alpha.waitForFunction(() => { const senders = window.media.connectionStatsSources()[0].connection.getSenders(); return senders.find(sender => sender.track?.kind === 'video').getParameters().encodings[0].maxBitrate === 1_000_000 && senders.find(sender => sender.track?.kind === 'audio').getParameters().encodings[0].maxBitrate === 64_000; }, null, { timeout: 10_000 });
  measurements.simulatedVideoFirst = await alpha.evaluate(() => window.media.connectionStatsSources()[0].connection.getSenders().map(sender => ({ kind: sender.track?.kind, encodings: sender.getParameters().encodings })));
  await alpha.waitForFunction(() => { const senders = window.media.connectionStatsSources()[0].connection.getSenders(); return senders.find(sender => sender.track?.kind === 'video').getParameters().encodings[0].maxBitrate === 1_000_000 && senders.find(sender => sender.track?.kind === 'audio').getParameters().encodings[0].maxBitrate === 32_000; }, null, { timeout: 20_000 });
  measurements.simulatedCongestion = await alpha.evaluate(() => window.media.connectionStatsSources()[0].connection.getSenders().map(sender => ({ kind: sender.track?.kind, encodings: sender.getParameters().encodings })));
  await alpha.evaluate(() => { window.simulatedLoss = 0; });
  await alpha.waitForFunction(() => { const senders = window.media.connectionStatsSources()[0].connection.getSenders(); return senders.find(sender => sender.track?.kind === 'video').getParameters().encodings[0].maxBitrate === 6_000_000 && senders.find(sender => sender.track?.kind === 'audio').getParameters().encodings[0].maxBitrate === 64_000; }, null, { timeout: 20_000 });
  await alpha.evaluate(() => { window.media.connectionStatsSources()[0].connection.getStats = window.realGetStats; window.media.setVideoDetailsOpen(false); });
  checks.push('SIMULATED statistics feedback exercises video-first congestion caps, sustained audio cap and healthy-sample recovery on real RTP senders; no packets impaired');
  await alpha.evaluate(() => window.probeSocket.disconnect());
  await alpha.waitForFunction(() => window.media.connectionStatus === 'reconnecting');
  await alpha.evaluate(() => window.probeSocket.connect());
  await Promise.all(pages.map(connected));
  await continuity(alpha, 'signalingReconnect');
  checks.push('Socket.IO disconnect/reconnect rejoins the room and resumes real peer audio');
  await alpha.evaluate(() => { window.media.leave(); window.media.setSettings({ gamingMode: true, voiceBitrateKbps: 56 }); });
  await alpha.waitForFunction(() => { const saved = JSON.parse(localStorage.getItem('haven.media.settings')); return saved.gamingMode && saved.voiceBitrateKbps === 56 && saved.shareHeight === 900 && saved.shareFps === 60 && saved.shareBitrateMbps === 6; });
  await alpha.reload(); await alpha.waitForFunction(() => window.media?.settings.gamingMode);
  assert.deepEqual(await alpha.evaluate(() => { const settings = window.media.settings; return [settings.voiceBitrateKbps, settings.shareHeight, settings.shareFps, settings.shareBitrateMbps]; }), [56, 900, 60, 6]);
  await alpha.evaluate(() => window.media.setSettings({ gamingMode: false }));
  await alpha.waitForFunction(() => !window.media.settings.gamingMode);
  checks.push('serialized preferences survive page restart while Gaming Mode is enabled and remain available after disabling it');
  for (const page of pages) errors.push(...await page.evaluate(() => window.probeErrors));
  assert.deepEqual(errors, []);
  assert.deepEqual(blockedExternalRequests, [], 'isolated useMedia verification must not attempt external account/backend traffic');
  const summary = { passed: true, runtime: await browser.version(), checks, measurements, limitations: ['Chrome headless and synthetic microphone/canvas capture; not physical devices, natural speech, real game FPS or internet latency', 'background focus is synthetic; real Electron tray/global shortcuts are verified separately', 'congestion counters are injected; no real packet loss or network shaping', 'RTP byte rates exclude transport overhead; maxBitrate is an encoder cap, not promised throughput', 'no claim of whole-system CPU/RAM or mouth-to-ear delay; concealment counters indicate receiver concealment, not proven audible dropouts'] };
  await mkdir(path.dirname(output), { recursive: true }); await writeFile(output, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ passed: true, output, runtime: summary.runtime, checks, measurements: Object.fromEntries(Object.entries(measurements).map(([key, value]) => [key, value.elapsedSeconds ? { audioKbps: value.audioKbps, videoMbps: value.videoMbps, concealedSamplesDelta: value.concealedSamplesDelta, concealmentEventsDelta: value.concealmentEventsDelta } : value])), limitations: summary.limitations }, null, 2));
} catch (error) {
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify({ passed: false, error: error.stack, checks, measurements, errors, blockedExternalRequests }, null, 2));
  throw error;
} finally {
  for (const context of contexts) await context.close().catch(() => {});
  await browser?.close();
  await new Promise(resolve => relay.close(resolve));
  await vite.close();
}
