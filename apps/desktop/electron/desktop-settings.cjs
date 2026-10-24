const defaults = Object.freeze({ closeToTray: false, minimizeToTray: false, startAtLogin: false, startMinimized: false, gamingMode: false, pttShortcut: 'Control+Shift+Space', muteShortcut: 'Control+Shift+M', deafenShortcut: 'Control+Shift+D' });

// Physical keys, identified the way KeyboardEvent.code identifies them: by the
// keyboard scan code (plus the E0 "extended" prefix), never by the layout-dependent
// virtual-key code. Stored shortcut tokens keep the historic names ("A", "5", "F9",
// "Space", "Up") and use the KeyboardEvent.code name for everything newer, so
// previously saved shortcuts remain valid. `accelerator` is the Electron name for
// keys that can also be registered with RegisterHotKey ('' when there is none).
const keys = new Map();
const define = (token, scan, extended = false, accelerator = token) => keys.set(token, { token, scan, extended, accelerator });
const letterScans = { A: 0x1E, B: 0x30, C: 0x2E, D: 0x20, E: 0x12, F: 0x21, G: 0x22, H: 0x23, I: 0x17, J: 0x24, K: 0x25, L: 0x26, M: 0x32, N: 0x31, O: 0x18, P: 0x19, Q: 0x10, R: 0x13, S: 0x1F, T: 0x14, U: 0x16, V: 0x2F, W: 0x11, X: 0x2D, Y: 0x15, Z: 0x2C };
for (const [letter, scan] of Object.entries(letterScans)) define(letter, scan);
for (let digit = 0; digit <= 9; digit++) define(String(digit), digit === 0 ? 0x0B : 0x01 + digit);
for (let number = 1; number <= 24; number++) define(`F${number}`, number <= 10 ? 0x3A + number : number === 11 ? 0x57 : number === 12 ? 0x58 : number === 24 ? 0x76 : 0x64 + number - 13);
define('Escape', 0x01); define('Backspace', 0x0E); define('Tab', 0x0F); define('Enter', 0x1C); define('Space', 0x39);
define('Backquote', 0x29, false, '`'); define('Minus', 0x0C, false, '-'); define('Equal', 0x0D, false, '='); define('BracketLeft', 0x1A, false, '['); define('BracketRight', 0x1B, false, ']');
define('Backslash', 0x2B, false, '\\'); define('Semicolon', 0x27, false, ';'); define('Quote', 0x28, false, "'"); define('Comma', 0x33, false, ','); define('Period', 0x34, false, '.'); define('Slash', 0x35, false, '/');
define('IntlBackslash', 0x56, false, '');
define('CapsLock', 0x3A, false, 'Capslock'); define('NumLock', 0x45, false, 'Numlock'); define('ScrollLock', 0x46, false, 'Scrolllock');
define('Insert', 0x52, true); define('Delete', 0x53, true); define('Home', 0x47, true); define('End', 0x4F, true); define('PageUp', 0x49, true); define('PageDown', 0x51, true);
define('Up', 0x48, true); define('Down', 0x50, true); define('Left', 0x4B, true); define('Right', 0x4D, true);
define('ContextMenu', 0x5D, true, '');
[['Numpad7', 0x47], ['Numpad8', 0x48], ['Numpad9', 0x49], ['Numpad4', 0x4B], ['Numpad5', 0x4C], ['Numpad6', 0x4D], ['Numpad1', 0x4F], ['Numpad2', 0x50], ['Numpad3', 0x51], ['Numpad0', 0x52]].forEach(([token, scan]) => define(token, scan, false, `num${token.slice(6)}`));
define('NumpadMultiply', 0x37, false, 'nummult'); define('NumpadSubtract', 0x4A, false, 'numsub'); define('NumpadAdd', 0x4E, false, 'numadd'); define('NumpadDecimal', 0x53, false, 'numdec');
define('NumpadDivide', 0x35, true, 'numdiv'); define('NumpadEnter', 0x1C, true, '');
// Modifier keys can be the push-to-talk key itself (for example Right Control).
// They are never part of a combination and cannot be registered as hotkeys.
const modifierKeys = new Map([['ControlLeft', [0x1D, false]], ['ControlRight', [0x1D, true]], ['ShiftLeft', [0x2A, false]], ['ShiftRight', [0x36, false]], ['AltLeft', [0x38, false]], ['AltRight', [0x38, true]]]);
for (const [token, [scan, extended]] of modifierKeys) define(token, scan, extended, '');
const aliases = { ctrl: 'Control', control: 'Control', alt: 'Alt', shift: 'Shift', esc: 'Escape', return: 'Enter', arrowup: 'Up', arrowdown: 'Down', arrowleft: 'Left', arrowright: 'Right', '`': 'Backquote', '-': 'Minus', '=': 'Equal', '[': 'BracketLeft', ']': 'BracketRight', '\\': 'Backslash', ';': 'Semicolon', "'": 'Quote', ',': 'Comma', '.': 'Period', '/': 'Slash' };
const keyLookup = new Map([...keys.keys()].map(token => [token.toLowerCase(), token]));

function parseShortcut(value, { bare = false } = {}) {
  if (typeof value !== 'string' || value.length > 80) throw new Error('Enter a keyboard combination, for example Control+Shift+Space');
  if (!value.trim()) return { shortcut: '', accelerator: '', scanCode: 0, extended: false, modifiers: 0 };
  const normalized = value.split('+').map(piece => {
    const lower = piece.trim().toLowerCase();
    const alias = aliases[lower];
    return alias && ['Control', 'Alt', 'Shift'].includes(alias) ? alias : keyLookup.get((alias ?? lower).toLowerCase());
  });
  if (normalized.some(piece => !piece) || new Set(normalized).size !== normalized.length) throw new Error('Use Control, Alt or Shift plus a supported keyboard key');
  const pressed = normalized.filter(piece => !['Control', 'Alt', 'Shift'].includes(piece));
  const modifiers = (normalized.includes('Control') ? 2 : 0) | (normalized.includes('Alt') ? 1 : 0) | (normalized.includes('Shift') ? 4 : 0);
  if (pressed.length !== 1) throw new Error(bare ? 'Choose exactly one key with optional Control, Alt or Shift' : 'Each global shortcut needs Control, Alt or Shift and exactly one other key');
  const key = pressed[0];
  const entry = keys.get(key);
  if (modifierKeys.has(key)) {
    if (!bare || modifiers) throw new Error(bare ? 'A modifier key can be used on its own, but not combined with other modifiers' : 'Use Control, Alt or Shift together with another key for this shortcut');
  } else if (!modifiers && !bare) throw new Error('Each global shortcut needs Control, Alt or Shift and exactly one other key');
  if (!bare && !entry.accelerator) throw new Error(`${key} cannot be used for this shortcut; choose another key, or use it for push-to-talk`);
  if (key === 'K' && modifiers === 2) throw new Error('Control+K is reserved for Haven’s quick switcher');
  if ((key === 'F4' && (modifiers & 1)) || (key === 'Delete' && (modifiers & 3) === 3) || (key === 'Tab' && (modifiers & 1)) || (key === 'Escape' && modifiers & 3) || (key === 'Space' && modifiers === 1)) throw new Error('That combination is reserved by Windows');
  const accelerator = entry.accelerator ? [...['Control', 'Alt', 'Shift'].filter(modifier => normalized.includes(modifier)), entry.accelerator].join('+') : '';
  return { shortcut: [...['Control', 'Alt', 'Shift'].filter(modifier => normalized.includes(modifier)), key].join('+'), accelerator, scanCode: entry.scan, extended: entry.extended, modifiers };
}

function validateSettings(current, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Invalid desktop settings');
  const next = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in defaults)) throw new Error(`Unknown desktop setting: ${key}`);
    if (typeof defaults[key] === 'boolean') {
      if (typeof value !== 'boolean') throw new Error(`Invalid value for ${key}`);
      next[key] = value;
    } else next[key] = parseShortcut(value, { bare: key === 'pttShortcut' }).shortcut;
  }
  const shortcuts = ['pttShortcut', 'muteShortcut', 'deafenShortcut'].map(key => next[key]).filter(Boolean);
  if (next.startMinimized && !next.closeToTray && !next.minimizeToTray) throw new Error('Enable close to tray or minimize to tray before starting minimized');
  if (new Set(shortcuts).size !== shortcuts.length) throw new Error('Push-to-talk, mute and deafen must use different shortcuts');
  return next;
}
module.exports = { defaults, parseShortcut, validateSettings };
