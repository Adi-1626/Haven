const fs = require('node:fs');
const path = require('node:path');
const schemas = {
  'haven.media.settings': { inputDevice: 'string', outputDevice: 'string', inputDeviceLabel: 'string', outputDeviceLabel: 'string', pushToTalkKey: 'string', noiseSuppression: 'boolean', noiseSuppressionMode: 'string', echoCancellation: 'boolean', pushToTalk: 'boolean', gamingMode: 'boolean', inputVolume: 'number', outputVolume: 'number', soundboardVolume: 'number', soundboardMuted: 'boolean', inputSensitivity: 'number', voiceBitrateKbps: 'number', shareHeight: ['string', 'number'], shareFps: 'number', shareBitrateMbps: 'number' },
  'haven.voice.state': { muted: 'boolean', deafened: 'boolean' },
  'haven.preferences': { animateEmoji: 'boolean', notifications: 'boolean', voiceCues: 'boolean' }
};
function validSetting(key, value) {
  if (!Object.hasOwn(schemas, key) || typeof value !== 'string' || value.length > 4096) return false;
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
    if (!Object.entries(parsed).every(([name, item]) => Object.hasOwn(schemas[key], name) && [schemas[key][name]].flat().includes(typeof item) && (typeof item !== 'string' || item.length <= 512) && (typeof item !== 'number' || Number.isFinite(item)))) return false;
    if (key === 'haven.media.settings') {
      for (const [name, min, max] of [['inputVolume', 0, 2], ['outputVolume', 0, 1], ['soundboardVolume', 0, 1], ['inputSensitivity', -60, -10]]) {
        if (name in parsed && !(parsed[name] >= min && parsed[name] <= max)) return false;
      }
      if ('pushToTalkKey' in parsed && !/^(?:(?:Control|Alt|Shift)\+)*(?:[A-Z0-9]|F(?:[1-9]|1[0-9]|2[0-4])|Space|Enter|Tab|Escape|Backspace|Insert|Delete|Home|End|PageUp|PageDown|(?:Arrow)?(?:Up|Down|Left|Right))$/.test(parsed.pushToTalkKey)) return false;
      if ('pushToTalkKey' in parsed && (new Set(parsed.pushToTalkKey.split('+')).size !== parsed.pushToTalkKey.split('+').length || ['Control+K', 'Control+L', 'Control+R', 'Control+W', 'Control+T', 'Control+N', 'Control+Shift+N', 'Control+Tab', 'Control+Shift+Tab', 'Control+Escape', 'Control+Alt+Delete', 'Alt+Tab', 'Alt+F4'].includes(parsed.pushToTalkKey))) return false;
      if ('noiseSuppressionMode' in parsed && !['standard', 'enhanced'].includes(parsed.noiseSuppressionMode)) return false;
      if ('shareHeight' in parsed && parsed.shareHeight !== 'native' && !(Number.isInteger(parsed.shareHeight) && parsed.shareHeight > 0 && parsed.shareHeight <= 8640)) return false;
      if ('shareFps' in parsed && ![15, 30, 60].includes(parsed.shareFps)) return false;
      if ('voiceBitrateKbps' in parsed && !(parsed.voiceBitrateKbps >= 24 && parsed.voiceBitrateKbps <= 64)) return false;
      if ('shareBitrateMbps' in parsed && !(parsed.shareBitrateMbps >= 1 && parsed.shareBitrateMbps <= 50)) return false;
    }
    return true;
  } catch { return false; }
}
function createClientSettings(userData) {
  const file = path.join(userData, 'client-settings.json');
  const safetyFile = path.join(userData, 'audio-settings-save-failed');
  let cache = {};
  const errors = {};
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) throw new Error('Invalid settings file');
    for (const key of Object.keys(schemas)) {
      if (!Object.hasOwn(saved, key)) continue;
      cache[key] = saved[key];
      if (!validSetting(key, saved[key])) errors[key] = 'Saved settings are invalid';
    }
  } catch (error) {
    if (error.code !== 'ENOENT') for (const key of Object.keys(schemas)) errors[key] = `Settings could not be read: ${error.message}`;
  }
  try {
    fs.readFileSync(safetyFile);
    for (const key of ['haven.media.settings', 'haven.voice.state']) errors[key] = 'A previous audio settings save failed. Review and save audio settings before transmitting';
  } catch (error) {
    if (error.code !== 'ENOENT') for (const key of ['haven.media.settings', 'haven.voice.state']) errors[key] = `Audio settings safety status could not be read: ${error.message}`;
  }
  const read = key => Object.hasOwn(schemas, key) && validSetting(key, cache[key]) ? cache[key] : null;
  return {
    read,
    status: key => ({ value: read(key), error: Object.hasOwn(schemas, key) ? errors[key] ?? null : 'Unknown client setting', canPersist: true }),
    write: (key, value) => {
      if (!validSetting(key, value)) return { ok: false, error: 'Invalid client settings' };
      const next = { ...cache, [key]: value };
      try {
        fs.mkdirSync(userData, { recursive: true });
        fs.writeFileSync(`${file}.tmp`, JSON.stringify(next));
        fs.renameSync(`${file}.tmp`, file);
        if (key === 'haven.media.settings' && fs.existsSync(safetyFile)) fs.unlinkSync(safetyFile);
        cache = next;
        delete errors[key];
        return { ok: true };
      } catch (error) {
        const message = `Client settings could not be saved: ${error.message}`;
        if (key !== 'haven.preferences') {
          errors[key] = message;
          // A separate tiny marker also catches a failed atomic replace. If the
          // entire profile is unwritable, the renderer still blocks transmission
          // and the next launch's acknowledged save will fail safely again.
          try { fs.writeFileSync(safetyFile, message); } catch (failure) { console.warn('Audio safety marker could not be saved:', failure.message); }
        }
        return { ok: false, error: message };
      }
    },
    // Writes are acknowledged only after atomic replacement; quit has no pending debounce.
    flush: () => {}
  };
}
module.exports = { createClientSettings, validSetting };
