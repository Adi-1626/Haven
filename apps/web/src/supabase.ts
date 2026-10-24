import { createClient, type SupabaseClient, type Session } from '@supabase/supabase-js';
import { authStorage, setAuthPersistence } from './auth-storage.js';
import { getApiBaseUrl } from './api.js';
import { BackendUnavailableError, readApiJson } from './json-response.js';

let client: SupabaseClient | null = null;
let clientPromise: Promise<SupabaseClient | null> | null = null;
let authMode: 'hosted' | 'local' = 'local';
let authStorageKey = '';

export interface HavenAuthConfig {
  mode?: 'hosted' | 'local';
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  publicUrl?: string;
}

export async function fetchAuthConfig(): Promise<HavenAuthConfig> {
  const base = getApiBaseUrl();
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(`${base}/api/config`, { signal: AbortSignal.timeout(8000) });
      const data = await readApiJson(response);
      if (data.mode !== undefined && data.mode !== 'local' && data.mode !== 'hosted') throw new BackendUnavailableError();
      if ((data.mode === 'hosted' || data.supabaseUrl) && (!data.supabaseUrl || !data.supabaseAnonKey)) throw new BackendUnavailableError();
      // An empty response is not evidence of Local Mode. Legacy local backends
      // return publicUrl or capabilities; new ones return mode explicitly.
      if (!data.mode && !data.supabaseUrl && !data.publicUrl && !data.capabilities) throw new BackendUnavailableError();
      return data as HavenAuthConfig;
    } catch (error) {
      if (attempt >= 2) throw error;
      await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
}

export async function initSupabase(): Promise<SupabaseClient | null> {
  if (client) return client;
  if (clientPromise) return clientPromise;

  clientPromise = (async () => {
    let url = typeof window !== 'undefined' ? window.__HAVEN_CONFIG__?.supabaseUrl : undefined;
    let key = typeof window !== 'undefined' ? window.__HAVEN_CONFIG__?.supabaseAnonKey : undefined;

    if (!url || !key) {
      const config = await fetchAuthConfig();
      if (config.supabaseUrl && config.supabaseAnonKey) {
        url = config.supabaseUrl;
        key = config.supabaseAnonKey;
        authMode = config.mode || 'hosted';
      } else if (config.mode === 'local' || (!config.mode && !config.supabaseUrl)) {
        // Connected to a backend that explicitly runs in Local Mode or lacks Supabase configuration.
        authMode = 'local';
        return null;
      }
    }

    if (!url || !key) {
      const env = (import.meta as any).env || {};
      url = env.VITE_SUPABASE_URL;
      key = env.VITE_SUPABASE_ANON_KEY;
    }

    if (!url || !key) {
      authMode = 'local';
      return null;
    }

    authMode = 'hosted';
    authStorageKey = `sb-${new URL(url).hostname.split('.')[0]}-auth-token`;

    client = createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: authStorageKey,
        storage: authStorage,
      },
    });

    return client;
  })().catch(error => { clientPromise = null; throw error; });

  return clientPromise;
}

export function getSupabase(): SupabaseClient | null {
  return client;
}

export function isHostedAuth(): boolean {
  return authMode === 'hosted';
}

export async function getAccessToken(): Promise<string | null> {
  const sb = client || (await initSupabase());
  if (!sb) return null;
  try {
    const { data } = await sb.auth.getSession();
    return data.session?.access_token || null;
  } catch {
    return null;
  }
}

export async function onSupabaseAuthStateChange(
  callback: (event: string, session: Session | null) => void
): Promise<{ unsubscribe: () => void }> {
  const sb = client || (await initSupabase());
  if (!sb) return { unsubscribe: () => {} };
  const { data: { subscription } } = sb.auth.onAuthStateChange(callback);
  return { unsubscribe: () => subscription.unsubscribe() };
}

export function resetAuthClientForTesting(): void {
  client = null;
  clientPromise = null;
  authMode = 'local';
}

export async function setRememberSession(remember: boolean): Promise<void> {
  const sb = client || await initSupabase();
  if (sb) await setAuthPersistence(remember, authStorageKey);
}
