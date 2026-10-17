const defaults = Object.freeze({ closeToTray: false, minimizeToTray: false, startAtLogin: false, startMinimized: false, gamingMode: false, pttShortcut: 'Control+Shift+Space', muteShortcut: 'Control+Shift+M', deafenShortcut: 'Control+Shift+D' });
const keyCodes = { Space: 32, Enter: 13, Tab: 9, Escape: 27, Backspace: 8, Insert: 45, Delete: 46, Home: 36, End: 35, PageUp: 33, PageDown: 34, Up: 38, Down: 40, Left: 37, Right: 39 };
for (let index = 0; index < 26; index++) keyCodes[String.fromCharCode(65 + index)] = 65 + index;
for (let index = 0; index < 10; index++) keyCodes[String(index)] = 48 + index;
for (let index = 1; index <= 24; index++) keyCodes[`F${index}`] = 111 + index;

function parseShortcut(value) {
  if (typeof value !== 'string' || value.length > 80) throw new Error('Enter a keyboard combination, for example Control+Shift+Space');
  if (!value.trim()) return { accelerator: '', keyCode: 0, modifiers: 0 };
  const pieces = value.split('+').map(piece => piece.trim());
  const aliases = { ctrl: 'Control', control: 'Control', alt: 'Alt', shift: 'Shift', space: 'Space', esc: 'Escape' };
  const normalized = pieces.map(piece => aliases[piece.toLowerCase()] || (piece.length === 1 ? piece.toUpperCase() : Object.keys(keyCodes).find(key => key.toLowerCase() === piece.toLowerCase())));
  if (normalized.some(piece => !piece) || new Set(normalized).size !== normalized.length) throw new Error('Use Control, Alt or Shift plus a supported keyboard key');
  const keys = normalized.filter(piece => !['Control', 'Alt', 'Shift'].includes(piece));
  const modifiers = (normalized.includes('Control') ? 2 : 0) | (normalized.includes('Alt') ? 1 : 0) | (normalized.includes('Shift') ? 4 : 0);
  if (keys.length !== 1 || !modifiers) throw new Error('Each global shortcut needs Control, Alt or Shift and exactly one other key');
  const key = keys[0];
  if (key === 'K' && modifiers === 2) throw new Error('Control+K is reserved for Haven’s quick switcher');
  if ((key === 'F4' && (modifiers & 1)) || (key === 'Delete' && (modifiers & 3) === 3) || (key === 'Tab' && (modifiers & 1)) || (key === 'Escape' && (modifiers & 2))) throw new Error('That combination is reserved by Windows');
  return { accelerator: [...['Control', 'Alt', 'Shift'].filter(modifier => normalized.includes(modifier)), key].join('+'), keyCode: keyCodes[key], modifiers };
}

function validateSettings(current, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Invalid desktop settings');
  const next = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in defaults)) throw new Error(`Unknown desktop setting: ${key}`);
    if (typeof defaults[key] === 'boolean') {
      if (typeof value !== 'boolean') throw new Error(`Invalid value for ${key}`);
      next[key] = value;
    } else next[key] = parseShortcut(value).accelerator;
  }
  const shortcuts = ['pttShortcut', 'muteShortcut', 'deafenShortcut'].map(key => next[key]).filter(Boolean);
  if (next.startMinimized && !next.closeToTray && !next.minimizeToTray) throw new Error('Enable close to tray or minimize to tray before starting minimized');
  if (new Set(shortcuts).size !== shortcuts.length) throw new Error('Push-to-talk, mute and deafen must use different shortcuts');
  return next;
}
module.exports = { defaults, parseShortcut, validateSettings };
