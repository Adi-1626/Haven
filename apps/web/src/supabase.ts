import { createClient, type SupabaseClient, type Session } from '@supabase/supabase-js';
import { getApiBaseUrl } from './api.js';

let client: SupabaseClient | null = null;
let clientPromise: Promise<SupabaseClient | null> | null = null;
let authMode: 'hosted' | 'local' = 'local';

export interface HavenAuthConfig {
  mode?: 'hosted' | 'local';
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  publicUrl?: string;
}

export async function fetchAuthConfig(): Promise<HavenAuthConfig> {
  try {
    const base = getApiBaseUrl();
    const response = await fetch(`${base}/api/config`);
    if (response.ok) {
      const data = await response.json();
      return data as HavenAuthConfig;
    }
  } catch {}
  return { mode: 'local' };
}

export async function initSupabase(): Promise<SupabaseClient | null> {
  if (client) return client;
  if (clientPromise) return clientPromise;

  clientPromise = (async () => {
    let url = typeof window !== 'undefined' ? window.__HAVEN_CONFIG__?.supabaseUrl : undefined;
    let key = typeof window !== 'undefined' ? window.__HAVEN_CONFIG__?.supabaseAnonKey : undefined;

    if (!url || !key) {
      const env = (import.meta as any).env || {};
      url = url || env.VITE_SUPABASE_URL;
      key = key || env.VITE_SUPABASE_ANON_KEY;
    }

    if (!url || !key) {
      const config = await fetchAuthConfig();
      if (config.supabaseUrl && config.supabaseAnonKey) {
        url = config.supabaseUrl;
        key = config.supabaseAnonKey;
        authMode = config.mode || 'hosted';
      }
    }

    if (!url || !key) {
      return null;
    }

    authMode = 'hosted';

    const desktopAuthStorage = (typeof window !== 'undefined' && window.haven?.storeAuthSession && window.haven?.getAuthSession)
      ? {
          getItem: async (_key: string): Promise<string | null> => {
            return (await window.haven!.getAuthSession?.()) || null;
          },
          setItem: async (_key: string, value: string): Promise<void> => {
            await window.haven!.storeAuthSession?.(value);
          },
          removeItem: async (_key: string): Promise<void> => {
            await window.haven!.clearAuthSession?.();
          },
        }
      : undefined;

    client = createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        ...(desktopAuthStorage ? { storage: desktopAuthStorage } : {}),
      },
    });

    return client;
  })();

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
