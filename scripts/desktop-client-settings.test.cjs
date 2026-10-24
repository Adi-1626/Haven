const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createClientSettings, validSetting } = require('../apps/desktop/electron/client-settings.cjs');

test('desktop restarts retain denoising and uncapped gaming preferences', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'haven-voice-preferences-'));
  try {
    const settings = { inputDevice: 'microphone-id', outputDevice: 'speaker-id', inputDeviceLabel: 'Selected mic', outputDeviceLabel: 'Selected speaker', inputVolume: 1.4, outputVolume: .65, soundboardVolume: .4, soundboardMuted: true, inputSensitivity: -38, pushToTalk: true, pushToTalkKey: 'Control+Shift+F10', echoCancellation: false, noiseSuppression: true, noiseSuppressionMode: 'enhanced', gamingMode: true, voiceBitrateKbps: 64, shareHeight: 1440, shareFps: 60, shareBitrateMbps: 12 };
    const store = createClientSettings(directory);
    assert.equal(store.status('toString').error, 'Unknown client setting');
    assert.equal(store.status('__proto__').value, null);
    assert.deepEqual(store.write('haven.media.settings', JSON.stringify(settings)), { ok: true });
    store.flush();
    assert.deepEqual(JSON.parse(createClientSettings(directory).read('haven.media.settings')), settings);
    assert.equal(validSetting('haven.media.settings', JSON.stringify({ ...settings, shareHeight: 'native' })), true);
    for (const patch of [{ shareHeight: '720' }, { shareFps: 120 }, { noiseSuppressionMode: 'cloud' }, { voiceBitrateKbps: 100 }, { shareBitrateMbps: 100 }]) {
      assert.equal(validSetting('haven.media.settings', JSON.stringify({ ...settings, ...patch })), false);
    }
    assert.equal(validSetting('haven.media.settings', JSON.stringify({ inputVolume: 1, gamingMode: false })), true);
  } finally {
    // A freshly created test directory; never traverse a user-selected path.
    const target = path.resolve(directory);
    assert.ok(target.startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(target, { recursive: true, force: true });
  }
});


test('rejected and failed writes retain the last durable microphone policy', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'haven-settings-failure-'));
  const file = path.join(directory, 'client-settings.json');
  try {
    const store = createClientSettings(directory);
    const value = JSON.stringify({ pushToTalk: true, outputVolume: .5, noiseSuppressionMode: 'enhanced' });
    assert.deepEqual(store.write('haven.media.settings', value), { ok: true });
    // No flush, timer or graceful shutdown is required for an acknowledged save.
    assert.equal(createClientSettings(directory).read('haven.media.settings'), value);
    for (const patch of [{ outputVolume: 2 }, { soundboardVolume: -1 }, { soundboardVolume: 2 }, { soundboardMuted: 'true' }, { inputVolume: -1 }, { inputSensitivity: 1 }, { outputVolume: '1' }, { pushToTalk: 'true' }, { pushToTalkKey: '' }, { unknown: true }, { noiseSuppressionMode: 'rnnoise' }]) {
      assert.equal(store.write('haven.media.settings', JSON.stringify(patch)).ok, false);
      assert.equal(store.read('haven.media.settings'), value);
    }
    for (const invalid of ['null', '[]', '{', '{"outputVolume":1e999}', '"text"']) assert.equal(validSetting('haven.media.settings', invalid), false);
    fs.mkdirSync(`${file}.tmp`);
    const failed = store.write('haven.media.settings', JSON.stringify({ pushToTalk: false }));
    assert.equal(failed.ok, false);
    assert.match(failed.error, /could not be saved/);
    assert.equal(store.read('haven.media.settings'), value);
    assert.equal(createClientSettings(directory).read('haven.media.settings'), value);
    assert.match(createClientSettings(directory).status('haven.media.settings').error, /previous audio settings save failed/);
    fs.unlinkSync(path.join(directory, 'audio-settings-save-failed'));
    fs.writeFileSync(file, '{broken');
    assert.match(createClientSettings(directory).status('haven.media.settings').error, /could not be read/);
    fs.writeFileSync(file, JSON.stringify({ 'haven.media.settings': JSON.stringify({ pushToTalk: 'yes' }) }));
    assert.match(createClientSettings(directory).status('haven.media.settings').error, /invalid/);
  } finally {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
