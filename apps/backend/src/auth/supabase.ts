import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { placeholderIdentity } from '@haven/shared/auth';
import type { DatabaseAdapter } from '../db/types.js';

export interface VerifiedAuthUser {
  id: string;
  email?: string;
}

export class HostedProfileReviewRequiredError extends Error {
  constructor() { super('This account requires a profile migration review. Contact the Haven host.'); }
}

/** Durable session check: true live, false signed out/expired, undefined check unavailable. */
export type AuthSessionCheck = (sessionId: string, userId: string) => Promise<boolean | undefined>;

export class SupabaseAuthVerifier {
  private client: SupabaseClient;
  private tokenCache = new Map<string, { user: VerifiedAuthUser; expiresAt: number }>();
  private sessionCheck?: AuthSessionCheck;

  /**
   * Supabase access JWTs stay cryptographically valid after sign-out; a signed-out session is detected
   * by its `session_id` claim no longer existing in auth.sessions. This check is durable across backend
   * restarts and shared by every instance, unlike any in-process denylist.
   */
  setSessionCheck(check: AuthSessionCheck | undefined): void {
    this.sessionCheck = check;
  }

  constructor(supabaseUrl: string, supabaseKey: string) {
    this.client = createClient(supabaseUrl, supabaseKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    // Cleanup token cache periodically
    const timer = setInterval(() => {
      const now = Date.now();
      for (const [token, item] of this.tokenCache.entries()) {
        if (item.expiresAt <= now) {
          this.tokenCache.delete(token);
        }
      }
    }, 60_000);
    timer.unref();
  }

  async verifyAccessToken(token: string): Promise<VerifiedAuthUser | null> {
    const result = await this.verifyAccessTokenWithDetails(token);
    return result.user || null;
  }

  /**
   * `unavailable` marks a provider/network failure (no definitive answer). Callers that hold a
   * long-lived session (Socket.IO) must not treat it as a revocation.
   */
  async verifyAccessTokenWithDetails(token: string): Promise<{ user?: VerifiedAuthUser; unconfirmedEmail?: boolean; unavailable?: boolean; signedOut?: boolean }> {
    if (!token || typeof token !== 'string') return {};
    // A cached provider lookup must never extend a signed access token's life.
    // Parsing an unverified token here can only reject it, never grant identity.
    const expiresAt = SupabaseAuthVerifier.tokenExpiresAt(token);
    if (expiresAt !== undefined && expiresAt <= Date.now()) { this.tokenCache.delete(token); return {}; }

    // Check memory cache
    const cached = this.tokenCache.get(token);
    if (cached && cached.expiresAt > Date.now()) {
      return { user: cached.user };
    }

    try {
      const { data, error } = await this.client.auth.getUser(token);
      if (error || !data.user) {
        const status = (error as { status?: number } | null)?.status;
        return error && (status === undefined || status === 0 || status >= 500 || error.name === 'AuthRetryableFetchError') ? { unavailable: true } : {};
      }

      // Enforce verified email addresses
      if (data.user.email && !data.user.email_confirmed_at) {
        return { unconfirmedEmail: true };
      }

      const authUser: VerifiedAuthUser = {
        id: data.user.id,
        email: data.user.email,
      };

      // The provider accepted this exact token, so its session_id claim is authentic.
      const sessionId = SupabaseAuthVerifier.tokenSessionId(token);
      if (sessionId && this.sessionCheck) {
        let active: boolean | undefined;
        try { active = await this.sessionCheck(sessionId, authUser.id); } catch { return { unavailable: true }; }
        if (active === false) return { signedOut: true };
      }

      // Cache for 30 seconds
      this.tokenCache.set(token, {
        user: authUser,
        expiresAt: Date.now() + 30_000,
      });

      return { user: authUser };
    } catch {
      return { unavailable: true };
    }
  }

  /** Reads `exp` (ms) from an access token that has already been verified. Unsigned input is never trusted for identity. */
  static tokenExpiresAt(token: string): number | undefined {
    try {
      const exp = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')).exp;
      return typeof exp === 'number' && Number.isFinite(exp) ? exp * 1000 : undefined;
    } catch {
      return undefined;
    }
  }

  static tokenSessionId(token: string): string | undefined {
    try {
      const sessionId = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')).session_id;
      return typeof sessionId === 'string' && sessionId ? sessionId : undefined;
    } catch {
      return undefined;
    }
  }

  invalidateToken(token: string): void {
    this.tokenCache.delete(token);
  }

  /**
   * Server-side sign-out so logout holds even if the client never reaches Supabase. `local` ends only the
   * token's own session (this device); `global` ends every session of the account. Returns false instead
   * of throwing because logout must still complete locally.
   */
  async revokeProviderSessions(token: string, scope: 'local' | 'global' = 'local'): Promise<boolean> {
    this.tokenCache.delete(token);
    try {
      const { error } = await this.client.auth.admin.signOut(token, scope);
      return !error;
    } catch {
      return false;
    }
  }


  /** Trust only persisted server-owned completion state. Legacy rows require an explicit reviewed backfill. */
  async ensureHavenUser(db: DatabaseAdapter, authUser: VerifiedAuthUser): Promise<void> {
    let existing = await db.getUser(authUser.id);
    if (!existing) {
      const placeholder = placeholderIdentity(authUser.id);
      await db.createUser({ id: authUser.id, username: placeholder, displayName: placeholder, settings: JSON.stringify({ profileCompleted: false }), createdAt: Date.now() });
      // A concurrent request or the auth trigger may have inserted this id first.
      // Re-read it; never overwrite an existing identity on an insert conflict.
      existing = await db.getUser(authUser.id);
      if (!existing) throw new Error('Hosted account could not be persisted');
    }
    let settings: unknown;
    try { settings = JSON.parse(existing.settings); } catch { throw new HostedProfileReviewRequiredError(); }
    if (settings && typeof settings === 'object' && !Array.isArray(settings)
      && typeof (settings as Record<string, unknown>).profileCompleted === 'boolean') return;
    // Do not rename or classify unreviewed existing accounts, even if metadata looks complete.
    throw new HostedProfileReviewRequiredError();
  }
}
