import test from 'node:test';
import assert from 'node:assert/strict';
import { authStorage, setAuthPersistence } from './auth-storage.js';

test('session-only sign-in clears durable tokens and refresh writes remain temporary', async () => {
  const durable = new Map<string, string>(); const temporary = new Map<string, string>();
  const storage = (map: Map<string, string>) => ({ getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => map.set(key, value), removeItem: (key: string) => map.delete(key) });
  const keys = ['localStorage', 'sessionStorage', 'window'] as const;
  const descriptors = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage(durable) });
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: storage(temporary) });
  let nativeToken: string | null = 'old-native-token';
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { haven: {
    getAuthSession: async () => nativeToken,
    storeAuthSession: async (value: string) => { nativeToken = value; },
    clearAuthSession: async () => { nativeToken = null; },
  } } });
  try {
    durable.set('session', 'old-browser-token');
    await setAuthPersistence(false, 'session');
    await authStorage.setItem('session', 'temporary-token');
    await authStorage.setItem('session', 'refreshed-temporary-token');
    assert.equal(durable.has('session'), false); assert.equal(nativeToken, null);
    assert.equal(temporary.get('session'), 'refreshed-temporary-token');
    assert.equal(await authStorage.getItem('session'), 'refreshed-temporary-token');
    await setAuthPersistence(true, 'session'); await authStorage.setItem('session', 'persistent-token');
    assert.equal(nativeToken, 'persistent-token'); assert.equal(temporary.has('session'), false);
    await authStorage.removeItem('session'); assert.equal(nativeToken, null);
  } finally {
    keys.forEach((key, index) => descriptors[index] ? Object.defineProperty(globalThis, key, descriptors[index]!) : Reflect.deleteProperty(globalThis, key));
  }
});
