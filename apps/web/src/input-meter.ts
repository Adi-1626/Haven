import { useSyncExternalStore } from 'react';

/** Presentation-only samples: no React owner state and no extra audio loop. */
export function createInputMeter() {
  let level = 0;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => level,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    publish(value: number) {
      const next = Math.round(Math.max(0, Math.min(1, value)) * 50) / 50;
      if (next === level) return;
      level = next;
      for (const listener of listeners) listener();
    },
  };
}

export type InputMeter = ReturnType<typeof createInputMeter>;
export function useInputMeter(meter: InputMeter) {
  return useSyncExternalStore(meter.subscribe, meter.getSnapshot, () => 0);
}
