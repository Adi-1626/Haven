import express, { type Request, type Response, type NextFunction } from 'express';
import { normalizeLoginUsername, usernameExpression, usernameProblem } from '@haven/shared/auth';
import { createServer } from 'node:http';
import { randomBytes, randomUUID, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import multer from 'multer';
import { Server as SocketServer, type Socket } from 'socket.io';
import { z } from 'zod';
import type { User, Message, VoicePeer, ServerEmoji } from '@haven/shared/types';
import { inspectRaster } from './images.js';
import { createDatabase, type DatabaseAdapter, type UserRow, SqliteAdapter, AttachmentClaimError, FriendRequestConflictError } from './db/index.js';
import { createStorage, type StorageService } from './storage/index.js';
import { HostedProfileReviewRequiredError, SupabaseAuthVerifier } from './auth/supabase.js';
import { assertActiveInvite, InviteUnavailableError } from './db/invites.js';

type AuthRequest = Request & { userId?: string; profile?: User; viaSupabase?: boolean };
class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
/** The socket's session ended: acknowledge with this error first, then disconnect, so the client learns why. */
class SessionEnded extends ApiError { constructor() { super(401, 'Session expired'); } }
// Every layout (source, build, Docker, standalone, packaged desktop) has the release manifest one level above src/build.
export const HAVEN_VERSION: string = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const id = () => randomUUID();
const now = () => Date.now();
const text = (maximum: number) => z.string().trim().min(1).max(maximum);
const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
const passwordHash = (password: string, salt: string) => new Promise<Buffer>((resolve, reject) => scrypt(password, salt, 64, (error, derived) => error ? reject(error) : resolve(derived)));
const parseCookies = (cookie = '') => Object.fromEntries(cookie.split(';').map(part => part.trim().split('=')).filter(parts => parts.length === 2));
const scopeSchema = z.object({ channelId: z.string().optional(), conversationId: z.string().optional() }).refine(value => Boolean(value.channelId) !== Boolean(value.conversationId), 'Choose one message destination');

export interface AppOptions {
  dataDir?: string;
  databaseUrl?: string;
  db?: DatabaseAdapter;
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  supabaseServiceKey?: string;
  supabaseVerifier?: SupabaseAuthVerifier | null;
  origins?: string[];
  publicUrl?: string;
  serveStatic?: boolean;
  staticDir?: string;
}

export function createApp({
  dataDir = path.resolve('data'),
  databaseUrl,
  db: optionsDb,
  supabaseUrl = process.env.SUPABASE_URL,
  supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY,
  supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY,
  supabaseVerifier: optionsSupabaseVerifier,
  origins = [],
  publicUrl = process.env.PUBLIC_URL,
  serveStatic = process.env.SERVE_STATIC === 'true',
  staticDir = process.env.STATIC_DIR,
}: AppOptions = {}) {
  let configuredPublicUrl: string | undefined;
  if (publicUrl) {
    const parsed = new URL(publicUrl);
    if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/' || (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)))) {
      throw new Error('PUBLIC_URL must be an HTTPS origin (or HTTP loopback origin for local testing)');
    }
    configuredPublicUrl = parsed.origin;
  }

  const uploadDir = path.join(dataDir, 'uploads');
  const db: DatabaseAdapter = optionsDb || createDatabase({ dataDir, databaseUrl });
  const storage: StorageService = createStorage({ uploadDir, supabaseUrl, supabaseServiceKey });
  const supabaseVerifier = optionsSupabaseVerifier !== undefined
    ? optionsSupabaseVerifier
    : (supabaseUrl && (supabaseServiceKey || supabaseAnonKey))
      ? new SupabaseAuthVerifier(supabaseUrl, (supabaseServiceKey || supabaseAnonKey)!)
      : null;
  // Hosted Mode trusts only verified Supabase identities. Local username/password accounts,
  // relay_session cookies and local session bearer tokens are rejected everywhere.
  const isHostedMode = Boolean(db.isPostgres && supabaseUrl && supabaseAnonKey);
  // Durable, cross-instance logout: a signed-out JWT's session_id no longer exists in auth.sessions.
  if (supabaseVerifier && db.isAuthSessionActive) supabaseVerifier.setSessionCheck((sessionId, userId) => db.isAuthSessionActive!(sessionId, userId));

  const app = express();
  if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
  const httpServer = createServer(app);
  const allowedOrigins = new Set(origins);
  const originAllowed = (origin: string | undefined, host?: string) =>
    !origin || allowedOrigins.has(origin) || allowedOrigins.has('*') || (() => { try { return new URL(origin).host === host; } catch { return false; } })();

  const io = new SocketServer(httpServer, {
    maxHttpBufferSize: 256_000,
    cors: {
      origin: (origin, callback) => callback(null, originAllowed(origin, undefined)),
      credentials: true,
    },
    allowRequest: (request, callback) => callback(null, originAllowed(request.headers.origin, request.headers.host)),
  });

  const voice = new Map<string, VoicePeer>();
  // Volatile subscriptions are scoped to sockets and a particular capture session.
  const streamSubscriptions = new Map<string, Map<string, string>>();
  const limits = new Map<string, { count: number; until: number }>();
  const rate = (key: string, maximum = 120, window = 60_000) => {
    const bucket = limits.get(key);
    if (!bucket || bucket.until <= now()) { limits.set(key, { count: 1, until: now() + window }); return; }
    if (++bucket.count > maximum) throw new ApiError(429, 'Too many requests. Try again shortly.');
  };

  // Access tokens explicitly logged out stay rejected until they would have expired anyway.
  const revokedAccessTokens = new Map<string, number>();
  const observedAccessTokens = new Map<string, { userId: string; sessionId?: string; expiresAt: number }>();
  const observeToken = (token: string, userId: string) => observedAccessTokens.set(tokenHash(token), { userId, sessionId: SupabaseAuthVerifier.tokenSessionId(token), expiresAt: SupabaseAuthVerifier.tokenExpiresAt(token) ?? now() + 3600_000 });
  const tokenRevoked = (hash: string | undefined) => Boolean(hash) && (revokedAccessTokens.get(hash!) ?? 0) > now();
  // Socket.IO does not await async listeners. Track socket work so close() can drain it before the pool ends.
  const pendingWork = new Set<Promise<unknown>>();
  const track = (work: Promise<unknown>) => {
    pendingWork.add(work);
    work.catch(() => {}).finally(() => pendingWork.delete(work));
  };
  let closing = false;
  const supabaseRecheckMs = 120_000;

  const maintenance = async () => {
    for (const [key, value] of limits) if (value.until < now()) limits.delete(key);
    for (const [hash, expiresAt] of revokedAccessTokens) if (expiresAt <= now()) revokedAccessTokens.delete(hash);
    for (const [hash, value] of observedAccessTokens) if (value.expiresAt <= now()) observedAccessTokens.delete(hash);
    await db.deleteExpiredSessions(now()).catch(() => {});
    for (const socket of io.sockets.sockets.values()) {
      if (closing) return;
      if (socket.data.sessionHash) {
        // A database error is not proof that the session ended; only a definitive miss disconnects.
        const valid = await db.hasValidSession(socket.data.sessionHash, now()).catch(() => true);
        if (!valid) socket.disconnect(true);
      } else if (socket.data.supabaseToken && supabaseVerifier) {
        if (!supabaseSocketCurrent(socket)) { socket.disconnect(true); continue; }
        if (now() - socket.data.verifiedAt < supabaseRecheckMs) continue;
        // Detects provider-side revocation (sign-out elsewhere, deleted/banned user). Outages keep the socket.
        const result = await supabaseVerifier.verifyAccessTokenWithDetails(socket.data.supabaseToken);
        if (result.user?.id === socket.data.userId) socket.data.verifiedAt = now();
        else if (!result.unavailable) socket.disconnect(true);
      }
    }
  };
  let maintenanceRunning = false;
  const cleanupTimer = setInterval(() => {
    // Provider rechecks are sequential network calls; never let a slow pass overlap the next tick.
    if (maintenanceRunning) return;
    maintenanceRunning = true;
    track(maintenance().finally(() => { maintenanceRunning = false; }));
  }, 60_000);
  cleanupTimer.unref();

  const supabaseSocketCurrent = (socket: Socket) =>
    !tokenRevoked(socket.data.supabaseTokenHash) && (socket.data.supabaseTokenExpiresAt ?? Infinity) > now();

  const connected = (userId: string) => [...io.sockets.sockets.values()].some(socket => socket.data.userId === userId);

  const publicUser = (row: UserRow, privateFields = false, online = connected(row.id)): User => ({
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    bio: row.bio,
    avatar: row.avatar,
    status: online ? row.status : 'offline',
    createdAt: row.createdAt,
    ...(privateFields ? { settings: JSON.parse(row.settings) } : {}),
  });

  const user = async (userId: string, privateFields = false): Promise<User> => {
    const row = await db.getUser(userId);
    if (!row) throw new ApiError(404, 'User not found');
    return publicUser(row, privateFields);
  };

  /** Batch profile lookup preserving the requested order; unknown ids are skipped. */
  const users = async (userIds: string[]): Promise<User[]> => {
    const rows = new Map((await db.getUsers([...new Set(userIds)])).map(row => [row.id, row]));
    const online = new Set([...io.sockets.sockets.values()].map(socket => socket.data.userId));
    return userIds.flatMap(userId => rows.has(userId) ? [publicUser(rows.get(userId)!, false, online.has(userId))] : []);
  };

  const resolveUser = async (cookie?: string, authHeader?: string): Promise<{ userId: string; viaSupabase: boolean } | undefined> => {
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7).trim();
      if (supabaseVerifier && !tokenRevoked(tokenHash(token))) {
        const verifiedResult = await supabaseVerifier.verifyAccessTokenWithDetails(token);
        if (verifiedResult.unconfirmedEmail) {
          throw new ApiError(403, 'Email address must be verified before signing in');
        }
        if (verifiedResult.user) {
          observeToken(token, verifiedResult.user.id);
          await supabaseVerifier.ensureHavenUser(db, verifiedResult.user);
          if (tokenRevoked(tokenHash(token))) return undefined;
          return { userId: verifiedResult.user.id, viaSupabase: true };
        }
        if (verifiedResult.signedOut) {
          revokedAccessTokens.set(tokenHash(token), SupabaseAuthVerifier.tokenExpiresAt(token) ?? now() + 3600_000);
          return undefined;
        }
        // 503 lets clients retry instead of treating a provider outage as a sign-out.
        if (verifiedResult.unavailable && isHostedMode) throw new ApiError(503, 'Sign-in is temporarily unavailable. Try again shortly.');
      }
      if (isHostedMode) return undefined;
      const fromToken = await db.getSessionUserId(tokenHash(token), now());
      if (fromToken) return { userId: fromToken, viaSupabase: false };
    }
    if (isHostedMode) return undefined;
    const token = parseCookies(cookie).relay_session;
    const fromCookie = token ? await db.getSessionUserId(tokenHash(token), now()) : undefined;
    return fromCookie ? { userId: fromCookie, viaSupabase: false } : undefined;
  };

  const member = async (userId: string, serverId: string, moderate = false) => {
    const found = await db.getMember(serverId, userId);
    if (!found || (moderate && !['owner', 'admin'].includes(found.role))) throw new ApiError(403, 'Server permission denied');
    return found;
  };

  const channel = async (userId: string, channelId: string, moderate = false) => {
    const found = await db.getChannel(channelId);
    if (!found) throw new ApiError(404, 'Channel not found');
    await member(userId, found.serverId, moderate);
    return found;
  };

  const blockedPair = async (first: string, second: string) => db.isBlockedPair(first, second);

  const conversationContact = async (userId: string, conversationId: string) => {
    const memberIds = await db.getConversationMemberIds(conversationId);
    if (memberIds.length === 2 && memberIds.some(targetId => targetId !== userId) && (await Promise.all(memberIds.filter(id => id !== userId).map(targetId => blockedPair(userId, targetId)))).some(Boolean)) {
      throw new ApiError(403, 'Direct messaging is unavailable because one of you blocked the other');
    }
  };

  const scope = async (userId: string, value: { channelId?: string | null; conversationId?: string | null }, textOnly = false, contact = false) => {
    if (Boolean(value.channelId) === Boolean(value.conversationId)) throw new ApiError(400, 'Choose one message destination');
    if (value.channelId) {
      const found = await channel(userId, value.channelId);
      if (textOnly && found.type !== 'text') throw new ApiError(400, 'Messages require a text channel');
      return `channel:${found.id}`;
    }
    const isMember = await db.isConversationMember(value.conversationId!, userId);
    if (!isMember) throw new ApiError(403, 'Conversation permission denied');
    if (contact) await conversationContact(userId, value.conversationId!);
    return `conversation:${value.conversationId}`;
  };

  /** Loads messages with attachments and reactions in three queries total, preserving `messageIds` order. */
  const messages = async (messageIds: string[]): Promise<Message[]> => {
    if (!messageIds.length) return [];
    const [rows, attachments, reactions] = await Promise.all([
      db.getMessagesByIds(messageIds), db.getAttachmentsForMessages(messageIds), db.getReactionsForMessages(messageIds),
    ]);
    const found = new Map(rows.map(row => [row.id, row]));
    return messageIds.flatMap(messageId => {
      const row = found.get(messageId);
      if (!row) return [];
      const reactionsMap = new Map<string, string[]>();
      for (const reaction of reactions) {
        if (reaction.messageId === messageId) reactionsMap.set(reaction.emoji, [...(reactionsMap.get(reaction.emoji) ?? []), reaction.userId]);
      }
      return [{
        ...row,
        attachments: attachments.filter(item => item.messageId === messageId).map(({ messageId: _owner, ...item }) => ({ ...item, url: `/api/attachments/${item.id}` })),
        reactions: [...reactionsMap].map(([emoji, userIds]) => ({ emoji, userIds })),
      }];
    });
  };

  const message = async (messageId: string): Promise<Message> => {
    const [found] = await messages([messageId]);
    if (!found) throw new ApiError(404, 'Message not found');
    return found;
  };

  const conversation = async (conversationId: string) => {
    const conv = await db.getConversation(conversationId);
    if (!conv) throw new ApiError(404, 'Conversation not found');
    return conv;
  };

  const serverAudience = async (serverId: string) => db.getServerAudience(serverId);

  const scopeAudience = async (value: { channelId?: string | null; conversationId?: string | null }) => {
    if (value.channelId) {
      const ch = await db.getChannel(value.channelId);
      return ch ? serverAudience(ch.serverId) : [];
    }
    return db.getConversationMemberIds(value.conversationId!);
  };

  const emitUsers = (userIds: string[], event: string, data?: unknown) => {
    for (const userId of new Set(userIds)) io.to(`user:${userId}`).emit(event, data);
  };

  const syncServer = async (serverId: string) => emitUsers(await serverAudience(serverId), 'sync');

  const emitMessage = async (value: Message, updated = false) => emitUsers(await scopeAudience(value), updated ? 'message:update' : 'message', value);

  // Synchronous half of leaving voice. voice:join uses it so that the capacity check, room switch
  // and insertion happen without an intervening await (no other socket's join can interleave).
  const detachVoice = (socket: Socket) => {
    const current = voice.get(socket.id);
    if (!current) return undefined;
    for (const [viewerId, subscriptions] of streamSubscriptions) {
      if (viewerId === socket.id) {
        subscriptions.forEach((broadcastId, target) => io.to(target).emit('voice:stream-unwatch', { viewerSocketId: socket.id, broadcastId }));
        streamSubscriptions.delete(viewerId);
      } else {
        subscriptions.delete(socket.id);
        if (!subscriptions.size) streamSubscriptions.delete(viewerId);
      }
    }
    socket.leave(`voice:${current.channelId}`);
    voice.delete(socket.id);
    io.to(`voice:${current.channelId}`).emit('voice:peer-left', { socketId: socket.id });
    return current;
  };

  const leaveVoice = async (socket: Socket) => {
    const current = detachVoice(socket);
    if (!current) return;
    const ch = await db.getChannel(current.channelId);
    if (ch) await syncServer(ch.serverId);
  };

  const revoke = async (userId: string, serverId: string, reason = 'membership-revoked') => {
    let disconnectedCount = 0;
    for (const socket of io.sockets.sockets.values()) {
      if (socket.data.userId === userId) {
        const current = voice.get(socket.id);
        if (current) {
          const ch = await db.getChannel(current.channelId);
          if (ch?.serverId === serverId) {
            socket.emit('voice:disconnect', { reason });
            await leaveVoice(socket);
            disconnectedCount++;
          }
        }
      }
    }
    return disconnectedCount;
  };

  const api = (handler: (request: AuthRequest, response: Response) => unknown) => (request: Request, response: Response, next: NextFunction) => {
    try { Promise.resolve(handler(request as AuthRequest, response)).catch(next); } catch (error) { next(error); }
  };

  app.disable('x-powered-by');
  app.use((request, response, next) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'same-origin');
    const origin = request.headers.origin;
    if (!originAllowed(origin, request.headers.host)) return response.status(403).json({ error: 'Origin not allowed' });
    if (origin && (allowedOrigins.has(origin) || allowedOrigins.has('*'))) {
      response.setHeader('Access-Control-Allow-Origin', origin);
      response.setHeader('Access-Control-Allow-Credentials', 'true');
      response.setHeader('Vary', 'Origin');
    }
    if (request.method === 'OPTIONS') {
      response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      response.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE');
      return response.sendStatus(204);
    }
    next();
  });
  app.use(express.json({ limit: '128kb' }));

  app.get('/health', (_request, response) => response.json({ ok: true, version: HAVEN_VERSION }));
  app.get('/api/health', (_request, response) => response.json({ ok: true, version: HAVEN_VERSION, ...(configuredPublicUrl ? { webUrl: configuredPublicUrl } : {}) }));
  // Readiness, unlike liveness (/api/health), proves the database answers. Use it for platform health
  // checks and deploy postflight; it reports whether durable hosted logout enforcement is installed.
  app.get('/api/ready', async (_request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    if (closing) return response.status(503).json({ ok: false, reason: 'shutting-down' });
    try {
      await Promise.race([db.checkConnection(), new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000).unref())]);
      const sessionRevocation = isHostedMode && db.isAuthSessionActive
        ? (await db.isAuthSessionActive('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000000').catch(() => undefined)) === undefined ? 'unavailable' : 'enforced'
        : undefined;
      response.json({ ok: true, version: HAVEN_VERSION, database: 'ok', ...(sessionRevocation ? { sessionRevocation } : {}) });
    } catch {
      response.status(503).json({ ok: false, database: 'unavailable' });
    }
  });
  app.get('/api/config', (_request, response) => response.json({
    capabilities: { streamSubscriptions: 1 },
    ...(configuredPublicUrl ? { publicUrl: configuredPublicUrl } : {}),
    ...(isHostedMode ? {
      mode: 'hosted',
      supabaseUrl,
      supabaseAnonKey,
    } : { mode: 'local' }),
  }));

  const validInvite = async (code: string) => {
    const found = await db.getInvite(code);
    assertActiveInvite(found);
    return found;
  };

  app.get('/api/invites/:code', api(async (request, response) => {
    rate(`invite-preview:${request.ip}`, 60);
    const found = await validInvite(request.params.code as string);
    const community = await db.getServer(found.serverId);
    if (!community) throw new ApiError(404, 'Community not found');
    response.setHeader('Cache-Control', 'no-store');
    response.json({ community: { name: community.name, icon: community.icon }, expiresAt: found.expiresAt });
  }));

  const cookieSameSite = (process.env.COOKIE_SAMESITE as 'strict' | 'lax' | 'none') || (process.env.CROSS_SITE_COOKIES === 'true' ? 'none' : 'strict');
  const getCookieOptions = (req: Request) => ({
    httpOnly: true,
    sameSite: cookieSameSite,
    secure: cookieSameSite === 'none' ? true : (req.secure || process.env.SECURE_COOKIES === '1'),
    path: '/',
  });

  const issueSession = async (request: Request, response: Response, userId: string, rememberSession = true) => {
    const token = randomBytes(32).toString('hex');
    await db.createSession(tokenHash(token), userId, now() + 30 * 24 * 3600_000);
    response.cookie('relay_session', token, { ...getCookieOptions(request), ...(rememberSession ? { maxAge: 30 * 24 * 3600_000 } : {}) });
  };

  const username = z.string().trim().min(3).max(32).regex(usernameExpression, 'Usernames use letters, numbers, underscores, dots or hyphens');
  const credentials = z.object({ username, password: z.string().min(8).max(128), displayName: z.preprocess(value => typeof value === 'string' && !value.trim() ? undefined : value, text(50).optional()) });
  const loginCredentials = z.object({ username: z.string().max(128).transform(normalizeLoginUsername).pipe(username), password: z.string().min(1).max(128), rememberSession: z.boolean().default(true) });

  const localAccountsOnly = (_request: Request, response: Response, next: NextFunction) => {
    if (isHostedMode) return response.status(403).json({ error: 'This Haven server uses hosted accounts. Sign in with your email address instead.' });
    next();
  };

  app.post('/api/auth/register', localAccountsOnly, api(async (request, response) => {
    rate(`auth:${request.ip}`, 20, 3600_000);
    const body = credentials.parse(request.body);
    const existing = await db.getUserByUsername(body.username);
    if (existing) throw new ApiError(409, 'Username is already taken');
    const userId = id();
    const salt = randomBytes(16).toString('hex');
    const hashed = await passwordHash(body.password, salt);
    const again = await db.getUserByUsername(body.username);
    if (again) throw new ApiError(409, 'Username is already taken');
    await db.createUser({
      id: userId,
      username: body.username,
      displayName: body.displayName ?? body.username,
      password: `${salt}:${hashed.toString('hex')}`,
      createdAt: now(),
    });
    await issueSession(request, response, userId);
    response.status(201).json({ user: await user(userId, true) });
  }));

  app.post('/api/auth/login', localAccountsOnly, api(async (request, response) => {
    rate(`auth:${request.ip}`, 40, 3600_000);
    const body = loginCredentials.parse(request.body);
    const found = await db.getUserByUsername(body.username);
    const [salt, expected] = found?.password?.split(':') ?? ['missing-account-salt', '00'.repeat(64)];
    const actual = await passwordHash(body.password, salt);
    if (!found || !expected || !timingSafeEqual(actual, Buffer.from(expected, 'hex'))) {
      throw new ApiError(401, 'Invalid username or password');
    }
    await issueSession(request, response, found.id, body.rememberSession);
    response.json({ user: await user(found.id, true) });
  }));

  app.use('/api', async (request: AuthRequest, response, next) => {
    try {
      const identity = await resolveUser(request.headers.cookie, request.headers.authorization);
      if (!identity) return response.status(401).json({ error: 'Sign in to continue' });
      request.userId = identity.userId;
      request.viaSupabase = identity.viaSupabase;
      rate(`api:${request.userId}`, 300);
      const profile = request.profile = await user(request.userId, true);
      const onboardingRoute = ['/auth/me', '/auth/logout', '/bootstrap', '/users/me/profile', '/users/me/avatar', '/users/username-available'].includes(request.path)
        || (request.method === 'GET' && /^\/users\/[^/]+\/avatar$/.test(request.path));
      if (profile.settings?.profileCompleted === false && !onboardingRoute) {
        return response.status(403).json({ error: 'Complete your profile to continue' });
      }
      next();
    } catch (error) { next(error); }
  });

  // Hosted logout ends only the current provider session (this device) unless the client explicitly asks
  // for `scope: 'global'` (every device of the account). Refreshed tokens share their session's session_id.
  const logoutScope = z.object({ scope: z.enum(['local', 'global']).default('local') });

  app.post('/api/auth/logout', api(async (request, response) => {
    const scope = logoutScope.parse(request.body ?? {}).scope;
    const token = parseCookies(request.headers.cookie).relay_session;
    if (token) await db.deleteSession(tokenHash(token));
    const headerToken = request.headers.authorization?.startsWith('Bearer ') ? request.headers.authorization.slice(7).trim() : null;
    if (headerToken) {
      await db.deleteSession(tokenHash(headerToken));
      if (supabaseVerifier) {
        supabaseVerifier.invalidateToken(headerToken);
        if (request.viaSupabase) revokedAccessTokens.set(tokenHash(headerToken), SupabaseAuthVerifier.tokenExpiresAt(headerToken) ?? now() + 3600_000);
      }
    }
    const loggedOut = new Set([token, headerToken].filter((value): value is string => Boolean(value)).map(tokenHash));
    // The provider accepted headerToken for this request, so its session_id claim is authentic.
    const sessionId = request.viaSupabase && headerToken ? SupabaseAuthVerifier.tokenSessionId(headerToken) : undefined;
    const endsSession = (userId: string, tokenSessionId: string | undefined) => Boolean(request.viaSupabase) && userId === request.userId
      && (scope === 'global' || (sessionId !== undefined && tokenSessionId === sessionId));
    for (const [hash, value] of observedAccessTokens) {
      if (endsSession(value.userId, value.sessionId)) revokedAccessTokens.set(hash, value.expiresAt);
    }
    for (const socket of io.sockets.sockets.values()) {
      // Every hosted socket of the ended session(s) closes too, including sockets authenticated with
      // older or refreshed access tokens. Other devices keep their sockets on a local-scope logout.
      if (loggedOut.has(socket.data.sessionHash) || loggedOut.has(socket.data.supabaseTokenHash)
        || (socket.data.supabaseToken && endsSession(socket.data.userId, SupabaseAuthVerifier.tokenSessionId(socket.data.supabaseToken)))) {
        if (socket.data.supabaseToken) {
          supabaseVerifier?.invalidateToken(socket.data.supabaseToken);
          revokedAccessTokens.set(socket.data.supabaseTokenHash, socket.data.supabaseTokenExpiresAt ?? now() + 3600_000);
        }
        socket.disconnect(true);
      }
    }
    // Also end the provider session(s) server-side, so the logout is durable (auth.sessions) and seen by
    // every backend instance even if the client never completes its own Supabase sign-out. Bounded so an
    // unreachable provider cannot hang logout; local revocation above has already taken effect.
    const providerSignedOut = request.viaSupabase && headerToken && supabaseVerifier
      ? await Promise.race([supabaseVerifier.revokeProviderSessions(headerToken, scope), new Promise<boolean>(resolve => setTimeout(() => resolve(false), 5000).unref())])
      : undefined;
    response.clearCookie('relay_session', getCookieOptions(request));
    response.json({ ok: true, ...(providerSignedOut === undefined ? {} : { providerSignedOut, scope }) });
  }));

  app.get('/api/auth/me', api(async (request, response) => response.json({ user: await user(request.userId!, true) })));

  app.get('/api/bootstrap', api(async (request, response) => {
    const userId = request.userId!;
    const me = request.profile ?? await user(userId, true);
    if (me.settings?.profileCompleted === false) {
      return response.json({ user: me, servers: [], channels: [], conversations: [], requests: [], friends: [], blocked: [], users: [me], voice: [], serverEmojis: [] });
    }
    // Constant query count regardless of community/conversation size.
    const [servers, channels, conversations, requests, friends, blocked, visibleIds, emojiRows] = await Promise.all([
      db.getUserServers(userId), db.getUserChannels(userId), db.getUserConversations(userId), db.getFriendRequests(userId),
      db.getFriends(userId), db.getBlocked(userId), db.getVisibleUsers(userId), db.getUserServerEmojis(userId),
    ]);
    const visibleUsers = await users(visibleIds);
    const serverEmojis = emojiRows.map(serverEmoji);

    response.json({
      user: me,
      servers,
      channels,
      conversations,
      requests,
      friends,
      blocked,
      users: visibleUsers,
      voice: [...voice.values()].filter(peer => channels.some(row => row.id === peer.channelId)),
      serverEmojis,
    });
  }));

  app.patch('/api/users/me', api(async (request, response) => {
    const body = z.object({
      displayName: text(50).optional(),
      bio: z.string().max(500).optional(),
      avatar: z.string().max(300).optional(),
      status: z.enum(['online', 'idle', 'dnd', 'offline']).optional(),
      settings: z.record(z.string(), z.unknown()).optional(),
    }).parse(request.body);

    if (body.settings && Object.hasOwn(body.settings, 'profileCompleted')) throw new ApiError(400, 'Profile completion can only be changed through onboarding');
    await db.updateUser(request.userId!, {
      displayName: body.displayName,
      bio: body.bio,
      avatar: body.avatar,
      status: body.status,
      settings: body.settings ? JSON.stringify(body.settings) : undefined,
    });

    const profile = await user(request.userId!);
    for (const peer of voice.values()) if (peer.user.id === request.userId) peer.user = profile;
    const audience = await db.getVisibleUsers(request.userId!);
    if (body.avatar !== undefined || body.displayName !== undefined || body.bio !== undefined || body.status !== undefined) {
      emitUsers(audience, 'user:update', profile);
    }
    emitUsers(body.avatar !== undefined || body.displayName !== undefined || body.bio !== undefined || body.status !== undefined ? audience : [request.userId!], 'sync');
    if (body.status !== undefined) emitUsers(audience, 'presence', { userId: request.userId, status: profile.status });
    response.json({ user: await user(request.userId!, true) });
  }));

  app.get('/api/users/username-available', api(async (request, response) => {
    rate(`username-check:${request.userId}`, 60);
    const candidate = z.string().max(128).parse(request.query.username ?? '').trim().replace(/^@/, '');
    const problem = usernameProblem(candidate);
    if (problem) return response.json({ available: false, reason: problem });
    const found = await db.getUserByUsername(candidate);
    const available = !found || found.id === request.userId;
    response.json({ available, ...(available ? {} : { reason: 'That username is already taken' }) });
  }));

  // First-time onboarding: username and display name are chosen once, after authentication, and the
  // completion flag is stored with the account so it persists across sessions and devices.
  app.post('/api/users/me/profile', api(async (request, response) => {
    rate(`profile:${request.userId}`, 20);
    const body = z.object({ username: z.string().max(128), displayName: text(50) }).parse(request.body);
    const chosen = body.username.trim().replace(/^@/, '');
    const problem = usernameProblem(chosen);
    if (problem) throw new ApiError(400, `Username: ${problem}`);
    const current = await user(request.userId!, true);
    if (current.settings?.profileCompleted !== false) throw new ApiError(409, 'Your profile is already complete');
    const result = await db.completeUserProfile(request.userId!, chosen, body.displayName);
    if (result === 'unavailable') throw new ApiError(409, 'That username is already taken');
    if (result === 'already-complete') throw new ApiError(409, 'Your profile is already complete');
    const profile = await user(request.userId!);
    for (const peer of voice.values()) if (peer.user.id === request.userId) peer.user = profile;
    const audience = await db.getVisibleUsers(request.userId!);
    emitUsers(audience, 'user:update', profile);
    emitUsers(audience, 'sync');
    response.json({ user: await user(request.userId!, true) });
  }));

  const avatarUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1024 * 1024, files: 1, fields: 0 } });
  const avatarUrlPattern = (userId: string) => new RegExp(`^/api/users/${userId}/avatar\\?v=([a-f0-9-]+\\.(?:png|jpg|webp|gif))$`);
  const avatarExtension: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };

  app.post('/api/users/me/avatar', (request: AuthRequest, _response, next) => {
    try { rate(`upload:${request.userId}`, 20); next(); } catch (error) { next(error); }
  }, avatarUpload.single('file'), api(async (request, response) => {
    if (!request.file) throw new ApiError(400, 'Choose a profile picture up to 1 MB');
    let info;
    try { info = inspectRaster(request.file.buffer, 2048); } catch (error) { throw new ApiError(400, error instanceof Error ? error.message : 'Invalid image'); }
    if (info.animated) throw new ApiError(400, 'Profile pictures must be static images');
    const userId = request.userId!;
    const version = `${id()}.${avatarExtension[info.mime]}`;
    const diskName = `avatar-${version}`;
    const previous = (await db.getUser(userId))?.avatar.match(avatarUrlPattern(userId))?.[1];
    try {
      await storage.upload('avatars', diskName, request.file.buffer, info.mime);
      await db.updateUser(userId, { avatar: `/api/users/${userId}/avatar?v=${version}` });
    } catch (error) {
      await storage.remove('avatars', diskName);
      throw error;
    }
    if (previous) await storage.remove('avatars', `avatar-${previous}`);
    const profile = await user(userId);
    for (const peer of voice.values()) if (peer.user.id === userId) peer.user = profile;
    const audience = await db.getVisibleUsers(userId);
    emitUsers(audience, 'user:update', profile);
    emitUsers(audience, 'sync');
    response.json({ user: await user(userId, true) });
  }));

  app.get('/api/users/:id/avatar', api(async (request, response) => {
    const userId = request.params.id as string;
    const found = await db.getUser(userId);
    const version = found?.avatar.match(avatarUrlPattern(userId))?.[1];
    if (!found || !version) throw new ApiError(404, 'Profile picture not found');
    await serveFile(response, 'avatars', { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' }[version.split('.')[1]] ?? 'application/octet-stream', `avatar-${version}`);
  }));

  const iconValue = z.string().trim().max(300).refine(value => !value || value.startsWith('/api/servers/') || (value.length <= 32 && !/[\/:<>]/.test(value)) || (() => { try { const parsed = new URL(value); return parsed.protocol === 'https:' && !parsed.username && !parsed.password; } catch { return false; } })(), 'Use an HTTPS image URL, emoji or uploaded icon');

  app.post('/api/servers', api(async (request, response) => {
    const body = z.object({ name: text(80), icon: iconValue.optional(), description: z.string().max(1000).optional() }).parse(request.body);
    if (body.icon?.startsWith('/api/')) throw new ApiError(400, 'Create the server before uploading an icon');
    const serverId = id();
    const channelId = id();
    const voiceChannelId = id();
    await db.createServer(
      { id: serverId, name: body.name, icon: body.icon ?? '', description: body.description ?? '', ownerId: request.userId!, createdAt: now() },
      channelId,
      voiceChannelId
    );
    await syncServer(serverId);
    const createdServer = await db.getServer(serverId);
    const createdChannel = await db.getChannel(channelId);
    response.status(201).json({ server: { ...createdServer, role: 'owner' }, channel: createdChannel });
  }));

  app.patch('/api/servers/:id', api(async (request, response) => {
    await member(request.userId!, request.params.id as string, true);
    const body = z.object({ name: text(80).optional(), icon: iconValue.optional(), description: z.string().max(1000).optional() }).parse(request.body);
    const current = await db.getServer(request.params.id as string);
    if (!current) throw new ApiError(404, 'Server not found');
    if (body.icon?.startsWith('/api/') && body.icon !== current.icon) throw new ApiError(400, 'Upload this server’s own icon instead');
    await db.updateServer(request.params.id as string, body);
    if (body.icon !== undefined && body.icon !== current.icon) {
      const { diskName } = await db.deleteServerIcon(current.id);
      if (diskName) {
        await storage.remove('server-icons', diskName);
      }
    }
    await syncServer(current.id);
    response.json({ server: await db.getServer(current.id) });
  }));

  app.delete('/api/servers/:id', api(async (request, response) => {
    const serverId = request.params.id as string;
    const currentMember = await member(request.userId!, serverId);
    if (currentMember.role !== 'owner') throw new ApiError(403, 'Only the owner can delete a server');
    const audience = await serverAudience(serverId);
    for (const userId of audience) await revoke(userId, serverId);
    const { diskNames } = await db.deleteServer(serverId);
    for (const diskName of diskNames) {
      await storage.remove('attachments', diskName);
      await storage.remove('sounds', diskName);
      await storage.remove('server-icons', diskName);
      await storage.remove('emojis', diskName);
    }
    emitUsers(audience, 'sync');
    response.json({ ok: true });
  }));

  app.get('/api/servers/:id/members', api(async (request, response) => {
    await member(request.userId!, request.params.id as string);
    const membersList = await db.getServerMembers(request.params.id as string);
    const profiles = new Map((await users(membersList.map(row => row.userId))).map(profile => [profile.id, profile]));
    const mapped = membersList.filter(row => profiles.has(row.userId)).map(row => ({
      user: profiles.get(row.userId)!,
      role: row.role,
      serverMuted: row.serverMuted,
      serverDeafened: row.serverDeafened,
    }));
    response.json({ members: mapped });
  }));

  app.post('/api/servers/:id/members/:userId/voice', api(async (request, response) => {
    const serverId = request.params.id as string;
    const targetId = request.params.userId as string;
    const actor = await member(request.userId!, serverId, true);
    const target = await member(targetId, serverId);
    if (targetId === request.userId || target.role === 'owner' || (actor.role === 'admin' && target.role === 'admin')) {
      throw new ApiError(403, 'Cannot moderate this member');
    }
    const body = z.object({ action: z.enum(['disconnect', 'mute', 'deafen']), enabled: z.boolean().default(true) }).parse(request.body);
    if (body.action === 'disconnect') {
      const disconnected = await revoke(targetId, serverId, 'moderator-disconnected');
      if (disconnected === 0) {
        throw new ApiError(400, 'Member is not connected to voice');
      }
    } else {
      await db.updateMemberVoice(serverId, targetId, { [body.action === 'mute' ? 'serverMuted' : 'serverDeafened']: body.enabled });
      const flags = (await member(targetId, serverId))!;
      const moderation = { serverId, muted: flags.serverMuted, deafened: flags.serverDeafened };
      emitUsers([targetId], 'voice:moderated', moderation);
      for (const peer of voice.values()) {
        if (peer.user.id === targetId) {
          const ch = await db.getChannel(peer.channelId);
          if (ch?.serverId === serverId) {
            peer.serverMuted = moderation.muted;
            peer.serverDeafened = moderation.deafened;
            peer.muted ||= moderation.muted || moderation.deafened;
            peer.deafened ||= moderation.deafened;
            peer.speaking = false;
            emitUsers(await serverAudience(serverId), 'voice:state', {
              socketId: peer.socketId,
              channelId: peer.channelId,
              muted: peer.muted,
              deafened: peer.deafened,
              sharing: peer.sharing,
              speaking: false,
              serverMuted: peer.serverMuted,
              serverDeafened: peer.serverDeafened,
            });
          }
        }
      }
    }
    await syncServer(serverId);
    response.json({ ok: true });
  }));

  app.patch('/api/servers/:id/members/:userId', api(async (request, response) => {
    const serverId = request.params.id as string;
    const target = request.params.userId as string;
    const actor = await member(request.userId!, serverId);
    if (actor.role !== 'owner') throw new ApiError(403, 'Only owners can manage roles');
    const targetMember = await member(target, serverId);
    if (targetMember.role === 'owner') throw new ApiError(400, 'Owner role cannot be changed');
    const body = z.object({ role: z.enum(['admin', 'member']) }).parse(request.body);
    await db.updateMemberRole(serverId, target, body.role);
    await syncServer(serverId);
    response.json({ ok: true });
  }));

  app.delete('/api/servers/:id/members/:userId', api(async (request, response) => {
    const serverId = request.params.id as string;
    const target = request.params.userId as string;
    const actor = await member(request.userId!, serverId);
    const victim = await member(target, serverId);
    if (victim.role === 'owner' || (target !== request.userId && (actor.role === 'member' || (actor.role === 'admin' && victim.role === 'admin')))) {
      throw new ApiError(403, 'Cannot remove this member');
    }
    await revoke(target, serverId);
    await db.removeMember(serverId, target);
    await syncServer(serverId);
    emitUsers([target], 'sync');
    response.json({ ok: true });
  }));

  app.post('/api/servers/:id/invites', api(async (request, response) => {
    await member(request.userId!, request.params.id as string, true);
    const body = z.object({ expiresInHours: z.number().int().min(1).max(720).nullable().default(168) }).parse(request.body ?? {});
    const code = randomBytes(9).toString('base64url');
    const createdAt = now();
    const expiresAt = body.expiresInHours === null ? null : createdAt + body.expiresInHours * 3600_000;
    await db.createInvite({ code, serverId: request.params.id as string, createdAt, expiresAt });
    emitUsers(await serverAudience(request.params.id as string), 'invites:changed', { serverId: request.params.id });
    response.status(201).json({ code, expiresAt });
  }));

  app.get('/api/servers/:id/invites', api(async (request, response) => {
    await member(request.userId!, request.params.id as string, true);
    const list = await db.getServerInvites(request.params.id as string);
    response.json({ invites: list });
  }));

  app.delete('/api/invites/:code', api(async (request, response) => {
    const found = await db.getInvite(request.params.code as string);
    if (!found) throw new ApiError(404, 'Invite not found');
    await member(request.userId!, found.serverId, true);
    await db.revokeInvite(found.code, now());
    emitUsers(await serverAudience(found.serverId), 'invites:changed', { serverId: found.serverId, revokedCode: found.code });
    response.json({ ok: true });
  }));

  app.post('/api/invites/:code/join', api(async (request, response) => {
    const invitation = await db.joinInvite(request.params.code as string, request.userId!);
    await syncServer(invitation.serverId);
    response.json({ serverId: invitation.serverId });
  }));

  app.post('/api/servers/:id/channels', api(async (request, response) => {
    await member(request.userId!, request.params.id as string, true);
    const body = z.object({ name: text(80), type: z.enum(['text', 'voice']), topic: z.string().max(500).optional() }).parse(request.body);
    const channelId = id();
    const position = await db.getNextChannelPosition(request.params.id as string);
    await db.createChannel({ id: channelId, serverId: request.params.id as string, name: body.name, type: body.type, topic: body.topic ?? '', position });
    await syncServer(request.params.id as string);
    response.status(201).json({ channel: await db.getChannel(channelId) });
  }));

  app.patch('/api/channels/:id', api(async (request, response) => {
    const current = await channel(request.userId!, request.params.id as string, true);
    const body = z.object({ name: text(80).optional(), topic: z.string().max(500).optional(), position: z.number().int().min(0).max(10000).optional() }).parse(request.body);
    await db.updateChannel(current.id, body);
    await syncServer(current.serverId);
    response.json({ channel: await db.getChannel(current.id) });
  }));

  app.delete('/api/channels/:id', api(async (request, response) => {
    const current = await channel(request.userId!, request.params.id as string, true);
    for (const socket of io.sockets.sockets.values()) {
      if (voice.get(socket.id)?.channelId === current.id) {
        socket.emit('voice:disconnect', { reason: 'channel-deleted' });
        await leaveVoice(socket);
      }
    }
    const { diskNames } = await db.deleteChannel(current.id);
    for (const file of diskNames) await storage.remove('attachments', file);
    await syncServer(current.serverId);
    response.json({ ok: true });
  }));

  app.get('/api/messages', api(async (request, response) => {
    const value = scopeSchema.parse(request.query);
    await scope(request.userId!, value, true);
    const limit = z.coerce.number().int().min(1).max(100).default(50).parse(request.query.limit);
    const before = z.coerce.number().int().min(0).default(Number.MAX_SAFE_INTEGER).parse(request.query.before);
    // Optional tie-breaker: continue after this exact message when several share the `before` timestamp.
    const beforeId = z.string().min(1).max(128).optional().parse(request.query.beforeId);
    const query = z.string().max(200).default('').parse(request.query.q);
    const messageIds = await db.getMessages(value, before, query, limit + 1, beforeId);
    const slice = messageIds.slice(0, limit).reverse();
    response.json({ messages: await messages(slice), hasMore: messageIds.length > limit });
  }));

  const validateEmojiTokens = async (userId: string, content: string, channelId?: string | null) => {
    for (const token of content.matchAll(/:hvn_([A-Za-z0-9-]+):/g)) {
      const found = await db.getServerEmoji(token[1]);
      if (!found || !channelId) throw new ApiError(400, 'Custom emojis can only be used in their own server');
      const ch = await channel(userId, channelId);
      if (ch.serverId !== found.serverId) throw new ApiError(400, 'Custom emojis can only be used in their own server');
    }
  };

  app.post('/api/messages', api(async (request, response) => {
    rate(`message:${request.userId}`, 60);
    const body = z.object({
      channelId: z.string().optional(),
      conversationId: z.string().optional(),
      content: z.string().trim().max(4000).default(''),
      replyTo: z.string().nullable().optional(),
      attachmentIds: z.array(z.string()).max(10).default([]).transform(ids => [...new Set(ids)]),
    }).parse(request.body);

    await scope(request.userId!, body, true, true);
    await validateEmojiTokens(request.userId!, body.content, body.channelId);
    if (!body.content && !body.attachmentIds.length) throw new ApiError(400, 'Message cannot be empty');
    if (body.replyTo) {
      const reply = await message(body.replyTo);
      if (reply.channelId !== (body.channelId ?? null) || reply.conversationId !== (body.conversationId ?? null)) {
        throw new ApiError(400, 'Reply must belong to the same conversation');
      }
    }
    for (const attachmentId of body.attachmentIds) {
      const found = await db.getAttachment(attachmentId);
      if (!found || found.uploaderId !== request.userId || found.messageId || found.channelId !== (body.channelId ?? null) || found.conversationId !== (body.conversationId ?? null)) {
        throw new ApiError(403, 'Attachment permission denied');
      }
    }
    const messageId = id();
    await db.createMessage({
      id: messageId,
      channelId: body.channelId,
      conversationId: body.conversationId,
      authorId: request.userId!,
      content: body.content,
      replyTo: body.replyTo,
      attachmentIds: body.attachmentIds,
    });
    const result = await message(messageId);
    await emitMessage(result);
    response.status(201).json({ message: result });
  }));

  app.patch('/api/messages/:id', api(async (request, response) => {
    const found = await message(request.params.id as string);
    await scope(request.userId!, found, false, true);
    if (found.authorId !== request.userId) throw new ApiError(403, 'You can only edit your messages');
    const body = z.object({ content: text(4000) }).parse(request.body);
    await validateEmojiTokens(request.userId!, body.content, found.channelId);
    await db.updateMessage(found.id, body.content, now());
    const result = await message(found.id);
    await emitMessage(result, true);
    response.json({ message: result });
  }));

  app.delete('/api/messages/:id', api(async (request, response) => {
    const found = await message(request.params.id as string);
    await scope(request.userId!, found);
    if (found.authorId !== request.userId) {
      if (!found.channelId) throw new ApiError(403, 'You can only delete your messages');
      await channel(request.userId!, found.channelId, true);
    }
    const audience = await scopeAudience(found);
    const { diskNames } = await db.deleteMessage(found.id);
    for (const file of diskNames) await storage.remove('attachments', file);
    emitUsers(audience, 'message:delete', { id: found.id, channelId: found.channelId, conversationId: found.conversationId });
    response.json({ ok: true });
  }));

  app.post('/api/messages/:id/reactions', api(async (request, response) => {
    const found = await message(request.params.id as string);
    await scope(request.userId!, found, false, true);
    const body = z.object({ emoji: text(64) }).parse(request.body);
    await validateEmojiTokens(request.userId!, body.emoji, found.channelId);
    await db.toggleReaction(found.id, request.userId!, body.emoji);
    const result = await message(found.id);
    await emitMessage(result, true);
    response.json({ message: result });
  }));

  const uploadRate = (request: AuthRequest, _response: Response, next: NextFunction) => {
    try { rate(`upload:${request.userId}`, 20); next(); } catch (error) { next(error); }
  };
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 1, fields: 5 } });
  const imageUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 256 * 1024, files: 2, fields: 1, fieldSize: 128 } });
  const iconUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1024 * 1024, files: 1, fields: 0 } });

  const manageServer = async (request: AuthRequest, _response: Response, next: NextFunction) => {
    try { await member(request.userId!, request.params.id as string, true); next(); } catch (error) { next(error); }
  };

  const raster = (bytes: Buffer, dimension: number) => {
    try { return inspectRaster(bytes, dimension); } catch (error) { throw new ApiError(400, error instanceof Error ? error.message : 'Invalid image'); }
  };

  const serverEmoji = (row: any): ServerEmoji => ({
    id: row.id,
    serverId: row.serverId,
    name: row.name,
    animated: Boolean(row.animated),
    url: `/api/emojis/${row.id}/image`,
    staticUrl: `/api/emojis/${row.id}/static`,
    uploaderId: row.uploaderId,
    createdAt: Number(row.createdAt),
  });

  app.get('/api/servers/:id/emojis', api(async (request, response) => {
    await member(request.userId!, request.params.id as string);
    const list = await db.getServerEmojis(request.params.id as string);
    response.json({ emojis: list.map(serverEmoji) });
  }));

  app.post('/api/servers/:id/emojis', manageServer, uploadRate, imageUpload.fields([{ name: 'file', maxCount: 1 }, { name: 'staticFile', maxCount: 1 }]), api(async (request, response) => {
    const serverId = request.params.id as string;
    const name = z.string().trim().min(2).max(32).regex(/^[A-Za-z0-9_]+$/, 'Emoji names use letters, numbers and underscores').parse(request.body.name);
    const existing = await db.getServerEmojiByName(serverId, name);
    if (existing) throw new ApiError(409, 'An emoji with this name already exists');
    const count = await db.getServerEmojiCount(serverId);
    if (count >= 50) throw new ApiError(400, 'This server already has 50 custom emojis');
    const files = request.files as Record<string, Express.Multer.File[]>;
    const file = files?.file?.[0];
    const fallback = files?.staticFile?.[0];
    if (!file) throw new ApiError(400, 'Choose an emoji image up to 256 KB');
    const info = raster(file.buffer, 128);
    if (info.animated && !fallback) throw new ApiError(400, 'Animated emojis require a static PNG preview');
    if (fallback) {
      const poster = raster(fallback.buffer, 128);
      if (poster.mime !== 'image/png' || poster.animated || poster.width !== info.width || poster.height !== info.height) {
        throw new ApiError(400, 'Static preview must be a non-animated PNG with matching dimensions');
      }
    }
    const emojiId = id();
    const diskName = `emoji-${emojiId}`;
    const staticDiskName = info.animated ? `${diskName}-static` : diskName;
    try {
      await storage.upload('emojis', diskName, file.buffer, info.mime);
      if (info.animated && fallback) {
        await storage.upload('emojis', staticDiskName, fallback.buffer, 'image/png');
      }
      await db.createServerEmoji({
        id: emojiId,
        serverId,
        name,
        animated: info.animated,
        mime: info.mime,
        diskName,
        staticDiskName,
        uploaderId: request.userId!,
        createdAt: now(),
      });
    } catch (error) {
      await storage.remove('emojis', diskName);
      if (staticDiskName !== diskName) await storage.remove('emojis', staticDiskName);
      throw error;
    }
    await syncServer(serverId);
    const created = (await db.getServerEmoji(emojiId))!;
    response.status(201).json({ emoji: serverEmoji(created) });
  }));

  app.patch('/api/emojis/:id', api(async (request, response) => {
    const found = await db.getServerEmoji(request.params.id as string);
    if (!found) throw new ApiError(404, 'Emoji not found');
    await member(request.userId!, found.serverId, true);
    const body = z.object({ name: z.string().trim().min(2).max(32).regex(/^[A-Za-z0-9_]+$/) }).parse(request.body);
    const existing = await db.getServerEmojiByName(found.serverId, body.name);
    if (existing && existing.id !== found.id) throw new ApiError(409, 'An emoji with this name already exists');
    await db.updateServerEmojiName(found.id, body.name);
    await syncServer(found.serverId);
    response.json({ emoji: serverEmoji(await db.getServerEmoji(found.id)) });
  }));

  app.delete('/api/emojis/:id', api(async (request, response) => {
    const found = await db.getServerEmoji(request.params.id as string);
    if (!found) throw new ApiError(404, 'Emoji not found');
    await member(request.userId!, found.serverId, true);
    const { diskName, staticDiskName } = await db.deleteServerEmoji(found.id);
    await storage.remove('emojis', diskName);
    if (diskName !== staticDiskName) await storage.remove('emojis', staticDiskName);
    await syncServer(found.serverId);
    response.json({ ok: true });
  }));

  const serveFile = async (response: Response, bucket: string, mime: string, diskName: string, downloadName?: string) => {
    const downloadInfo = await storage.getDownloadInfo(bucket, diskName, downloadName);
    if (downloadInfo.type === 'redirect' && downloadInfo.url) {
      return response.redirect(downloadInfo.url);
    }
    if (!downloadInfo.filePath || !existsSync(downloadInfo.filePath)) {
      throw new ApiError(404, 'File not found');
    }
    response.setHeader('Content-Type', mime);
    response.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
    response.setHeader('Content-Security-Policy', "default-src 'none'");
    if (downloadName) {
      response.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(downloadName)}`);
    }
    response.sendFile(downloadInfo.filePath);
  };

  app.get('/api/emojis/:id/:variant', api(async (request, response) => {
    const found = await db.getServerEmoji(request.params.id as string);
    if (!found || !['image', 'static'].includes(request.params.variant as string)) throw new ApiError(404, 'Emoji not found');
    await member(request.userId!, found.serverId);
    const poster = request.params.variant === 'static' && found.animated;
    await serveFile(response, 'emojis', poster ? 'image/png' : found.mime, request.params.variant === 'static' ? found.staticDiskName : found.diskName);
  }));

  app.post('/api/servers/:id/icon', manageServer, uploadRate, iconUpload.single('file'), api(async (request, response) => {
    if (!request.file) throw new ApiError(400, 'Choose a static server icon up to 1 MB');
    const info = raster(request.file.buffer, 1024);
    if (info.animated) throw new ApiError(400, 'Server icons must be static images');
    const serverId = request.params.id as string;
    const diskName = `icon-${id()}`;
    try {
      await storage.upload('server-icons', diskName, request.file.buffer, info.mime);
      const { previousDiskName } = await db.upsertServerIcon(serverId, info.mime, diskName, `/api/servers/${serverId}/icon?v=${diskName.slice(5)}`);
      if (previousDiskName) await storage.remove('server-icons', previousDiskName);
    } catch (error) {
      await storage.remove('server-icons', diskName);
      throw error;
    }
    await syncServer(serverId);
    response.json({ server: await db.getServer(serverId) });
  }));

  app.get('/api/servers/:id/icon', api(async (request, response) => {
    await member(request.userId!, request.params.id as string);
    const found = await db.getServerIcon(request.params.id as string);
    if (!found) throw new ApiError(404, 'Server icon not found');
    await serveFile(response, 'server-icons', found.mime, found.diskName);
  }));

  app.post('/api/attachments', uploadRate, upload.single('file'), api(async (request, response) => {
    const body = scopeSchema.parse(request.body);
    await scope(request.userId!, body, true, true);
    if (!request.file) throw new ApiError(400, 'Choose a file');
    const attachmentId = id();
    const diskName = `attach-${attachmentId}-${request.file.originalname ? path.basename(request.file.originalname) : 'file'}`;
    const name = path.basename(request.file.originalname || 'file').slice(0, 255);
    try {
      await storage.upload('attachments', diskName, request.file.buffer, request.file.mimetype);
      await db.createAttachment({
        id: attachmentId,
        channelId: body.channelId,
        conversationId: body.conversationId,
        uploaderId: request.userId!,
        name,
        mime: request.file.mimetype,
        size: request.file.size,
        diskName,
      });
      response.status(201).json({
        attachment: {
          id: attachmentId,
          name,
          mime: request.file.mimetype,
          size: request.file.size,
          url: `/api/attachments/${attachmentId}`,
        },
      });
    } catch (error) {
      await storage.remove('attachments', diskName).catch(() => {});
      throw error;
    }
  }));

  app.get('/api/attachments/:id', api(async (request, response) => {
    const found = await db.getAttachment(request.params.id as string);
    if (!found) throw new ApiError(404, 'Attachment not found');
    await scope(request.userId!, found);
    await serveFile(response, 'attachments', found.mime, found.diskName, found.name);
  }));

  app.post('/api/friends/requests', api(async (request, response) => {
    const body = z.object({ username: z.string().trim().transform(value => value.replace(/^@/, '').toLowerCase()).pipe(z.string().regex(/^[a-z0-9_.-]{3,32}$/, 'Enter the account username (3–32 letters, numbers, dots, dashes or underscores)')) }).parse(request.body);
    const target = await db.getUserByUsername(body.username);
    if (!target) throw new ApiError(404, 'User not found');
    if (target.id === request.userId) throw new ApiError(400, 'You cannot friend yourself');
    if (await blockedPair(request.userId!, target.id)) throw new ApiError(403, 'Friend requests are unavailable between these accounts');
    if (await db.isFriend(request.userId!, target.id)) throw new ApiError(409, 'You are already friends');
    const pending = await db.findPendingFriendRequest(request.userId!, target.id);
    if (pending) {
      throw new ApiError(409, pending.toId === request.userId ? 'This person already sent you a request. Accept it in Incoming requests.' : 'You already sent this person a friend request');
    }
    const requestId = id();
    await db.createFriendRequest(requestId, request.userId!, target.id, now());
    const result = await db.getFriendRequest(requestId);
    emitUsers([request.userId!, target.id], 'sync');
    response.status(201).json({ request: result });
  }));

  app.post('/api/friends/requests/:id/accept', api(async (request, response) => {
    const found = await db.getFriendRequest(request.params.id as string);
    if (!found || found.toId !== request.userId) throw new ApiError(403, 'Request permission denied');
    if (await blockedPair(found.fromId, found.toId)) throw new ApiError(403, 'Friend requests are unavailable between these accounts');
    const accepted = await db.acceptFriendRequest(found.id, request.userId!);
    emitUsers([accepted.fromId, accepted.toId], 'sync');
    response.json({ ok: true });
  }));

  app.delete('/api/friends/requests/:id', api(async (request, response) => {
    const found = await db.getFriendRequest(request.params.id as string);
    if (!found || ![found.fromId, found.toId].includes(request.userId!)) throw new ApiError(403, 'Request permission denied');
    await db.deleteFriendRequest(found.id, request.userId!);
    emitUsers([found.fromId, found.toId], 'sync');
    response.json({ ok: true });
  }));

  app.delete('/api/friends/:userId', api(async (request, response) => {
    await db.removeFriend(request.userId!, request.params.userId as string);
    emitUsers([request.userId!, request.params.userId as string], 'sync');
    response.json({ ok: true });
  }));

  app.post('/api/users/:id/block', api(async (request, response) => {
    const target = request.params.id as string;
    if (target === request.userId) throw new ApiError(400, 'You cannot block yourself');
    await user(target);
    await db.addBlock(request.userId!, target, now());
    emitUsers([request.userId!, target], 'sync');
    response.json({ ok: true });
  }));

  app.delete('/api/users/:id/block', api(async (request, response) => {
    await db.removeBlock(request.userId!, request.params.id as string);
    emitUsers([request.userId!, request.params.id as string], 'sync');
    response.json({ ok: true });
  }));

  app.post('/api/conversations', api(async (request, response) => {
    const body = z.object({ memberIds: z.array(z.string()).min(1).max(9), name: z.string().trim().max(80).default('') }).parse(request.body);
    const members = [...new Set([request.userId!, ...body.memberIds])];
    if (members.length < 2) throw new ApiError(400, 'Choose another participant');
    for (const first of members) {
      for (const second of members) {
        if (first !== second && (await blockedPair(first, second))) {
          throw new ApiError(403, 'A blocked account cannot be added to a new conversation');
        }
      }
    }
    for (const target of members.filter(uid => uid !== request.userId)) {
      if (!(await db.isFriend(request.userId!, target))) throw new ApiError(403, 'You may invite friends to conversations');
    }
    if (members.length === 2) {
      const existingId = await db.findDirectConversation(members[0], members[1]);
      if (existingId) return response.json({ conversation: await conversation(existingId) });
    }
    const conversationId = id();
    await db.createConversation(conversationId, body.name, members, now());
    emitUsers(members, 'sync');
    response.status(201).json({ conversation: await conversation(conversationId) });
  }));

  app.patch('/api/conversations/:id', api(async (request, response) => {
    await scope(request.userId!, { conversationId: request.params.id as string }, false, true);
    const body = z.object({ name: text(80) }).parse(request.body);
    await db.updateConversation(request.params.id as string, body.name);
    emitUsers(await scopeAudience({ conversationId: request.params.id as string }), 'sync');
    response.json({ conversation: await conversation(request.params.id as string) });
  }));

  app.delete('/api/conversations/:id/members/me', api(async (request, response) => {
    await scope(request.userId!, { conversationId: request.params.id as string });
    const audience = await scopeAudience({ conversationId: request.params.id as string });
    await db.removeConversationMember(request.params.id as string, request.userId!);
    emitUsers(audience, 'sync');
    response.json({ ok: true });
  }));

  const sound = (row: any) => ({ id: row.id, serverId: row.serverId, uploaderId: row.uploaderId, name: row.name, url: `/api/sounds/${row.id}/audio` });

  app.get('/api/servers/:id/sounds', api(async (request, response) => {
    await member(request.userId!, request.params.id as string);
    const list = await db.getServerSounds(request.params.id as string);
    response.json({ sounds: list.map(sound) });
  }));

  app.post('/api/servers/:id/sounds', (request: AuthRequest, _response, next) => {
    member(request.userId!, request.params.id as string).then(() => next()).catch(next);
  }, uploadRate, upload.single('file'), api(async (request, response) => {
    const body = z.object({ name: text(50) }).parse(request.body);
    if (!request.file || request.file.size > 5 * 1024 * 1024 || !request.file.mimetype.startsWith('audio/')) {
      throw new ApiError(400, 'Choose an audio file up to 5 MB');
    }
    const soundId = id();
    const diskName = `sound-${soundId}-${request.file.originalname ? path.basename(request.file.originalname) : 'audio'}`;
    try {
      await storage.upload('sounds', diskName, request.file.buffer, request.file.mimetype);
      await db.createSound({
        id: soundId,
        serverId: request.params.id as string,
        uploaderId: request.userId!,
        name: body.name,
        mime: request.file.mimetype,
        size: request.file.size,
        diskName,
      });
    } catch (error) {
      await storage.remove('sounds', diskName);
      throw error;
    }
    await syncServer(request.params.id as string);
    const created = (await db.getSound(soundId))!;
    response.status(201).json({ sound: sound(created) });
  }));

  app.get('/api/sounds/:id/audio', api(async (request, response) => {
    const found = await db.getSound(request.params.id as string);
    if (!found) throw new ApiError(404, 'Sound not found');
    await member(request.userId!, found.serverId);
    await serveFile(response, 'sounds', found.mime, found.diskName);
  }));

  app.delete('/api/sounds/:id', api(async (request, response) => {
    const found = await db.getSound(request.params.id as string);
    if (!found) throw new ApiError(404, 'Sound not found');
    await member(request.userId!, found.serverId, found.uploaderId !== request.userId);
    const { diskName } = await db.deleteSound(found.id);
    await storage.remove('sounds', diskName);
    await syncServer(found.serverId);
    response.json({ ok: true });
  }));

  app.get('/api/rtc', api((_request, response) => {
    let iceServers: unknown = [{ urls: 'stun:stun.l.google.com:19302' }];
    if (process.env.ICE_SERVERS_JSON) {
      try {
        iceServers = JSON.parse(process.env.ICE_SERVERS_JSON);
        if (!Array.isArray(iceServers)) throw new Error();
      } catch {
        throw new ApiError(500, 'Invalid ICE_SERVERS_JSON configuration');
      }
    }
    response.json({ iceServers });
  }));

  io.use(async (socket, next) => {
    try {
      let authUserId: string | undefined;
      const token = socket.handshake.auth?.token || (socket.handshake.headers.authorization?.startsWith('Bearer ') ? socket.handshake.headers.authorization.slice(7).trim() : undefined);
      if (closing) return next(new Error('Server is restarting'));
      if (token && supabaseVerifier && !tokenRevoked(tokenHash(token))) {
        const verifiedResult = await supabaseVerifier.verifyAccessTokenWithDetails(token);
        if (verifiedResult.unconfirmedEmail) {
          return next(new Error('Email address must be verified before signing in'));
        }
        if (verifiedResult.user) {
          observeToken(token, verifiedResult.user.id);
          await supabaseVerifier.ensureHavenUser(db, verifiedResult.user);
          if (tokenRevoked(tokenHash(token))) return next(new Error('Sign in to continue'));
          authUserId = verifiedResult.user.id;
          // Kept for continuing validation: expiry per event, revocation on logout and periodic provider rechecks.
          socket.data.supabaseToken = token;
          socket.data.supabaseTokenHash = tokenHash(token);
          socket.data.supabaseTokenExpiresAt = SupabaseAuthVerifier.tokenExpiresAt(token);
          socket.data.verifiedAt = now();
        } else if (verifiedResult.unavailable && isHostedMode) {
          return next(new Error('Sign-in is temporarily unavailable. Try again shortly.'));
        }
      }
      if (!authUserId && token && !isHostedMode) {
        authUserId = await db.getSessionUserId(tokenHash(token), now());
        if (authUserId) socket.data.sessionHash = tokenHash(token);
      }
      if (!authUserId && !isHostedMode) {
        const cookie = socket.request.headers.cookie;
        const cookieToken = parseCookies(cookie).relay_session;
        if (cookieToken) {
          authUserId = await db.getSessionUserId(tokenHash(cookieToken), now());
          if (authUserId) socket.data.sessionHash = tokenHash(cookieToken);
        }
      }
      if (!authUserId) return next(new Error('Sign in to continue'));
      if ((await user(authUserId, true)).settings?.profileCompleted === false) return next(new Error('Complete your profile to continue'));
      socket.data.userId = authUserId;
      next();
    } catch {
      next(new Error('Sign in to continue'));
    }
  });

  // Synchronous: every listener is installed before the first await, so events a client emits
  // immediately after `connect` are never dropped. Presence is announced afterwards.
  io.on('connection', socket => {
    const userId = socket.data.userId as string;
    socket.join(`user:${userId}`);

    let voiceControlQueue = Promise.resolve<unknown>(undefined);
    const event = (name: string, handler: (payload: any) => Promise<unknown> | unknown) =>
      socket.on(name, (payload = {}, ack?: (result: unknown) => void) => {
        const run = async () => {
        try {
          if (!socket.connected) throw new ApiError(401, 'Connection closed');
          if (closing) throw new ApiError(503, 'Server is restarting');
          if (socket.data.sessionHash) {
            const valid = await db.hasValidSession(socket.data.sessionHash, now());
            if (!valid) throw new SessionEnded();
          }
          if (socket.data.supabaseToken && !supabaseSocketCurrent(socket)) throw new SessionEnded();
          if (name === 'voice:activity') rate(`voice-activity:${socket.id}`, 240);
          else rate(`socket:${userId}`, 300);
          const result = await handler(payload);
          if (typeof ack === 'function') ack(result ?? { ok: true });
        } catch (error) {
          if (typeof ack === 'function') ack({ error: error instanceof Error ? error.message : 'Request failed' });
          if (error instanceof SessionEnded) socket.disconnect(true);
        }
        };
        if (['voice:join', 'voice:leave', 'voice:state', 'voice:stream-watch', 'voice:stream-unwatch'].includes(name)) {
          voiceControlQueue = voiceControlQueue.catch(() => {}).then(run);
          track(voiceControlQueue);
        } else track(run());
      });

    // Hosted clients send their refreshed Supabase access token so long calls survive token rotation.
    socket.on('auth:refresh', (payload: unknown, ack?: (result: unknown) => void) => track((async () => {
      try {
        if (!socket.data.supabaseToken || !supabaseVerifier) throw new ApiError(400, 'This connection does not use hosted sign-in');
        rate(`auth-refresh:${socket.id}`, 30);
        const token = z.object({ token: z.string().min(1).max(8192) }).parse(payload).token;
        if (tokenRevoked(socket.data.supabaseTokenHash) || tokenRevoked(tokenHash(token))) throw new SessionEnded();
        const result = await supabaseVerifier.verifyAccessTokenWithDetails(token);
        if (result.unavailable) throw new ApiError(503, 'Sign-in is temporarily unavailable. Try again shortly.');
        if (result.user?.id !== userId) throw new SessionEnded();
        if (!socket.connected || closing || tokenRevoked(socket.data.supabaseTokenHash) || tokenRevoked(tokenHash(token))) throw new SessionEnded();
        observeToken(token, userId);
        Object.assign(socket.data, { supabaseToken: token, supabaseTokenHash: tokenHash(token), supabaseTokenExpiresAt: SupabaseAuthVerifier.tokenExpiresAt(token), verifiedAt: now() });
        if (typeof ack === 'function') ack({ ok: true });
      } catch (error) {
        if (typeof ack === 'function') ack({ error: error instanceof z.ZodError ? 'Invalid token' : error instanceof Error ? error.message : 'Request failed' });
        if (error instanceof SessionEnded) socket.disconnect(true);
      }
    })()));

    event('typing', async payload => {
      const value = scopeSchema.parse(payload);
      await scope(userId, value, true, true);
      rate(`typing:${userId}`, 30);
      const audience = await scopeAudience(value);
      emitUsers(audience.filter(target => target !== userId), 'typing', { scope: value.channelId ?? value.conversationId, userId });
    });

    event('voice:join', async payload => {
      const body = z.object({ channelId: z.string(), streamProtocol: z.literal(1).optional() }).parse(payload);
      const current = await channel(userId, body.channelId);
      if (current.type !== 'voice') throw new ApiError(400, 'Choose a voice channel');
      const flags = (await member(userId, current.serverId))!;
      const moderation = { serverId: current.serverId, muted: flags.serverMuted, deafened: flags.serverDeafened };
      const profile = await user(userId);
      // No await from here until the participant is inserted: other sockets' joins are serialized
      // only by the event loop, so the capacity check and insertion must be one synchronous step.
      if (!socket.connected) throw new ApiError(401, 'Connection closed');
      const peers = [...voice.values()].filter(peer => peer.channelId === current.id && peer.socketId !== socket.id);
      if (voice.get(socket.id)?.channelId === current.id) return { peers, moderation, capabilities: { streamSubscriptions: 1 } };
      if (peers.length >= 8) throw new ApiError(409, 'Voice channel is full (8 participants)');
      const previous = detachVoice(socket);
      const participant: VoicePeer = {
        socketId: socket.id,
        user: profile,
        channelId: current.id,
        muted: moderation.muted || moderation.deafened,
        deafened: moderation.deafened,
        serverMuted: moderation.muted,
        serverDeafened: moderation.deafened,
        sharing: false,
        speaking: false,
        streamProtocol: body.streamProtocol,
      };
      voice.set(socket.id, participant);
      socket.join(`voice:${current.id}`);
      socket.to(`voice:${current.id}`).emit('voice:peer-joined', participant);
      const previousChannel = previous && await db.getChannel(previous.channelId);
      if (previousChannel && previousChannel.serverId !== current.serverId) await syncServer(previousChannel.serverId);
      await syncServer(current.serverId);
      return { peers, moderation, capabilities: { streamSubscriptions: 1 } };
    });

    event('voice:leave', async () => { await leaveVoice(socket); });

    event('voice:signal', async payload => {
      const body = z.object({
        target: z.string(),
        description: z.object({ type: z.enum(['offer', 'answer', 'pranswer', 'rollback']), sdp: z.string().max(100_000).optional() }).optional(),
        candidate: z.object({ candidate: z.string().max(5000).optional(), sdpMid: z.string().nullable().optional(), sdpMLineIndex: z.number().nullable().optional(), usernameFragment: z.string().nullable().optional() }).nullable().optional(),
      }).parse(payload);
      const source = voice.get(socket.id);
      const target = voice.get(body.target);
      if (!source || !target || source.channelId !== target.channelId) throw new ApiError(403, 'Voice peer permission denied');
      await channel(userId, source.channelId);
      await channel(target.user.id, target.channelId);
      if (voice.get(socket.id) !== source || voice.get(body.target) !== target || source.channelId !== target.channelId) throw new ApiError(403, 'Voice membership changed');
      io.to(body.target).emit('voice:signal', { from: socket.id, description: body.description, candidate: body.candidate });
    });

    let streamControlQueue = Promise.resolve<unknown>(undefined);
    const streamControl = (handler: (payload: unknown) => Promise<unknown>) => (payload: unknown) => {
      const operation = streamControlQueue.catch(() => {}).then(() => handler(payload));
      streamControlQueue = operation;
      return operation;
    };
    event('voice:stream-watch', streamControl(async payload => {
      const body = z.object({ target: z.string().max(128), broadcastId: z.string().uuid() }).parse(payload);
      const source = voice.get(socket.id);
      const target = voice.get(body.target);
      if (!source || !target || source === target || source.channelId !== target.channelId) throw new ApiError(403, 'Voice peer permission denied');
      if (source.streamProtocol !== 1 || target.streamProtocol !== 1) throw new ApiError(409, 'The broadcaster needs an updated Haven client');
      await channel(userId, source.channelId);
      await channel(target.user.id, target.channelId);
      if (voice.get(socket.id) !== source || voice.get(body.target) !== target || source.channelId !== target.channelId) throw new ApiError(403, 'Voice membership changed');
      if (!target.sharing || target.broadcastId !== body.broadcastId) throw new ApiError(409, 'This broadcast has ended');
      const subscriptions = streamSubscriptions.get(socket.id) ?? new Map<string, string>();
      subscriptions.set(body.target, body.broadcastId);
      streamSubscriptions.set(socket.id, subscriptions);
      io.to(body.target).emit('voice:stream-watch', { viewerSocketId: socket.id, broadcastId: body.broadcastId });
      return { protocol: 1, broadcastId: body.broadcastId };
    }));

    event('voice:stream-unwatch', streamControl(async payload => {
      const body = z.object({ target: z.string().max(128), broadcastId: z.string().uuid().optional() }).parse(payload);
      const source = voice.get(socket.id);
      const target = voice.get(body.target);
      if (!source || !target || source.channelId !== target.channelId) return;
      const subscriptions = streamSubscriptions.get(socket.id);
      const broadcastId = subscriptions?.get(body.target);
      if (!broadcastId || body.broadcastId && body.broadcastId !== broadcastId) return { protocol: 1 };
      subscriptions!.delete(body.target);
      if (!subscriptions!.size) streamSubscriptions.delete(socket.id);
      io.to(body.target).emit('voice:stream-unwatch', { viewerSocketId: socket.id, broadcastId });
      return { protocol: 1 };
    }));

    event('voice:state', async payload => {
      const body = z.object({ muted: z.boolean(), deafened: z.boolean(), sharing: z.boolean(), broadcastId: z.string().uuid().optional() }).parse(payload);
      const current = voice.get(socket.id);
      if (!current) throw new ApiError(400, 'Join voice first');
      const currentChannel = await channel(userId, current.channelId);
      if (voice.get(socket.id) !== current) return;
      if (body.sharing && current.streamProtocol === 1 && !body.broadcastId) throw new ApiError(400, 'Missing broadcast identity');
      if (current.broadcastId && (!body.sharing || body.broadcastId !== current.broadcastId)) {
        for (const [viewer, subscriptions] of streamSubscriptions) {
          subscriptions.delete(socket.id);
          if (!subscriptions.size) streamSubscriptions.delete(viewer);
        }
      }
      Object.assign(current, body, {
        broadcastId: body.sharing ? body.broadcastId : undefined,
        muted: body.muted || Boolean(current.serverMuted) || Boolean(current.serverDeafened),
        deafened: body.deafened || Boolean(current.serverDeafened),
      });
      if (current.muted || current.deafened) current.speaking = false;
      emitUsers(await serverAudience(currentChannel.serverId), 'voice:state', {
        socketId: socket.id,
        channelId: current.channelId,
        muted: current.muted,
        deafened: current.deafened,
        sharing: current.sharing,
        broadcastId: current.broadcastId,
        streamProtocol: current.streamProtocol,
        speaking: current.speaking ?? false,
        serverMuted: current.serverMuted ?? false,
        serverDeafened: current.serverDeafened ?? false,
      });
    });

    event('voice:activity', async payload => {
      const body = z.object({ speaking: z.boolean() }).parse(payload);
      const current = voice.get(socket.id);
      if (!current) throw new ApiError(400, 'Join voice first');
      const currentChannel = await channel(userId, current.channelId);
      const speaking = body.speaking && !current.muted && !current.deafened;
      if (current.speaking === speaking) return;
      current.speaking = speaking;
      emitUsers(await serverAudience(currentChannel.serverId), 'voice:activity', { socketId: socket.id, channelId: current.channelId, speaking });
    });

    event('sound:play', async payload => {
      const body = z.object({ soundId: z.string() }).parse(payload);
      const current = voice.get(socket.id);
      if (!current) throw new ApiError(400, 'Join voice first');
      const room = await channel(userId, current.channelId);
      const found = await db.getSound(body.soundId);
      if (!found || found.serverId !== room.serverId) throw new ApiError(404, 'Sound not found');
      rate(`sound:${userId}`, 10);
      io.to(`voice:${current.channelId}`).emit('sound:play', { sound: sound(found), userId });
    });

    socket.on('disconnect', () => track((async () => {
      await voiceControlQueue.catch(() => {});
      await leaveVoice(socket);
      if (!connected(userId)) {
        const audience = await db.getVisibleUsers(userId);
        emitUsers(audience, 'presence', { userId, status: 'offline' });
      }
    })().catch(error => console.error('Socket disconnect cleanup failed:', error))));

    track((async () => {
      const me = await user(userId);
      if (socket.connected) emitUsers(await db.getVisibleUsers(userId), 'presence', { userId, status: me.status });
    })().catch(() => {}));
  });

  const resolvedStaticDir = staticDir || (existsSync(path.resolve('dist')) ? path.resolve('dist') : (existsSync(path.resolve('../web/dist')) ? path.resolve('../web/dist') : path.resolve('dist')));
  if (serveStatic && existsSync(resolvedStaticDir)) {
    app.use(express.static(resolvedStaticDir));
    app.get('/{*path}', (request, response, next) => request.path.startsWith('/api/') ? next() : response.sendFile(path.join(resolvedStaticDir, 'index.html')));
  } else {
    app.get('/', (request, response) => {
      if (configuredPublicUrl && request.accepts('html')) {
        return response.redirect(configuredPublicUrl);
      }
      return response.json({
        ok: true,
        service: 'Haven Backend',
        version: HAVEN_VERSION,
        health: '/api/health',
        ...(configuredPublicUrl ? { web: configuredPublicUrl } : {}),
      });
    });
  }

  app.use((_request, response) => response.status(404).json({ error: 'Endpoint not found' }));
  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if (error instanceof HostedProfileReviewRequiredError) return response.status(503).json({ error: error.message });
    if (error instanceof z.ZodError) return response.status(400).json({ error: error.issues.map(issue => issue.message).join('; ') });
    if (error instanceof ApiError || error instanceof InviteUnavailableError || error instanceof AttachmentClaimError || error instanceof FriendRequestConflictError) {
      return response.status(error.status).json({ error: error.message });
    }
    if (error instanceof multer.MulterError) return response.status(400).json({ error: error.message });
    if (error instanceof SyntaxError) return response.status(400).json({ error: 'Invalid JSON' });
    // body-parser/http-errors client errors (e.g. 413 over the JSON limit) are safe to expose as-is.
    const clientError = error as { status?: unknown; expose?: unknown; message?: string };
    if (clientError?.expose === true && typeof clientError.status === 'number' && clientError.status >= 400 && clientError.status < 500) {
      return response.status(clientError.status).json({ error: clientError.status === 413 ? 'Request is too large' : clientError.message });
    }
    console.error(error);
    response.status(500).json({ error: 'Internal server error' });
  });

  const close = async () => {
    closing = true;
    clearInterval(cleanupTimer);
    await new Promise<void>(resolve => io.close(() => resolve()));
    if (httpServer.listening) await new Promise<void>((resolve, reject) => httpServer.close(error => error ? reject(error) : resolve()));
    // Socket.IO fires async disconnect cleanup (voice leave, presence) without awaiting it.
    // Drain that work, and anything it schedules, before the database pool is ended.
    while (pendingWork.size) await Promise.allSettled([...pendingWork]);
    await db.close();
  };

  // Expose both adapter and raw better-sqlite3 database (for tests)
  const rawDb = db instanceof SqliteAdapter ? db.getRawDatabase() : db;
  return { app, httpServer, io, db: rawDb, adapter: db, close, runMaintenance: maintenance };
}
