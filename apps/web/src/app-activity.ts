import { useSyncExternalStore } from 'react';

type ActivityEnvironment = { document?: Document; window?: Window };

/** One shared subscription: Electron intentionally leaves realtime timers running. */
export function createAppActivityStore(environment: () => ActivityEnvironment = () => ({
  document: typeof document === 'undefined' ? undefined : document,
  window: typeof window === 'undefined' ? undefined : window,
})) {
  const listeners = new Set<() => void>();
  let active = true;
  let desktopActive: boolean | undefined;
  let dispose: (() => void) | undefined;
  let generation = 0;
  const browserActive = () => {
    const doc = environment().document;
    return !doc || (doc.visibilityState !== 'hidden' && doc.hasFocus());
  };
  const update = () => {
    const next = desktopActive ?? browserActive();
    if (next === active) return;
    active = next;
    for (const listener of listeners) listener();
  };
  const subscribe = (listener: () => void) => {
    const entry = () => listener();
    listeners.add(entry);
    if (listeners.size === 1) {
      const current = ++generation;
      const { document: doc, window: win } = environment();
      doc?.addEventListener('visibilitychange', update);
      win?.addEventListener('focus', update);
      win?.addEventListener('blur', update);
      let events = 0;
      const desktop = win?.haven;
      const stopDesktop = desktop?.onDesktopState(state => {
        if (current !== generation) return;
        events++;
        desktopActive = !state.runtime.background;
        update();
      });
      void desktop?.getDesktopSettings().then(state => {
        if (current !== generation || events) return;
        desktopActive = !state.runtime.background;
        update();
      }).catch(() => {});
      dispose = () => {
        doc?.removeEventListener('visibilitychange', update);
        win?.removeEventListener('focus', update);
        win?.removeEventListener('blur', update);
        stopDesktop?.();
      };
      update();
    }
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      listeners.delete(entry);
      if (!listeners.size) {
        generation++;
        dispose?.();
        dispose = undefined;
        desktopActive = undefined;
      }
    };
  };
  return { subscribe, getSnapshot: () => listeners.size ? active : browserActive() };
}

const activity = createAppActivityStore();
export const subscribeAppActivity = activity.subscribe;
export const getAppActivitySnapshot = activity.getSnapshot;
export function useAppActivity(): boolean {
  return useSyncExternalStore(subscribeAppActivity, getAppActivitySnapshot, () => true);
}
