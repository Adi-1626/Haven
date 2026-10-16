const fs = require('node:fs');
const path = require('node:path');
const schemas = {
  'haven.media.settings': { inputDevice: 'string', outputDevice: 'string', pushToTalkKey: 'string', noiseSuppression: 'boolean', echoCancellation: 'boolean', pushToTalk: 'boolean', gamingMode: 'boolean', inputVolume: 'number', inputSensitivity: 'number' },
  'haven.voice.state': { muted: 'boolean', deafened: 'boolean' },
  'haven.preferences': { animateEmoji: 'boolean', notifications: 'boolean' }
};
function validSetting(key, value) {
  if (!Object.hasOwn(schemas, key) || typeof value !== 'string' || value.length > 4096) return false;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Object.entries(parsed).every(([name, item]) => Object.hasOwn(schemas[key], name) && typeof item === schemas[key][name] && (typeof item !== 'string' || item.length <= 512) && (typeof item !== 'number' || Number.isFinite(item)));
  } catch { return false; }
}
function createClientSettings(userData) {
  const file = path.join(userData, 'client-settings.json');
  let cache = {};
  let timer;
  try { const saved = JSON.parse(fs.readFileSync(file, 'utf8')); for (const key of Object.keys(schemas)) if (validSetting(key, saved[key])) cache[key] = saved[key]; } catch {}
  const flush = () => {
    clearTimeout(timer); timer = undefined;
    try { fs.mkdirSync(userData, { recursive: true }); fs.writeFileSync(`${file}.tmp`, JSON.stringify(cache)); fs.renameSync(`${file}.tmp`, file); }
    catch (error) { console.warn('Client settings could not be saved:', error.message); }
  };
  return {
    read: key => Object.hasOwn(schemas, key) ? cache[key] ?? null : null,
    write: (key, value) => { if (!validSetting(key, value)) return; cache[key] = value; clearTimeout(timer); timer = setTimeout(flush, 250); },
    flush
  };
}
module.exports = { createClientSettings, validSetting };
