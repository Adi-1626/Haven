import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeLocalShortcut, shortcutFromKeyboard, validateShortcutDraft } from './shortcuts';

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
  assert.throws(() => shortcutFromKeyboard({ ...base, code: 'Numpad0', key: '0' }), /Use a letter/);
  assert.equal(validateShortcutDraft({ pttShortcut: 'Control+ArrowLeft', muteShortcut: '', deafenShortcut: 'Control+Shift+D' }).pttShortcut, 'Control+Left');
  assert.throws(() => validateShortcutDraft({ pttShortcut: 'Control+Q', muteShortcut: 'Control+Q', deafenShortcut: '' }), /different/);
  assert.throws(() => validateShortcutDraft({ pttShortcut: 'Q', muteShortcut: '', deafenShortcut: '' }), /need/);
});
