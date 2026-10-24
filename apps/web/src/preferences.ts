import { useEffect, useState } from 'react';

export interface Preferences { animateEmoji: boolean; notifications: boolean; voiceCues: boolean }
export function normalizePreferences(value: unknown): Preferences {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return { animateEmoji: typeof source.animateEmoji === 'boolean' ? source.animateEmoji : true, notifications: typeof source.notifications === 'boolean' ? source.notifications : true, voiceCues: typeof source.voiceCues === 'boolean' ? source.voiceCues : true };
}
function parsed(value: string | null | undefined) {
  try { const result: unknown = JSON.parse(value || '{}'); return result && typeof result === 'object' ? result : {}; }
  catch { return {}; }
}
// Desktop builds up to 1.0.0 reject (and so never save) a preferences value with keys they do not know.
const desktopV1Keys = ['animateEmoji', 'notifications'] as const;
export function readPreferences(): Preferences {
  try {
    // The desktop profile is authoritative; a key an older desktop could not save comes from this origin.
    return normalizePreferences({ ...parsed(localStorage.getItem('haven.preferences')), ...parsed(window.haven?.readClientSetting('haven.preferences')) });
  } catch { return normalizePreferences(null); }
}
export function savePreferences(next: Preferences) {
  try {
    localStorage.setItem('haven.preferences', JSON.stringify(next));
    const saved = window.haven?.writeClientSetting('haven.preferences', JSON.stringify(next));
    if (saved && !saved.ok) window.haven?.writeClientSetting('haven.preferences', JSON.stringify(Object.fromEntries(desktopV1Keys.map(key => [key, next[key]]))));
  } catch {}
}
export function usePreferences() {
  const [preferences, setPreferences] = useState(readPreferences);
  useEffect(() => {
    const update = (event: StorageEvent) => { if (event.key === 'haven.preferences') setPreferences(readPreferences()); };
    window.addEventListener('storage', update);
    return () => window.removeEventListener('storage', update);
  }, []);
  return { preferences, setPreferences: (patch: Partial<Preferences>) => setPreferences(previous => {
    const next = normalizePreferences({ ...previous, ...patch });
    savePreferences(next);
    return next;
  }) };
}
