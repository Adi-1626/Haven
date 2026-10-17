type MediaKey = 'haven.media.settings' | 'haven.voice.state';

export function readMediaPreference(key: MediaKey): string | null {
  if (typeof window !== 'undefined' && window.haven) {
    const status = window.haven.readClientSettingStatus?.(key);
    if (status?.error) throw new Error(status.error);
    // A saved main-profile value is authoritative. A missing value may migrate
    // this origin's older preferences; a read error must never fall back.
    if (status?.canPersist && status.value !== null) return status.value;
    if (!status) {
      const value = window.haven.readClientSetting(key);
      if (value !== null) return value;
    }
  }
  return typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
}

export function saveMediaPreference(key: MediaKey, value: string): void {
  if (typeof window !== 'undefined' && window.haven) {
    const status = window.haven.readClientSettingStatus?.(key);
    if (status?.canPersist) {
      const result = window.haven.writeClientSetting(key, value);
      if (!result?.ok) throw new Error(result?.error || 'Desktop did not acknowledge the settings save');
      return;
    }
    // Isolated clients own origin-local preferences, never the main profile.
  }
  localStorage.setItem(key, value);
}
