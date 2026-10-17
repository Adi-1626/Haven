import { createClient, type SupabaseClient, type User as SupabaseAuthUser } from '@supabase/supabase-js';
import type { DatabaseAdapter } from '../db/types.js';

export interface VerifiedAuthUser {
  id: string;
  email?: string;
  username?: string;
  displayName?: string;
}

export class SupabaseAuthVerifier {
  private client: SupabaseClient;
  private tokenCache = new Map<string, { user: VerifiedAuthUser; expiresAt: number }>();

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

  async verifyAccessTokenWithDetails(token: string): Promise<{ user?: VerifiedAuthUser; unconfirmedEmail?: boolean }> {
    if (!token || typeof token !== 'string') return {};

    // Check memory cache
    const cached = this.tokenCache.get(token);
    if (cached && cached.expiresAt > Date.now()) {
      return { user: cached.user };
    }

    try {
      const { data, error } = await this.client.auth.getUser(token);
      if (error || !data.user) {
        return {};
      }

      // Enforce verified email addresses
      if (data.user.email && !data.user.email_confirmed_at) {
        return { unconfirmedEmail: true };
      }

      const authUser: VerifiedAuthUser = {
        id: data.user.id,
        email: data.user.email,
        username: (data.user.user_metadata?.username as string) || data.user.email?.split('@')[0],
        displayName: (data.user.user_metadata?.displayName as string) || (data.user.user_metadata?.display_name as string) || (data.user.user_metadata?.full_name as string) || (data.user.user_metadata?.name as string) || (data.user.user_metadata?.username as string) || data.user.email?.split('@')[0],
      };

      // Cache for 30 seconds
      this.tokenCache.set(token, {
        user: authUser,
        expiresAt: Date.now() + 30_000,
      });

      return { user: authUser };
    } catch {
      return {};
    }
  }

  invalidateToken(token: string): void {
    this.tokenCache.delete(token);
  }


  async ensureHavenUser(db: DatabaseAdapter, authUser: VerifiedAuthUser): Promise<void> {
    const existing = await db.getUser(authUser.id);
    if (!existing) {
      let username = authUser.username || `user_${authUser.id.slice(0, 8)}`;
      // Check if username taken
      const taken = await db.getUserByUsername(username);
      if (taken && taken.id !== authUser.id) {
        username = `${username}_${authUser.id.slice(0, 4)}`;
      }
      await db.createUser({
        id: authUser.id,
        username,
        displayName: authUser.displayName || username,
        createdAt: Date.now(),
      });
    }
  }
}
