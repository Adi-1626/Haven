import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const profile = await mkdtemp(path.join(tmpdir(), 'haven-device-check-'));
let instance;
try {
  instance = await electron.launch({ args: [root], env: { ...process.env, HAVEN_PROFILE_DIR: profile } });
  const page = await instance.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  const result = await page.evaluate(async () => {
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs = devices.filter(device => device.kind === 'audioinput');
      const outputs = devices.filter(device => device.kind === 'audiooutput');
      const selected = stream.getAudioTracks().map(track => ({ label: track.label, live: track.readyState === 'live' }));
      const audio = new Audio();
      const output = outputs.find(device => !['default', 'communications'].includes(device.deviceId));
      let outputSelection = 'No selectable output available';
      if (output && typeof audio.setSinkId === 'function') {
        await audio.setSinkId(output.deviceId);
        outputSelection = audio.sinkId === output.deviceId ? 'Non-default output selection accepted' : 'Output selection did not match';
      }
      stream.getTracks().forEach(track => track.stop());
      return { inputs: inputs.map(device => ({ name: device.label, hasId: Boolean(device.deviceId) })), outputs: outputs.map(device => ({ name: device.label, hasId: Boolean(device.deviceId) })), selected, outputSelection, tracksEnded: stream.getTracks().every(track => track.readyState === 'ended') };
    } finally { stream?.getTracks().forEach(track => track.stop()); }
  });
  console.log(JSON.stringify({ observed: result }, null, 2));
  assert.ok(result.inputs.length > 0);
  assert.ok(result.inputs.every(device => device.name && device.hasId));
  assert.equal(result.tracksEnded, true);
  const report = { pass: true, measuredAt: new Date().toISOString(), ...result, limitations: ['Real Windows device enumeration and brief default microphone permission/capture only; no recording saved, transmitted or played', 'Silent output sink selection accepted by Chromium does not prove physical speaker routing', 'No physical plug/unplug, headset switch, acoustic quality or game tested', 'Disposable profile retained; real Haven profile and Windows default audio devices not modified'] };
  await mkdir(path.join(root, 'measurements'), { recursive: true });
  await writeFile(path.join(root, 'measurements', 'windows-audio-devices.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await instance?.close().catch(() => {}); }
