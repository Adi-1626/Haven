// Isolated browser verification: no Haven account, backend, or physical microphone.
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium, _electron as electron } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { readFile, writeFile, mkdtemp, unlink } from 'node:fs/promises';
import vm from 'node:vm';
import { tmpdir } from 'node:os';
import path from 'node:path';

async function benchmarkDenoiser() {
  const code = await readFile(new URL('../apps/web/vendor/rnnoise/workletProcessor.js', import.meta.url), 'utf8');
  const wasm = await readFile(new URL('../apps/web/vendor/rnnoise/rnnoise.wasm', import.meta.url));
  let Processor, ready;
  const initialized = new Promise(resolve => { ready = resolve; });
  vm.runInNewContext(code.replaceAll('import.meta.url', '"https://localhost/workletProcessor.js"'), {
    WebAssembly, console, TextDecoder, TextEncoder,
    AudioWorkletProcessor: class { port = { addEventListener() {}, start() {}, postMessage(message) { if (message.type === 'ready') ready(); } }; },
    registerProcessor(_id, constructor) { Processor = constructor; },
  });
  const processor = new Processor({ processorOptions: { wasmBinary: wasm, maxChannels: 1 } });
  await initialized;
  const input = [[new Float32Array(128).fill(.01)]];
  const output = [[new Float32Array(128)]];
  try {
    for (let index = 0; index < 500; index++) processor.process(input, output);
    const cpu = process.cpuUsage();
    const started = performance.now();
    for (let index = 0; index < 10000; index++) processor.process(input, output);
    const elapsedMs = performance.now() - started;
    const used = process.cpuUsage(cpu);
    const cpuMs = (used.user + used.system) / 1000;
    const audioMs = 10000 * 128 / 48000 * 1000;
    return { audioMs, elapsedMs, cpuMs, oneCoreRealtimePercent: cpuMs / audioMs * 100, limitation: 'Offline Node VM throughput with synthetic samples; excludes capture, AEC, browser scheduling and gaming. Not an FPS benchmark.' };
  } finally { processor.destroy(); }
}

const root = fileURLToPath(new URL('../apps/web/', import.meta.url));
const server = await createServer({
  root, configFile: false, esbuild: { jsx: 'automatic' }, server: { host: '127.0.0.1', port: 0 },
  plugins: [{
    name: 'voice-verification',
    resolveId(id) { if (id === 'virtual:voice-probe') return '\0virtual:voice-probe'; },
    load(id) {
      if (id !== '\0virtual:voice-probe') return;
      return `import React from 'react'; import {createRoot} from 'react-dom/client';
        import Diagnostics from '/src/ConnectionDiagnostics.tsx';
        export function mount() {
          const report = new Map([['transport',{id:'transport',type:'transport',selectedCandidatePairId:'pair'}],['pair',{id:'pair',type:'candidate-pair',currentRoundTripTime:.042}]]);
          const connection = {connectionState:'connected',getStats:async()=>report};
          const sources = () => [{socketId:'test',name:'Synthetic peer',connection}];
          createRoot(document.getElementById('probe')).render(React.createElement(Diagnostics,{status:'connected',sources}));
        }`;
    },
    configureServer(instance) {
      instance.middlewares.use('/voice-probe', (_request, response) => {
        response.setHeader('Content-Type', 'text/html');
        response.end('<html><body style="background:#171a24;color:white"><div id="probe" style="position:fixed;bottom:30px;left:20px"></div></body></html>');
      });
    },
  }],
});
let browser;
let desktop;
let desktopMain;
try {
  const offlinePerformance = await benchmarkDenoiser();
  await server.listen();
  const address = server.httpServer.address();
  const mediaFlags = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'];
  let page;
  if (process.argv.includes('--electron')) {
    const profile = await mkdtemp(path.join(tmpdir(), 'haven-voice-worklet-'));
    desktopMain = path.join(profile, 'probe.cjs');
    await writeFile(desktopMain, `const {app,BrowserWindow}=require('electron');
      app.setPath('userData',${JSON.stringify(profile)});
      app.whenReady().then(()=>{const window=new BrowserWindow({show:false,width:900,height:700,webPreferences:{backgroundThrottling:false}});window.loadURL('http://127.0.0.1:${address.port}/voice-probe');});`);
    desktop = await electron.launch({ args: [desktopMain, ...mediaFlags] });
    page = await desktop.firstWindow();
  } else {
    browser = await chromium.launch({ channel: 'chrome', headless: true, args: mediaFlags });
    page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  }
  const pageErrors = [];
  page.on('pageerror', error => { pageErrors.push(error.message); console.error(error.message); });
  await page.goto(`http://127.0.0.1:${address.port}/voice-probe`);
  const result = await page.evaluate(async () => {
    const { createNoiseSuppressor } = await import('/src/noise-suppression.ts');
    const { createMicrophonePipeline, microphoneCaptureConstraints } = await import('/src/audio-pipeline.ts');
    const context = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
    await context.resume();
    const started = performance.now();
    const denoiser = await createNoiseSuppressor(context);
    const startupMs = performance.now() - started;
    // Seeded steady fan-like noise checks real WASM processing, not speech quality.
    const buffer = context.createBuffer(1, 48000, 48000);
    const data = buffer.getChannelData(0);
    let seed = 37;
    for (let index = 0; index < data.length; index++) { seed = (1664525 * seed + 1013904223) >>> 0; data[index] = (seed / 4294967296 - .5) * .02 + .04 * Math.sin(2 * Math.PI * 120 * index / 48000); }
    const source = context.createBufferSource(); source.buffer = buffer; source.loop = true;
    const analyser = context.createAnalyser(); analyser.fftSize = 2048;
    const silence = context.createGain(); silence.gain.value = 0;
    source.connect(denoiser.node).connect(analyser).connect(silence).connect(context.destination);
    source.start();
    await new Promise(resolve => setTimeout(resolve, 3000));
    let inputEnergy = 0, outputEnergy = 0;
    const samples = new Float32Array(2048);
    for (let frame = 0; frame < 20; frame++) {
      analyser.getFloatTimeDomainData(samples);
      outputEnergy += samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    inputEnergy = data.reduce((sum, sample) => sum + sample * sample, 0) / data.length;
    const noiseReductionDb = 10 * Math.log10(inputEnergy / (outputEnergy / 20));
    source.stop(); source.disconnect(); denoiser.stop(); denoiser.stop();
    analyser.disconnect(); silence.disconnect();
    const destination = context.createMediaStreamDestination();
    const captures = [];
    const modes = [];
    for (const mode of ['standard', 'enhanced', 'off']) {
      const options = { inputDevice: '', noiseSuppression: mode !== 'off', echoCancellation: true, noiseSuppressionMode: mode === 'enhanced' ? 'enhanced' : 'standard', inputVolume: 1, inputSensitivity: -60, pushToTalk: true };
      const capture = await navigator.mediaDevices.getUserMedia({ audio: microphoneCaptureConstraints(options) });
      captures.push(capture);
      let enabled = true;
      const statuses = [];
      const pipeline = createMicrophonePipeline(context, capture, destination, () => options, () => enabled, () => {}, status => statuses.push(status));
      for (let attempt = 0; attempt < 100 && statuses.at(-1) === 'starting'; attempt++) await new Promise(resolve => setTimeout(resolve, 20));
      modes.push({ mode, status: statuses.at(-1), capture: capture.getAudioTracks()[0].getSettings() });
      enabled = false; pipeline.refresh();
      pipeline.stop(); pipeline.stop(); capture.getTracks().forEach(track => track.stop());
    }
    const allCapturesEnded = captures.every(stream => stream.getTracks().every(track => track.readyState === 'ended'));
    destination.stream.getTracks().forEach(track => track.stop());
    const baseLatencyMs = context.baseLatency * 1000;
    await context.close();
    return { startupMs, noiseReductionDb, baseLatencyMs, modes, allCapturesEnded, contextState: context.state };
  });
  assert.ok(result.noiseReductionDb > 3, `Expected actual noise reduction, got ${result.noiseReductionDb} dB`);
  assert.equal(result.modes[1].status, 'rnnoise');
  assert.equal(result.modes[2].status, 'off');
  assert.ok(result.allCapturesEnded);
  assert.equal(result.contextState, 'closed');
  await page.evaluate(async () => { const probe = await import('/@id/virtual:voice-probe'); probe.mount(); });
  const trigger = page.getByRole('button', { name: /Voice connection/ });
  await trigger.hover();
  await page.getByRole('tooltip').waitFor();
  await page.getByText('42 ms', { exact: true }).first().waitFor();
  assert.ok(await page.getByRole('tooltip').getByText('Synthetic peer').isVisible());
  await page.keyboard.press('Escape');
  await page.getByRole('tooltip').waitFor({ state: 'hidden' });
  await trigger.focus();
  await page.getByRole('tooltip').waitFor();
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 360, height: 640 });
  await page.mouse.move(300, 100);
  await trigger.hover();
  await page.getByRole('tooltip').waitFor();
  const bounds = await page.getByRole('tooltip').boundingBox();
  assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 360, 'Popover must fit narrow viewport');
  assert.deepEqual(pageErrors, [], 'Runtime errors must not be hidden by successful UI assertions');
  const runtime = desktop ? await desktop.evaluate(() => process.versions) : { chrome: await browser.version() };
  console.log(JSON.stringify({ runtime, offlinePerformance, syntheticBrowserVerification: result, tooltip: 'hover, focus, Escape and narrow viewport passed', limitations: 'Synthetic input only; no natural speech quality, physical mic, internet or gaming benchmark. baseLatency excludes RNNoise buffering and total mouth-to-ear latency.' }, null, 2));
} finally { await desktop?.close(); await browser?.close(); await server.close(); if (desktopMain) await unlink(desktopMain); }
