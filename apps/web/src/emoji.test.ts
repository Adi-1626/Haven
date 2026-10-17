import assert from 'node:assert/strict';
import { test } from 'node:test';
import { customEmojiToken, eligibleEmojiAnimations, emojiCatalog, findAnimatedEmoji, maxAnimatedEmoji, splitEmojiText } from './emoji-data';

test('known bundled animation tokens survive message and reaction limits', () => {
  const tokens = emojiCatalog.map(emoji => emoji.value);
  assert.equal(new Set(tokens).size, tokens.length);
  for (const emoji of emojiCatalog) {
    assert.ok(emoji.value.length <= 32);
    assert.equal(Boolean(findAnimatedEmoji(emoji.value)), 'animation' in emoji);
  }
});

test('emoji parsing retains all ordinary content and leaves unknown tokens inert', () => {
  const text = 'Hi :haven_wave: 💜\n:haven_unknown: <script>evil()</script>:haven_heart:!';
  const parts = splitEmojiText(text);
  assert.equal(parts.map(part => part.text).join(''), text);
  assert.deepEqual(parts.filter(part => part.emoji).map(part => part.text), [':haven_wave:', ':haven_heart:']);
  assert.deepEqual(splitEmojiText(''), []);
  assert.deepEqual(splitEmojiText(':haven_blink::haven_wave:'), [{ text: ':haven_blink:', emoji: true }, { text: ':haven_wave:', emoji: true }]);
});

test('animation scheduling bounds concurrent work and excludes offscreen emoji', () => {
  const entries = Array.from({ length: 100 }, (_, id) => ({ id, visible: id % 2 === 0 }));
  const selected = eligibleEmojiAnimations(entries);
  assert.equal(selected.size, maxAnimatedEmoji);
  assert.ok([...selected].every(id => entries[id].visible));
  assert.equal(eligibleEmojiAnimations(entries, 0).size, 0);
  assert.deepEqual([...eligibleEmojiAnimations(entries, 2)], [0, 2]);
  entries[0].visible = false;
  assert.deepEqual([...eligibleEmojiAnimations(entries, 2)], [2, 4]);
});

test('custom emoji tokens are stable, membership-scoped and never parse unknown markup', () => {
  const first = customEmojiToken('12345678-1234-4234-8234-123456789abc');
  const unknown = customEmojiToken('99999999-1234-4234-8234-123456789abc');
  const text = `${first}${first} :haven_wave: ${unknown} <img src=x onerror=alert(1)>`;
  const parts = splitEmojiText(text, new Set([first]));
  assert.equal(parts.map(part => part.text).join(''), text);
  assert.deepEqual(parts.filter(part => part.emoji).map(part => part.text), [first, first, ':haven_wave:']);
  assert.deepEqual(splitEmojiText(first), [{ text: first, emoji: false }]);
  assert.equal(first.length, 42);
});
