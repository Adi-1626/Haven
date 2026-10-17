export function normalizeLocalShortcut(value: string): string {
  if (!value.trim() || value.length > 80) throw new Error('Enter a key or keyboard combination');
  const aliases: Record<string, string> = { ctrl: 'Control', control: 'Control', alt: 'Alt', shift: 'Shift', space: 'Space', esc: 'Escape', escape: 'Escape', enter: 'Enter', tab: 'Tab', backspace: 'Backspace', delete: 'Delete', insert: 'Insert', home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown', up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', arrowup: 'ArrowUp', arrowdown: 'ArrowDown', arrowleft: 'ArrowLeft', arrowright: 'ArrowRight' };
  const pieces = value.split('+').map(piece => piece.trim());
  const normalized = pieces.map(piece => aliases[piece.toLowerCase()] || (/^[a-z0-9]$/i.test(piece) || /^F(?:[1-9]|1[0-9]|2[0-4])$/i.test(piece) ? piece.toUpperCase() : ''));
  if (normalized.some(piece => !piece) || new Set(normalized).size !== normalized.length) throw new Error('Use Control, Alt or Shift and one supported keyboard key');
  const modifiers = ['Control', 'Alt', 'Shift'].filter(modifier => normalized.includes(modifier));
  const keys = normalized.filter(piece => !modifiers.includes(piece));
  if (keys.length !== 1) throw new Error('Choose exactly one key with optional modifiers');
  const shortcut = [...modifiers, keys[0]].join('+');
  if (['Control+K', 'Control+L', 'Control+R', 'Control+W', 'Control+T', 'Control+N', 'Control+Shift+N', 'Control+Tab', 'Control+Shift+Tab', 'Control+Escape', 'Control+Alt+Delete', 'Alt+Tab', 'Alt+F4'].includes(shortcut)) throw new Error('That shortcut conflicts with Haven, Windows or your browser');
  return shortcut;
}

export function shortcutFromKeyboard(event: Pick<KeyboardEvent, 'code' | 'key' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>): string | null {
  if (event.metaKey) throw new Error('Windows / Meta combinations are reserved; use Control, Alt or Shift');
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return null;
  let key = '';
  if (/^Key[A-Z]$/.test(event.code)) key = event.code.slice(3);
  else if (/^Digit[0-9]$/.test(event.code)) key = event.code.slice(5);
  else if (/^F(?:[1-9]|1[0-9]|2[0-4])$/.test(event.code)) key = event.code;
  else if (['Space', 'Enter', 'Tab', 'Backspace', 'Delete', 'Insert', 'Home', 'End', 'PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) key = event.code;
  else throw new Error('Use a letter, number, function key, Space, Enter or navigation key');
  return [...(event.ctrlKey ? ['Control'] : []), ...(event.altKey ? ['Alt'] : []), ...(event.shiftKey ? ['Shift'] : []), key].join('+');
}

export function validateShortcutDraft(draft: { pttShortcut: string; muteShortcut: string; deafenShortcut: string }) {
  const normalized = Object.fromEntries(Object.entries(draft).map(([key, value]) => {
    const shortcut = value ? normalizeLocalShortcut(value).replace(/Arrow(Up|Down|Left|Right)$/, '$1') : '';
    if (shortcut && !/^(Control|Alt|Shift)\+/.test(shortcut)) throw new Error('Global shortcuts need Control, Alt or Shift and one other key');
    return [key, shortcut];
  })) as typeof draft;
  const shortcuts = Object.values(normalized).filter(Boolean);
  if (new Set(shortcuts).size !== shortcuts.length) throw new Error('Push-to-talk, mute and deafen must use different shortcuts');
  return normalized;
}
