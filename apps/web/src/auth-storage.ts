// Keep Supabase's refresh writes in the same storage class selected at sign-in.
// A session-only login must also remove any older durable copy.
const modeKey = 'haven.auth.persistence';
let remember = true;
try { remember = sessionStorage.getItem(modeKey) !== 'session'; } catch {}
const memory = new Map<string, string>();

export const authStorage = {
  async getItem(key: string): Promise<string | null> {
    if (!remember) {
      try { return sessionStorage.getItem(key) ?? memory.get(key) ?? null; } catch { return memory.get(key) ?? null; }
    }
    if (typeof window !== 'undefined' && window.haven?.getAuthSession) return await window.haven.getAuthSession() ?? memory.get(key) ?? null;
    try { return localStorage.getItem(key) ?? memory.get(key) ?? null; } catch { return memory.get(key) ?? null; }
  },
  async setItem(key: string, value: string): Promise<void> {
    memory.set(key, value);
    if (!remember) {
      try { sessionStorage.setItem(key, value); localStorage.removeItem(key); } catch {}
      return;
    }
    if (typeof window !== 'undefined' && window.haven?.storeAuthSession) {
      await window.haven.storeAuthSession(value);
      return;
    }
    try { localStorage.setItem(key, value); } catch {}
  },
  async removeItem(key: string): Promise<void> {
    memory.delete(key);
    try { sessionStorage.removeItem(key); localStorage.removeItem(key); } catch {}
    if (typeof window !== 'undefined') await window.haven?.clearAuthSession?.();
  },
};

export async function setAuthPersistence(persistent: boolean, storageKey: string): Promise<void> {
  // Switch before the next sign-in/refresh writes. Erase both previous copies.
  await authStorage.removeItem(storageKey);
  remember = persistent;
  try { sessionStorage.setItem(modeKey, persistent ? 'persistent' : 'session'); } catch {}
}
