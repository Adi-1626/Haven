import { useEffect, useState } from 'react';

export interface Preferences { animateEmoji: boolean; notifications: boolean; voiceCues: boolean }
export function normalizePreferences(value: unknown): Preferences {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return { animateEmoji: typeof source.animateEmoji === 'boolean' ? source.animateEmoji : true, notifications: typeof source.notifications === 'boolean' ? source.notifications : true, voiceCues: typeof source.voiceCues === 'boolean' ? source.voiceCues : true };
}
export function readPreferences(): Preferences {
  try { return normalizePreferences(JSON.parse(window.haven?.readClientSetting('haven.preferences') || localStorage.getItem('haven.preferences') || '{}')); }
  catch { return normalizePreferences(null); }
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
    try { localStorage.setItem('haven.preferences', JSON.stringify(next)); window.haven?.writeClientSetting('haven.preferences', JSON.stringify(next)); } catch {}
    return next;
  }) };
}
