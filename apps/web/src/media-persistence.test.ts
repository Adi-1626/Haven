import test from 'node:test';
import assert from 'node:assert/strict';
import { readMediaPreference, saveMediaPreference } from './media-persistence';

test('desktop persistence is authoritative, acknowledged, and isolated from secondary local preferences', () => {
  const previous = Object.fromEntries(['window', 'localStorage'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const local = new Map<string, string>([['haven.media.settings', '{"pushToTalk":false}']]);
  let status = { canPersist: true, value: '{"pushToTalk":true}' as string | null, error: null as string | null };
  let writes = 0;
  let result = { ok: true, error: '' };
  const storage = { getItem: (key: string) => local.get(key) ?? null, setItem: (key: string, value: string) => { local.set(key, value); } };
  try {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { haven: {
      readClientSettingStatus: () => status,
      writeClientSetting: () => { writes++; return result; },
    } } });
    assert.equal(readMediaPreference('haven.media.settings'), '{"pushToTalk":true}');
    saveMediaPreference('haven.media.settings', '{"pushToTalk":true}');
    assert.equal(writes, 1);
    assert.equal(local.get('haven.media.settings'), '{"pushToTalk":false}', 'a desktop save does not depend on volatile origin storage');
    status = { ...status, value: null };
    assert.equal(readMediaPreference('haven.media.settings'), '{"pushToTalk":false}', 'legacy origin preferences migrate only when no main-profile value exists');
    status = { ...status, error: 'corrupt saved settings' };
    assert.throws(() => readMediaPreference('haven.media.settings'), /corrupt/);
    result = { ok: false, error: 'disk full' };
    assert.throws(() => saveMediaPreference('haven.media.settings', '{}'), /disk full/);
    status = { ...status, canPersist: false, error: null };
    const before = writes;
    saveMediaPreference('haven.media.settings', '{"pushToTalk":true}');
    assert.equal(writes, before, 'a secondary client never attempts main-profile writes');
    assert.equal(readMediaPreference('haven.media.settings'), '{"pushToTalk":true}');
    storage.setItem = () => { throw new Error('storage denied'); };
    assert.throws(() => saveMediaPreference('haven.media.settings', '{}'), /storage denied/);
  } finally {
    for (const [key, descriptor] of Object.entries(previous)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
