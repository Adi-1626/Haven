import { test, expect, type Page } from '@playwright/test';

// Renderer half of desktop voice: the real web app and real Local Mode backend, with a fake `window.haven` bridge
// standing in for Electron's preload. Global PTT edges, tray mute/deafen and window background state are emitted
// exactly as main.cjs would send them. No OS input is generated; page.keyboard events stay inside the headless page.
const password = 'Haven-Desktop-Bridge-2026';

async function fakeDesktop(page: Page) {
  await page.addInitScript(() => {
    const shortcutListeners = new Set<(event: unknown) => void>();
    const stateListeners = new Set<(state: unknown) => void>();
    const store = new Map<string, string>([['haven.media.settings', JSON.stringify({ pushToTalk: true })]]);
    let state = { settings: { closeToTray: true, minimizeToTray: true, startAtLogin: false, startMinimized: false, gamingMode: false, pttShortcut: 'Control+Shift+F10', muteShortcut: 'Control+Shift+M', deafenShortcut: 'Control+Shift+D' }, runtime: { globalPttAvailable: true, shortcutErrors: [] as string[], background: false, canConfigureDesktop: true } };
    const microphones: MediaStream[] = [];
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async constraints => { const stream = await original(constraints); microphones.push(stream); return stream; };
    const control = {
      voiceStates: [] as unknown[],
      shortcut: (event: unknown) => shortcutListeners.forEach(listener => listener(event)),
      runtime: (patch: Partial<typeof state.runtime>) => { state = { ...state, runtime: { ...state.runtime, ...patch } }; stateListeners.forEach(listener => listener(state)); },
      transmitting: () => microphones.some(stream => stream.getAudioTracks().some(track => track.readyState === 'live' && track.enabled)),
      liveMicrophones: () => microphones.filter(stream => stream.getAudioTracks().some(track => track.readyState === 'live')).length,
    };
    (window as unknown as { __desktop: typeof control }).__desktop = control;
    (window as unknown as { haven: unknown }).haven = {
      getDesktopSettings: async () => state,
      updateDesktopSettings: async (patch: Record<string, unknown>) => { state = { ...state, settings: { ...state.settings, ...patch } }; stateListeners.forEach(listener => listener(state)); return state; },
      setShortcutRecording: async () => {},
      onDesktopState: (callback: (value: unknown) => void) => { stateListeners.add(callback); return () => stateListeners.delete(callback); },
      onDesktopShortcut: (callback: (value: unknown) => void) => { shortcutListeners.add(callback); return () => shortcutListeners.delete(callback); },
      setVoiceState: (value: unknown) => control.voiceStates.push(value),
      readClientSetting: (key: string) => store.get(key) ?? null,
      readClientSettingStatus: (key: string) => ({ value: store.get(key) ?? null, error: null, canPersist: true }),
      writeClientSetting: (key: string, value: string) => { store.set(key, value); return { ok: true }; },
      storeAuthSession: async () => true, getAuthSession: async () => null, clearAuthSession: async () => true, writeClipboard: async () => true,
    };
  });
}
type Control = { voiceStates: { connected: boolean; muted: boolean; deafened: boolean; pushToTalk?: boolean }[]; shortcut: (event: unknown) => void; runtime: (patch: Record<string, unknown>) => void; transmitting: () => boolean; liveMicrophones: () => number };
const liveMicrophones = (page: Page) => page.evaluate(() => (window as unknown as { __desktop: Control }).__desktop.liveMicrophones());
const transmitting = (page: Page) => page.evaluate(() => (window as unknown as { __desktop: Control }).__desktop.transmitting());
const emit = (page: Page, event: unknown) => page.evaluate(value => (window as unknown as { __desktop: Control }).__desktop.shortcut(value), event);
const runtime = (page: Page, patch: Record<string, unknown>) => page.evaluate(value => (window as unknown as { __desktop: Control }).__desktop.runtime(value), patch);
const lastVoiceState = (page: Page) => page.evaluate(() => (window as unknown as { __desktop: Control }).__desktop.voiceStates.at(-1));
/** What the page sees when Electron loses focus, minimizes or hides to the tray. */
const windowStateEvents = (page: Page) => page.evaluate(() => {
  window.dispatchEvent(new Event('blur'));
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
  document.dispatchEvent(new Event('visibilitychange'));
  window.dispatchEvent(new Event('pagehide'));
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  document.dispatchEvent(new Event('visibilitychange'));
  window.dispatchEvent(new Event('focus'));
});

test('desktop bridge: global PTT survives focus loss, minimize and navigation; fallback, tray actions and restore never key the mic', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await fakeDesktop(page);
  const unique = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  expect((await page.request.post('/api/auth/register', { data: { username: `desk${unique}`, displayName: `desk${unique}`, password } })).ok()).toBe(true);
  const community = `Desktop bridge ${unique}`;
  expect((await page.request.post('/api/servers', { data: { name: community } })).ok()).toBe(true);
  await page.goto('/');
  await page.getByRole('button', { name: community, exact: true }).click();
  await page.getByRole('button', { name: 'Lounge', exact: true }).click();
  const dock = page.locator('.voice-connected');
  await expect(dock).toHaveClass(/voice-dock-connected/);
  await expect.poll(() => lastVoiceState(page)).toMatchObject({ connected: true, muted: false, deafened: false, pushToTalk: true });
  await expect.poll(() => liveMicrophones(page)).toBe(1);
  expect(await transmitting(page), 'PTT mode starts closed').toBe(false);

  // Global PTT edges from the keyboard helper.
  await emit(page, { action: 'ptt', pressed: true });
  await expect.poll(() => transmitting(page)).toBe(true);
  // Focus loss / minimize / hide / restore must not release a key held through the global hook.
  await windowStateEvents(page);
  await runtime(page, { background: true });
  expect(await transmitting(page), 'held global PTT survives backgrounding').toBe(true);
  // ...nor navigation between Friends, community and back.
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await page.getByRole('button', { name: community, exact: true }).click();
  expect(await transmitting(page)).toBe(true);
  await emit(page, { action: 'ptt', pressed: false });
  await expect.poll(() => transmitting(page)).toBe(false);

  // Restore with no key held: nothing opens the mic.
  await runtime(page, { background: false });
  await windowStateEvents(page);
  expect(await transmitting(page)).toBe(false);
  // While the global hook owns PTT, in-window key events are ignored (no double handling).
  await page.keyboard.down('Control'); await page.keyboard.down('Shift'); await page.keyboard.down('F10');
  expect(await transmitting(page), 'local keys do not drive PTT while the global hook is active').toBe(false);
  await page.keyboard.up('F10'); await page.keyboard.up('Shift'); await page.keyboard.up('Control');

  // Tray / global mute and deafen: a held PTT cannot transmit while muted or deafened.
  await emit(page, { action: 'mute' });
  await expect(dock.getByRole('button', { name: 'Unmute microphone', exact: true })).toBeVisible();
  await expect.poll(() => lastVoiceState(page)).toMatchObject({ muted: true });
  await emit(page, { action: 'ptt', pressed: true });
  expect(await transmitting(page), 'muted beats PTT').toBe(false);
  await emit(page, { action: 'ptt', pressed: false });
  await emit(page, { action: 'mute' });
  await emit(page, { action: 'deafen' });
  await expect(dock.getByRole('button', { name: 'Undeafen audio', exact: true })).toBeVisible();
  await emit(page, { action: 'ptt', pressed: true });
  expect(await transmitting(page), 'deafened beats PTT').toBe(false);
  await emit(page, { action: 'ptt', pressed: false });
  await emit(page, { action: 'deafen' });
  await expect(dock.getByRole('button', { name: 'Deafen audio', exact: true })).toBeVisible();
  await expect.poll(() => lastVoiceState(page)).toMatchObject({ muted: false, deafened: false });

  // The helper stops while the key is held (crash, recording): the renderer releases and falls back to in-window PTT.
  await emit(page, { action: 'ptt', pressed: true });
  await expect.poll(() => transmitting(page)).toBe(true);
  await runtime(page, { globalPttAvailable: false });
  await expect.poll(() => transmitting(page), { message: 'losing the global hook releases a held key' }).toBe(false);
  await page.keyboard.down('Control'); await page.keyboard.down('Shift'); await page.keyboard.down('F10');
  await expect.poll(() => transmitting(page), { message: 'in-window fallback uses the desktop shortcut' }).toBe(true);
  await windowStateEvents(page);
  expect(await transmitting(page), 'in-window PTT closes on focus loss because key-up will never arrive').toBe(false);
  await page.keyboard.up('F10'); await page.keyboard.up('Shift'); await page.keyboard.up('Control');

  // Throughout: one dock, one microphone capture, still connected.
  await expect(dock).toHaveCount(1);
  await expect(dock).toHaveClass(/voice-dock-connected/);
  expect(await liveMicrophones(page)).toBe(1);
  expect((await (await page.request.get('/api/bootstrap')).json()).voice).toHaveLength(1);
  expect(errors).toEqual([]);
});
