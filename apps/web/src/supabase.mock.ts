import type { SupabaseClient, Session } from '@supabase/supabase-js';

// UI Testing Mode stand-in for the Supabase client. It never leaves the machine: accounts, verification and
// passwords are handled by the dev server (see ui-mode/mock-server.ts). This is NOT real Supabase Auth.

export interface HavenAuthConfig {
  mode?: 'hosted' | 'local';
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  publicUrl?: string;
}

type AuthCallback = (event: string, session: Session | null) => void;
type Identity = { id: string; email: string };

const storageKey = 'haven.ui.mock.session';
export async function setRememberSession(_remember: boolean): Promise<void> {}
const runKey = 'haven.ui.mock.run';
const runId = String(import.meta.env.VITE_HAVEN_UI_RUN_ID || '');
const alex: Identity = { id: 'usr-test-alex', email: 'alex.zenith@haven.local' };

function readStored(): Identity | null {
  try {
    // A session stored by an earlier dev-server run refers to accounts that run kept in memory: start over as Alex.
    if (localStorage.getItem(runKey) !== runId) {
      localStorage.removeItem(storageKey);
      localStorage.setItem(runKey, runId);
    }
    const raw = localStorage.getItem(storageKey);
    if (raw === null) return alex; // UI Testing Mode opens pre-authenticated as the fictional demo account
    if (raw === 'out') return null;
    const parsed = JSON.parse(raw) as Identity;
    return parsed?.id && parsed?.email ? parsed : null;
  } catch { return alex; }
}

function store(identity: Identity | null) {
  try { localStorage.setItem(storageKey, identity ? JSON.stringify(identity) : 'out'); } catch { /* storage unavailable */ }
}

function sessionFor(identity: Identity): Session {
  return {
    access_token: `mock-ui-token:${identity.id}`,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: 'mock-ui-refresh-token',
    user: {
      id: identity.id,
      app_metadata: {},
      user_metadata: {},
      aud: 'authenticated',
      created_at: new Date(1704067200000).toISOString(),
      email: identity.email,
      email_confirmed_at: new Date(1704067200000).toISOString(),
    } as any,
  };
}

async function mockAuth<T>(action: string, body: Record<string, unknown>): Promise<{ data: T | null; error: Error | null }> {
  const response = await fetch(`/api/__mock/auth/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json().catch(() => ({}));
  return response.ok ? { data: result as T, error: null } : { data: null, error: new Error(result.error || 'Request failed') };
}

class MockSupabaseAuth {
  private listeners = new Set<AuthCallback>();
  private currentSession: Session | null = (() => { const identity = readStored(); return identity ? sessionFor(identity) : null; })();

  async getSession(): Promise<{ data: { session: Session | null }; error: null }> {
    return { data: { session: this.currentSession }, error: null };
  }

  async signInWithPassword(credentials: { email?: string; password?: string }): Promise<{ data: { session: Session | null; user: any }; error: Error | null }> {
    const email = credentials.email?.trim() || '';
    const password = credentials.password || '';
    if (!email || !password) return { data: { session: null, user: null }, error: new Error('Invalid login credentials') };
    const { data, error } = await mockAuth<Identity>('sign-in', { email, password });
    if (error || !data) return { data: { session: null, user: null }, error };
    store(data);
    this.currentSession = sessionFor(data);
    this.notify('SIGNED_IN', this.currentSession);
    return { data: { session: this.currentSession, user: this.currentSession.user }, error: null };
  }

  async signUp(params: { email?: string; password?: string; options?: { data?: Record<string, any> } }): Promise<{ data: { user: any; session: Session | null }; error: Error | null }> {
    const email = params.email?.trim() || '';
    const password = params.password || '';
    if (!email || !password) return { data: { user: null, session: null }, error: new Error('Please enter email and password') };
    const { data, error } = await mockAuth<Identity & { confirmed: boolean }>('sign-up', { email, password });
    if (error || !data) return { data: { user: null, session: null }, error };
    // Like Supabase with email confirmation on: no session until the address is verified.
    const user = { id: data.id, app_metadata: {}, user_metadata: params.options?.data || {}, aud: 'authenticated', created_at: new Date().toISOString(), email, email_confirmed_at: data.confirmed ? new Date().toISOString() : null };
    if (!data.confirmed) return { data: { user, session: null }, error: null };
    store({ id: data.id, email });
    this.currentSession = sessionFor({ id: data.id, email });
    this.notify('SIGNED_IN', this.currentSession);
    return { data: { user, session: this.currentSession }, error: null };
  }

  async resetPasswordForEmail(email: string, _options?: { redirectTo?: string }): Promise<{ error: Error | null }> {
    return email.trim() ? { error: null } : { error: new Error('Please enter your account email') };
  }

  async updateUser(attributes: { password?: string }): Promise<{ data: { user: any }; error: Error | null }> {
    if (attributes.password && attributes.password.length < 8) return { data: { user: null }, error: new Error('Password must be at least 8 characters long') };
    return { data: { user: this.currentSession?.user || {} }, error: null };
  }

  async signOut(): Promise<{ error: null }> {
    this.currentSession = null;
    store(null);
    this.notify('SIGNED_OUT', null);
    return { error: null };
  }

  onAuthStateChange(callback: AuthCallback): { data: { subscription: { unsubscribe: () => void } } } {
    this.listeners.add(callback);
    return { data: { subscription: { unsubscribe: () => { this.listeners.delete(callback); } } } };
  }

  private notify(event: string, session: Session | null) {
    for (const listener of Array.from(this.listeners)) {
      try { listener(event, session); } catch (err) { console.error('[MockSupabaseAuth] listener error:', err); }
    }
  }

  triggerRecoveryEvent() { this.notify('PASSWORD_RECOVERY', this.currentSession); }
}

class MockSupabaseClient {
  public auth = new MockSupabaseAuth();
}

let mockClient: MockSupabaseClient | null = new MockSupabaseClient();
let authMode: 'hosted' | 'local' = 'hosted';

export async function fetchAuthConfig(): Promise<HavenAuthConfig> {
  return { mode: 'hosted', supabaseUrl: 'https://mock.haven.local', supabaseAnonKey: 'mock-anon-key-ui-testing-mode', publicUrl: 'http://127.0.0.1:5173' };
}

export async function initSupabase(): Promise<SupabaseClient | null> {
  if (!mockClient) mockClient = new MockSupabaseClient();
  return mockClient as unknown as SupabaseClient;
}

export function getSupabase(): SupabaseClient | null {
  return mockClient as unknown as SupabaseClient;
}

export function isHostedAuth(): boolean {
  return authMode === 'hosted';
}

export async function getAccessToken(): Promise<string | null> {
  if (!mockClient) return null;
  const { data } = await mockClient.auth.getSession();
  return data.session?.access_token || null;
}

export async function onSupabaseAuthStateChange(
  callback: (event: string, session: Session | null) => void
): Promise<{ unsubscribe: () => void }> {
  const sb = (await initSupabase()) as unknown as MockSupabaseClient;
  if (!sb) return { unsubscribe: () => {} };
  const { data: { subscription } } = sb.auth.onAuthStateChange(callback);
  return { unsubscribe: () => subscription.unsubscribe() };
}

export function resetAuthClientForTesting(): void {
  mockClient = null;
  authMode = 'local';
}
