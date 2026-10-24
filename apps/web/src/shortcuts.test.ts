import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { normalizeLocalShortcut, shortcutFromKeyboard, shortcutKeys, shortcutTypesText, validateShortcutDraft } from './shortcuts';

const require = createRequire(import.meta.url);

test('local push-to-talk normalizes combinations and rejects ambiguous or conflicting shortcuts', () => {
  assert.equal(normalizeLocalShortcut('shift + ctrl + space'), 'Control+Shift+Space');
  assert.equal(normalizeLocalShortcut('f9'), 'F9');
  assert.equal(normalizeLocalShortcut('ctrl+left'), 'Control+ArrowLeft');
  for (const value of ['', 'Ctrl', 'A+B', 'Ctrl+Control+M', 'Meta+K', 'Ctrl+K', 'Alt+F4', 'Control+W']) assert.throws(() => normalizeLocalShortcut(value));
});

test('shortcut recording uses physical keys, exact modifiers and rejects reserved keys', () => {
  const base = { code: 'KeyQ', key: 'a', ctrlKey: true, shiftKey: false, altKey: false, metaKey: false };
  assert.equal(shortcutFromKeyboard(base), 'Control+Q');
  assert.equal(shortcutFromKeyboard({ ...base, code: 'Space', key: ' ', shiftKey: true }), 'Control+Shift+Space');
  assert.equal(shortcutFromKeyboard({ ...base, code: 'ShiftLeft', key: 'Shift' }), null);
  assert.throws(() => shortcutFromKeyboard({ ...base, metaKey: true }), /reserved/);
  assert.equal(shortcutFromKeyboard({ ...base, code: 'Numpad0', key: '0' }), 'Control+Numpad0');
  assert.throws(() => shortcutFromKeyboard({ ...base, code: 'MediaPlayPause', key: 'MediaPlayPause' }), /cannot be used/);
  assert.equal(validateShortcutDraft({ pttShortcut: 'Control+ArrowLeft', muteShortcut: '', deafenShortcut: 'Control+Shift+D' }).pttShortcut, 'Control+Left');
  assert.throws(() => validateShortcutDraft({ pttShortcut: 'Control+Q', muteShortcut: 'Control+Q', deafenShortcut: '' }), /different/);
  assert.throws(() => validateShortcutDraft({ pttShortcut: '', muteShortcut: 'Q', deafenShortcut: '' }), /need/);
  assert.equal(validateShortcutDraft({ pttShortcut: 'Q', muteShortcut: '', deafenShortcut: '' }).pttShortcut, 'Q');
});

test('every practical key records by physical code, independent of layout', () => {
  const none = { ctrlKey: false, shiftKey: false, altKey: false, metaKey: false };
  // The character on the keycap differs per layout; the recorded key never does.
  assert.equal(shortcutFromKeyboard({ ...none, code: 'Backquote', key: '`' }), 'Backquote');
  assert.equal(shortcutFromKeyboard({ ...none, code: 'Backquote', key: '²' }), 'Backquote');
  assert.equal(shortcutFromKeyboard({ ...none, code: 'Backquote', key: 'ö', shiftKey: true }), 'Shift+Backquote');
  for (const [code, key] of [['F13', 'F13'], ['F24', 'F24'], ['Minus', '-'], ['Equal', '='], ['BracketLeft', '['], ['Semicolon', ';'], ['Quote', "'"], ['Comma', ','], ['Period', '.'], ['Slash', '/'], ['Backslash', '\\'], ['IntlBackslash', '<'], ['NumpadAdd', '+'], ['NumpadDecimal', '.'], ['NumpadEnter', 'Enter'], ['CapsLock', 'CapsLock'], ['ScrollLock', 'ScrollLock'], ['ContextMenu', 'ContextMenu'], ['Digit1', '&'], ['KeyA', 'q']]) {
    const shortcut = shortcutFromKeyboard({ ...none, code, key });
    assert.equal(shortcut, code.startsWith('Key') ? code.slice(3) : code.startsWith('Digit') ? code.slice(5) : code);
    assert.equal(normalizeLocalShortcut(shortcut!), shortcut);
  }
  assert.equal(normalizeLocalShortcut('`'), 'Backquote');
  assert.equal(normalizeLocalShortcut('ctrl+/'), 'Control+Slash');
  assert.equal(normalizeLocalShortcut('numpad0'), 'Numpad0');
  assert.equal(normalizeLocalShortcut('controlright'), 'ControlRight');
  assert.throws(() => normalizeLocalShortcut('Shift+ControlRight'), /on its own/);
  assert.throws(() => normalizeLocalShortcut('Control+Shift+Escape'), /conflicts/);
  assert.equal(validateShortcutDraft({ pttShortcut: 'Backquote', muteShortcut: 'Control+Backquote', deafenShortcut: '' }).pttShortcut, 'Backquote');
  assert.equal(validateShortcutDraft({ pttShortcut: 'AltRight', muteShortcut: '', deafenShortcut: '' }).pttShortcut, 'AltRight');
  assert.throws(() => validateShortcutDraft({ pttShortcut: '', muteShortcut: 'ControlRight', deafenShortcut: '' }));
});

test('only shortcuts that type text are suppressed inside text fields', () => {
  for (const typing of ['Backquote', 'A', 'Shift+A', 'Space', 'Numpad5']) assert.equal(shortcutTypesText(typing), true, typing);
  for (const safe of ['F9', 'Control+Backquote', 'Alt+A', 'ControlRight', 'Control+Shift+Space', 'ArrowLeft', 'ScrollLock']) assert.equal(shortcutTypesText(safe), false, safe);
});

test('web and Windows desktop agree on every shortcut key', () => {
  const { parseShortcut } = require('../../desktop/electron/desktop-settings.cjs');
  for (const key of shortcutKeys) {
    const parsed = parseShortcut(key, { bare: true });
    assert.ok(parsed.scanCode > 0, key);
    // Desktop stores arrows by their short names; every other token is identical.
    assert.equal(parsed.shortcut, key.replace(/^Arrow/, ''), key);
  }
});
