import test from 'node:test';
import assert from 'node:assert/strict';
import type { DesktopState } from './desktop';
import { createAppActivityStore, getAppActivitySnapshot } from './app-activity';

class Surface extends EventTarget {
  visibilityState = 'visible';
  focused = true;
  hasFocus() { return this.focused; }
}
const state = (background: boolean) => ({ runtime: { background } }) as DesktopState;

test('browser activity shares listeners and stops visual work on focus or visibility loss', () => {
  const doc = new Surface();
  const win = new Surface();
  const store = createAppActivityStore(() => ({ document: doc as unknown as Document, window: win as unknown as Window }));
  let first = 0;
  let second = 0;
  const stopFirst = store.subscribe(() => first++);
  const stopSecond = store.subscribe(() => second++);
  assert.equal(store.getSnapshot(), true);
  doc.focused = false; win.dispatchEvent(new Event('blur'));
  assert.equal(store.getSnapshot(), false);
  win.dispatchEvent(new Event('blur'));
  assert.deepEqual([first, second], [1, 1]);
  doc.focused = true; win.dispatchEvent(new Event('focus'));
  doc.visibilityState = 'hidden'; doc.dispatchEvent(new Event('visibilitychange'));
  assert.deepEqual([first, second], [3, 3]);
  stopFirst(); stopFirst();
  doc.visibilityState = 'visible'; doc.dispatchEvent(new Event('visibilitychange'));
  assert.deepEqual([first, second], [3, 4]);
  stopSecond();
  doc.focused = false; win.dispatchEvent(new Event('blur'));
  assert.deepEqual([first, second], [3, 4]);
  assert.equal(store.getSnapshot(), false, 'fresh reads reflect browser state without subscribers');
});

test('one desktop subscription is authoritative and stale promises cannot revive cleaned-up state', async () => {
  const doc = new Surface();
  const win = new Surface() as Surface & { haven: unknown };
  let resolve!: (snapshot: DesktopState) => void;
  let callback!: (snapshot: DesktopState) => void;
  let subscriptions = 0;
  let requests = 0;
  let stops = 0;
  win.haven = {
    onDesktopState(listener: typeof callback) { callback = listener; subscriptions++; return () => stops++; },
    getDesktopSettings() { requests++; return new Promise<DesktopState>(done => { resolve = done; }); },
  };
  const store = createAppActivityStore(() => ({ document: doc as unknown as Document, window: win as unknown as Window }));
  let changes = 0;
  const stopFirst = store.subscribe(() => changes++);
  const stopSecond = store.subscribe(() => {});
  assert.deepEqual([subscriptions, requests], [1, 1]);
  callback(state(true));
  resolve(state(false)); await Promise.resolve();
  assert.equal(store.getSnapshot(), false, 'late foreground snapshot cannot overwrite a newer background event');
  callback(state(false));
  doc.visibilityState = 'hidden'; doc.focused = false;
  win.dispatchEvent(new Event('blur')); doc.dispatchEvent(new Event('visibilitychange'));
  assert.equal(store.getSnapshot(), true, 'Electron background state takes precedence over throttling-related document visibility');
  stopFirst();
  assert.equal(stops, 0);
  stopSecond();
  assert.equal(stops, 1);
  const oldCallback = callback;
  const stopThird = store.subscribe(() => {});
  assert.deepEqual([subscriptions, requests], [2, 2]);
  callback(state(true));
  oldCallback(state(false));
  assert.equal(store.getSnapshot(), false);
  stopThird();
  resolve(state(false)); await Promise.resolve();
  assert.equal(store.getSnapshot(), false, 'late initial request does not survive cleanup');
  assert.equal(stops, 2);
  assert.equal(changes, 2);
});

test('activity store is safe to import and read without browser globals', () => {
  assert.equal(createAppActivityStore(() => ({})).getSnapshot(), true);
  assert.equal(typeof getAppActivitySnapshot(), 'boolean');
});
