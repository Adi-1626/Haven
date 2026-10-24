import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePreferences, readPreferences, savePreferences } from './preferences';

test('preferences preserve explicit false and reject malformed persisted values', () => {
  assert.deepEqual(normalizePreferences(null), { animateEmoji: true, notifications: true, voiceCues: true });
  assert.deepEqual(normalizePreferences({ animateEmoji: false, notifications: false, voiceCues: false }), { animateEmoji: false, notifications: false, voiceCues: false });
  assert.deepEqual(normalizePreferences({ animateEmoji: 'false', notifications: 0, voiceCues: 'no', unknown: true }), { animateEmoji: true, notifications: true, voiceCues: true });
});

test('preferences keep persisting on a 1.0.0 desktop that rejects the new voice cue key', () => {
  const previous = { window: Object.getOwnPropertyDescriptor(globalThis, 'window'), localStorage: Object.getOwnPropertyDescriptor(globalThis, 'localStorage') };
  const local = new Map<string, string>();
  let desktop: string | null = JSON.stringify({ animateEmoji: true, notifications: true });
  // The 1.0.0 main process accepts only the keys it knows and rejects the whole value otherwise.
  const writeClientSetting = (_key: string, value: string) => {
    if (!Object.keys(JSON.parse(value)).every(key => ['animateEmoji', 'notifications'].includes(key))) return { ok: false, error: 'Invalid client setting' };
    desktop = value; return { ok: true };
  };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => local.get(key) ?? null, setItem: (key: string, value: string) => { local.set(key, value); } } });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { haven: { readClientSetting: () => desktop, writeClientSetting } } });
  try {
    savePreferences({ animateEmoji: true, notifications: false, voiceCues: false });
    assert.deepEqual(JSON.parse(desktop!), { animateEmoji: true, notifications: false });
    // After a restart: the desktop profile keeps its keys and the voice cue choice survives locally.
    assert.deepEqual(readPreferences(), { animateEmoji: true, notifications: false, voiceCues: false });
    // A desktop that knows the key stores everything.
    (globalThis as any).window.haven.writeClientSetting = (_key: string, value: string) => { desktop = value; return { ok: true }; };
    savePreferences({ animateEmoji: false, notifications: true, voiceCues: true });
    assert.deepEqual(JSON.parse(desktop!), { animateEmoji: false, notifications: true, voiceCues: true });
  } finally {
    for (const [key, descriptor] of Object.entries(previous)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
  }
});
