// Shortcut tokens identify physical keys the way KeyboardEvent.code does, so they do not
// depend on the keyboard layout. Historic tokens ("A", "5", "Left") stay valid; every other
// key uses its KeyboardEvent.code name. The Windows desktop helper uses the same names.
const letters = Array.from({ length: 26 }, (_, index) => String.fromCharCode(65 + index));
const digits = Array.from({ length: 10 }, (_, index) => String(index));
const functionKeys = Array.from({ length: 24 }, (_, index) => `F${index + 1}`);
const numpad = [...Array.from({ length: 10 }, (_, index) => `Numpad${index}`), 'NumpadAdd', 'NumpadSubtract', 'NumpadMultiply', 'NumpadDivide', 'NumpadDecimal', 'NumpadEnter'];
const named = ['Space', 'Enter', 'Tab', 'Backspace', 'Escape', 'Delete', 'Insert', 'Home', 'End', 'PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Backquote', 'Minus', 'Equal', 'BracketLeft', 'BracketRight', 'Backslash', 'Semicolon', 'Quote', 'Comma', 'Period', 'Slash', 'IntlBackslash', 'CapsLock', 'NumLock', 'ScrollLock', 'ContextMenu'];
export const modifierKeyCodes = ['ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight', 'AltLeft', 'AltRight'];
export const shortcutKeys: readonly string[] = [...letters, ...digits, ...functionKeys, ...numpad, ...named, ...modifierKeyCodes];
const keyLookup = new Map(shortcutKeys.map(token => [token.toLowerCase(), token]));
const aliases: Record<string, string> = { ctrl: 'Control', control: 'Control', alt: 'Alt', shift: 'Shift', esc: 'Escape', return: 'Enter', up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', '`': 'Backquote', '-': 'Minus', '=': 'Equal', '[': 'BracketLeft', ']': 'BracketRight', '\\': 'Backslash', ';': 'Semicolon', "'": 'Quote', ',': 'Comma', '.': 'Period', '/': 'Slash' };
const reserved = ['Control+K', 'Control+L', 'Control+R', 'Control+W', 'Control+T', 'Control+N', 'Control+Shift+N', 'Control+Tab', 'Control+Shift+Tab', 'Control+Escape', 'Control+Shift+Escape', 'Alt+Escape', 'Control+Alt+Delete', 'Alt+Tab', 'Alt+F4', 'Alt+Space'];
const typingKeys = new Set([...letters, ...digits, ...numpad, 'Space', 'Enter', 'Backspace', 'Delete', 'Backquote', 'Minus', 'Equal', 'BracketLeft', 'BracketRight', 'Backslash', 'Semicolon', 'Quote', 'Comma', 'Period', 'Slash', 'IntlBackslash']);

/** The KeyboardEvent.code a stored key token corresponds to. */
export function codeForKey(token: string): string {
  const key = ['Left', 'Right', 'Up', 'Down'].includes(token) ? `Arrow${token}` : token;
  if (key.length === 1) return /[a-z]/i.test(key) ? `Key${key.toUpperCase()}` : `Digit${key}`;
  return key;
}
const keyForCode = (code: string) => /^Key[A-Z]$/.test(code) ? code.slice(3) : /^Digit[0-9]$/.test(code) ? code.slice(5) : shortcutKeys.includes(code) ? code : '';

export function isModifierKey(token: string) { return modifierKeyCodes.includes(token); }
/** True when a shortcut types text on its own (a bare printable key), so it must not fire inside text fields. */
export function shortcutTypesText(shortcut: string) {
  const parts = shortcut.split('+');
  const withoutShift = parts.slice(0, -1).filter(part => part !== 'Shift');
  return typingKeys.has(keyForCode(codeForKey(parts.at(-1) ?? ''))) && !withoutShift.length;
}

export function normalizeLocalShortcut(value: string, { modifierOnly = true }: { modifierOnly?: boolean } = {}): string {
  if (!value.trim() || value.length > 80) throw new Error('Enter a key or keyboard combination');
  const normalized = value.split('+').map(piece => {
    const lower = piece.trim().toLowerCase();
    const alias = aliases[lower];
    return alias && ['Control', 'Alt', 'Shift'].includes(alias) ? alias : keyLookup.get((alias ?? lower).toLowerCase()) ?? '';
  });
  if (normalized.some(piece => !piece) || new Set(normalized).size !== normalized.length) throw new Error('Use Control, Alt or Shift and one supported keyboard key');
  const modifiers = ['Control', 'Alt', 'Shift'].filter(modifier => normalized.includes(modifier));
  const keys = normalized.filter(piece => !modifiers.includes(piece));
  if (keys.length !== 1) throw new Error('Choose exactly one key with optional modifiers');
  if (isModifierKey(keys[0]) && (modifiers.length || !modifierOnly)) throw new Error('A modifier key can be used on its own, but not combined with other modifiers');
  const shortcut = [...modifiers, keys[0]].join('+');
  if (reserved.includes(shortcut)) throw new Error('That shortcut conflicts with Haven, Windows or your browser');
  return shortcut;
}

export function shortcutFromKeyboard(event: Pick<KeyboardEvent, 'code' | 'key' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>): string | null {
  if (event.metaKey) throw new Error('Windows / Meta combinations are reserved; use Control, Alt or Shift');
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return null;
  const key = keyForCode(event.code);
  if (!key) throw new Error('That key cannot be used; try a letter, number, function, punctuation, numpad or navigation key');
  return [...(event.ctrlKey ? ['Control'] : []), ...(event.altKey ? ['Alt'] : []), ...(event.shiftKey ? ['Shift'] : []), key].join('+');
}

export function validateShortcutDraft(draft: { pttShortcut: string; muteShortcut: string; deafenShortcut: string }) {
  const normalized = Object.fromEntries(Object.entries(draft).map(([key, value]) => {
    // Push-to-talk is observed by a keyboard hook, so it may be a bare key or a lone modifier.
    // Mute and deafen are registered as OS hotkeys and need a modifier plus a registrable key.
    const shortcut = value ? normalizeLocalShortcut(value, { modifierOnly: key === 'pttShortcut' }).replace(/Arrow(Up|Down|Left|Right)$/, '$1') : '';
    if (shortcut && key !== 'pttShortcut' && !/^(Control|Alt|Shift)\+/.test(shortcut)) throw new Error('Global mute and deafen shortcuts need Control, Alt or Shift and one other key');
    return [key, shortcut];
  })) as typeof draft;
  const shortcuts = Object.values(normalized).filter(Boolean);
  if (new Set(shortcuts).size !== shortcuts.length) throw new Error('Push-to-talk, mute and deafen must use different shortcuts');
  return normalized;
}
