import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePreferences } from './preferences';

test('preferences preserve explicit false and reject malformed persisted values', () => {
  assert.deepEqual(normalizePreferences(null), { animateEmoji: true, notifications: true });
  assert.deepEqual(normalizePreferences({ animateEmoji: false, notifications: false }), { animateEmoji: false, notifications: false });
  assert.deepEqual(normalizePreferences({ animateEmoji: 'false', notifications: 0, unknown: true }), { animateEmoji: true, notifications: true });
});
