import express, { type Request, type Response, type NextFunction } from 'express';
import { normalizeLoginUsername, usernameExpression } from '@haven/shared/auth';
import { createServer } from 'node:http';
import { randomBytes, randomUUID, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import path from 'node:path';
import { existsSync } from 'node:fs';
import multer from 'multer';
import { Server as SocketServer, type Socket } from 'socket.io';
import { z } from 'zod';
import type { User, Message, VoicePeer, ServerEmoji } from '@haven/shared/types';
import { inspectRaster } from './images.js';
import { createDatabase, type DatabaseAdapter, SqliteAdapter } from './db/index.js';
import { createStorage, type StorageService } from './storage/index.js';
import { SupabaseAuthVerifier } from './auth/supabase.js';

type AuthRequest = Request & { userId?: string };
class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
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
  const limits = new Map<string, { count: number; until: number }>();
  const rate = (key: string, maximum = 120, window = 60_000) => {
    const bucket = limits.get(key);
    if (!bucket || bucket.until <= now()) { limits.set(key, { count: 1, until: now() + window }); return; }
    if (++bucket.count > maximum) throw new ApiError(429, 'Too many requests. Try again shortly.');
  };

  const cleanupTimer = setInterval(async () => {
    for (const [key, value] of limits) if (value.until < now()) limits.delete(key);
    await db.deleteExpiredSessions(now()).catch(() => {});
    for (const socket of io.sockets.sockets.values()) {
      if (socket.data.sessionHash) {
        const valid = await db.hasValidSession(socket.data.sessionHash, now()).catch(() => false);
        if (!valid) socket.disconnect(true);
      }
    }
  }, 60_000);
  cleanupTimer.unref();

  const connected = (userId: string) => [...io.sockets.sockets.values()].some(socket => socket.data.userId === userId);

  const user = async (userId: string, privateFields = false): Promise<User> => {
    const row = await db.getUser(userId);
    if (!row) throw new ApiError(404, 'User not found');
    return {
      id: row.id,
      username: row.username,
      displayName: row.displayName,
      bio: row.bio,
      avatar: row.avatar,
      status: connected(userId) ? row.status : 'offline',
      createdAt: row.createdAt,
      ...(privateFields ? { settings: JSON.parse(row.settings) } : {}),
    };
  };

  const resolveUserId = async (cookie?: string, authHeader?: string): Promise<string | undefined> => {
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7).trim();
      if (supabaseVerifier) {
        const verifiedResult = await supabaseVerifier.verifyAccessTokenWithDetails(token);
        if (verifiedResult.unconfirmedEmail) {
          throw new ApiError(403, 'Email address must be verified before signing in');
        }
        if (verifiedResult.user) {
          await supabaseVerifier.ensureHavenUser(db, verifiedResult.user);
          return verifiedResult.user.id;
        }
      }
      const fromToken = await db.getSessionUserId(tokenHash(token), now());
      if (fromToken) return fromToken;
    }
    const token = parseCookies(cookie).relay_session;
    return token ? await db.getSessionUserId(tokenHash(token), now()) : undefined;
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

  const message = async (messageId: string): Promise<Message> => {
    const found = await db.getMessage(messageId);
    if (!found) throw new ApiError(404, 'Message not found');
    const reactionsMap = new Map<string, string[]>();
    for (const reaction of await db.getMessageReactions(messageId)) {
      reactionsMap.set(reaction.emoji, [...(reactionsMap.get(reaction.emoji) ?? []), reaction.userId]);
    }
    const attachments = (await db.getMessageAttachments(messageId)).map(item => ({ ...item, url: `/api/attachments/${item.id}` }));
    return {
      ...found,
      attachments,
      reactions: [...reactionsMap].map(([emoji, userIds]) => ({ emoji, userIds })),
    };
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

  const leaveVoice = async (socket: Socket) => {
    const current = voice.get(socket.id);
    if (!current) return;
    socket.leave(`voice:${current.channelId}`);
    voice.delete(socket.id);
    io.to(`voice:${current.channelId}`).emit('voice:peer-left', { socketId: socket.id });
    const ch = await db.getChannel(current.channelId);
    if (ch) await syncServer(ch.serverId);
  };

  const revoke = async (userId: string, serverId: string, reason = 'membership-revoked') => {
    for (const socket of io.sockets.sockets.values()) {
      if (socket.data.userId === userId) {
        const current = voice.get(socket.id);
        if (current) {
          const ch = await db.getChannel(current.channelId);
          if (ch?.serverId === serverId) {
            socket.emit('voice:disconnect', { reason });
            await leaveVoice(socket);
          }
        }
      }
    }
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

  app.get('/health', (_request, response) => response.json({ ok: true, version: '0.4.1' }));
  app.get('/api/health', (_request, response) => response.json({ ok: true, version: '0.4.1', ...(configuredPublicUrl ? { webUrl: configuredPublicUrl } : {}) }));
  const isHostedMode = Boolean(db.isPostgres && supabaseUrl && supabaseAnonKey);
  app.get('/api/config', (_request, response) => response.json({
    ...(configuredPublicUrl ? { publicUrl: configuredPublicUrl } : {}),
    ...(isHostedMode ? {
      mode: 'hosted',
      supabaseUrl,
      supabaseAnonKey,
    } : {}),
  }));

  const validInvite = async (code: string) => {
    const found = await db.getInvite(code);
    if (!found || found.revokedAt !== null) throw new ApiError(404, 'Invite is invalid or has been revoked');
    if (found.expiresAt !== null && found.expiresAt <= now()) throw new ApiError(410, 'This invite has expired. Ask for a new invitation.');
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

  const issueSession = async (request: Request, response: Response, userId: string) => {
    const token = randomBytes(32).toString('hex');
    await db.createSession(tokenHash(token), userId, now() + 30 * 24 * 3600_000);
    response.cookie('relay_session', token, { ...getCookieOptions(request), maxAge: 30 * 24 * 3600_000 });
  };

  const username = z.string().trim().min(3).max(32).regex(usernameExpression, 'Usernames use letters, numbers, underscores, dots or hyphens');
  const credentials = z.object({ username, password: z.string().min(8).max(128), displayName: z.preprocess(value => typeof value === 'string' && !value.trim() ? undefined : value, text(50).optional()) });
  const loginCredentials = z.object({ username: z.string().max(128).transform(normalizeLoginUsername).pipe(username), password: z.string().min(1).max(128) });

  app.post('/api/auth/register', api(async (request, response) => {
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

  app.post('/api/auth/login', api(async (request, response) => {
    rate(`auth:${request.ip}`, 40, 3600_000);
    const body = loginCredentials.parse(request.body);
    const found = await db.getUserByUsername(body.username);
    const [salt, expected] = found?.password?.split(':') ?? ['missing-account-salt', '00'.repeat(64)];
    const actual = await passwordHash(body.password, salt);
    if (!found || !expected || !timingSafeEqual(actual, Buffer.from(expected, 'hex'))) {
      throw new ApiError(401, 'Invalid username or password');
    }
    await issueSession(request, response, found.id);
    response.json({ user: await user(found.id, true) });
  }));

  app.use('/api', async (request: AuthRequest, response, next) => {
    try {
      request.userId = await resolveUserId(request.headers.cookie, request.headers.authorization);
      if (!request.userId) return response.status(401).json({ error: 'Sign in to continue' });
      rate(`api:${request.userId}`, 300);
      next();
    } catch (error) { next(error); }
  });

  app.post('/api/auth/logout', api(async (request, response) => {
    const token = parseCookies(request.headers.cookie).relay_session;
    if (token) await db.deleteSession(tokenHash(token));
    const headerToken = request.headers.authorization?.startsWith('Bearer ') ? request.headers.authorization.slice(7).trim() : null;
    if (headerToken) {
      await db.deleteSession(tokenHash(headerToken));
      if (supabaseVerifier) {
        supabaseVerifier.invalidateToken(headerToken);
      }
    }
    for (const socket of io.sockets.sockets.values()) {
      if (socket.data.sessionHash === tokenHash(token ?? '') || socket.data.sessionHash === tokenHash(headerToken ?? '')) {
        socket.disconnect(true);
      }
    }
    response.clearCookie('relay_session', getCookieOptions(request));
    response.json({ ok: true });
  }));

  app.get('/api/auth/me', api(async (request, response) => response.json({ user: await user(request.userId!, true) })));

  app.get('/api/bootstrap', api(async (request, response) => {
    const userId = request.userId!;
    const servers = await db.getUserServers(userId);
    const channels = await db.getUserChannels(userId);
    const conversations = await db.getUserConversations(userId);
    const requests = await db.getFriendRequests(userId);
    const friends = await db.getFriends(userId);
    const blocked = await db.getBlocked(userId);
    const visibleIds = await db.getVisibleUsers(userId);
    const visibleUsers = await Promise.all(visibleIds.map(uid => user(uid).catch(() => null)));
    const serverEmojis = (await db.getUserServerEmojis(userId)).map(serverEmoji);

    response.json({
      user: await user(userId, true),
      servers,
      channels,
      conversations,
      requests,
      friends,
      blocked,
      users: visibleUsers.filter(Boolean),
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

    const current = await user(request.userId!, true);
    await db.updateUser(request.userId!, {
      displayName: body.displayName ?? current.displayName,
      bio: body.bio ?? current.bio,
      avatar: body.avatar ?? current.avatar,
      status: body.status ?? current.status,
      settings: body.settings ? JSON.stringify({ ...current.settings, ...body.settings }) : undefined,
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
    const mapped = await Promise.all(membersList.map(async row => ({
      user: await user(row.userId),
      role: row.role,
      serverMuted: row.serverMuted,
      serverDeafened: row.serverDeafened,
    })));
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
      await revoke(targetId, serverId, 'moderator-disconnected');
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
    response.json({ ok: true });
  }));

  app.post('/api/invites/:code/join', api(async (request, response) => {
    await validInvite(request.params.code as string);
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
    const before = z.coerce.number().min(0).default(Number.MAX_SAFE_INTEGER).parse(request.query.before);
    const query = z.string().max(200).default('').parse(request.query.q);
    const messageIds = await db.getMessages(value, before, query, limit + 1);
    const slice = messageIds.slice(0, limit).reverse();
    const fullMessages = await Promise.all(slice.map(mid => message(mid)));
    response.json({ messages: fullMessages, hasMore: messageIds.length > limit });
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
      attachmentIds: z.array(z.string()).max(10).default([]),
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
      if (token && supabaseVerifier) {
        const verifiedResult = await supabaseVerifier.verifyAccessTokenWithDetails(token);
        if (verifiedResult.unconfirmedEmail) {
          return next(new Error('Email address must be verified before signing in'));
        }
        if (verifiedResult.user) {
          await supabaseVerifier.ensureHavenUser(db, verifiedResult.user);
          authUserId = verifiedResult.user.id;
          socket.data.isSupabase = true;
          socket.data.token = token;
        }
      }
      if (!authUserId && token) {
        authUserId = await db.getSessionUserId(tokenHash(token), now());
        if (authUserId) socket.data.sessionHash = tokenHash(token);
      }
      if (!authUserId) {
        const cookie = socket.request.headers.cookie;
        const cookieToken = parseCookies(cookie).relay_session;
        if (cookieToken) {
          authUserId = await db.getSessionUserId(tokenHash(cookieToken), now());
          if (authUserId) socket.data.sessionHash = tokenHash(cookieToken);
        }
      }
      if (!authUserId) return next(new Error('Sign in to continue'));
      socket.data.userId = authUserId;
      next();
    } catch {
      next(new Error('Sign in to continue'));
    }
  });

  io.on('connection', async socket => {
    const userId = socket.data.userId as string;
    socket.join(`user:${userId}`);
    const me = await user(userId).catch(() => null);
    if (me) {
      const audience = await db.getVisibleUsers(userId);
      emitUsers(audience, 'presence', { userId, status: me.status });
    }

    const event = (name: string, handler: (payload: any) => Promise<unknown> | unknown) =>
      socket.on(name, async (payload = {}, ack?: (result: unknown) => void) => {
        try {
          if (socket.data.sessionHash) {
            const valid = await db.hasValidSession(socket.data.sessionHash, now());
            if (!valid) { socket.disconnect(true); throw new ApiError(401, 'Session expired'); }
          }
          if (name === 'voice:activity') rate(`voice-activity:${socket.id}`, 240);
          else rate(`socket:${userId}`, 300);
          const result = await handler(payload);
          if (typeof ack === 'function') ack(result ?? { ok: true });
        } catch (error) {
          if (typeof ack === 'function') ack({ error: error instanceof Error ? error.message : 'Request failed' });
        }
      });

    event('typing', async payload => {
      const value = scopeSchema.parse(payload);
      await scope(userId, value, true, true);
      rate(`typing:${userId}`, 30);
      const audience = await scopeAudience(value);
      emitUsers(audience.filter(target => target !== userId), 'typing', { scope: value.channelId ?? value.conversationId, userId });
    });

    event('voice:join', async payload => {
      const body = z.object({ channelId: z.string() }).parse(payload);
      const current = await channel(userId, body.channelId);
      if (current.type !== 'voice') throw new ApiError(400, 'Choose a voice channel');
      const peers = [...voice.values()].filter(peer => peer.channelId === current.id && peer.socketId !== socket.id);
      if (peers.length >= 8) throw new ApiError(409, 'Voice channel is full (8 participants)');
      const flags = (await member(userId, current.serverId))!;
      const moderation = { serverId: current.serverId, muted: flags.serverMuted, deafened: flags.serverDeafened };
      if (voice.get(socket.id)?.channelId === current.id) return { peers, moderation };
      await leaveVoice(socket);
      const profile = await user(userId);
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
      };
      voice.set(socket.id, participant);
      socket.join(`voice:${current.id}`);
      socket.to(`voice:${current.id}`).emit('voice:peer-joined', participant);
      await syncServer(current.serverId);
      return { peers, moderation };
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
      io.to(body.target).emit('voice:signal', { from: socket.id, description: body.description, candidate: body.candidate });
    });

    event('voice:state', async payload => {
      const body = z.object({ muted: z.boolean(), deafened: z.boolean(), sharing: z.boolean() }).parse(payload);
      const current = voice.get(socket.id);
      if (!current) throw new ApiError(400, 'Join voice first');
      const currentChannel = await channel(userId, current.channelId);
      Object.assign(current, body, {
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

    socket.on('disconnect', async () => {
      await leaveVoice(socket);
      if (!connected(userId)) {
        const audience = await db.getVisibleUsers(userId);
        emitUsers(audience, 'presence', { userId, status: 'offline' });
      }
    });
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
        version: '0.4.1',
        health: '/api/health',
        ...(configuredPublicUrl ? { web: configuredPublicUrl } : {}),
      });
    });
  }

  app.use((_request, response) => response.status(404).json({ error: 'Endpoint not found' }));
  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if (error instanceof z.ZodError) return response.status(400).json({ error: error.issues.map(issue => issue.message).join('; ') });
    if (error instanceof ApiError) return response.status(error.status).json({ error: error.message });
    if (error instanceof multer.MulterError) return response.status(400).json({ error: error.message });
    if (error instanceof SyntaxError) return response.status(400).json({ error: 'Invalid JSON' });
    console.error(error);
    response.status(500).json({ error: 'Internal server error' });
  });

  const close = async () => {
    clearInterval(cleanupTimer);
    await new Promise<void>(resolve => io.close(() => resolve()));
    if (httpServer.listening) await new Promise<void>((resolve, reject) => httpServer.close(error => error ? reject(error) : resolve()));
    await db.close();
  };

  // Expose both adapter and raw better-sqlite3 database (for tests)
  const rawDb = db instanceof SqliteAdapter ? db.getRawDatabase() : db;
  return { app, httpServer, io, db: rawDb, adapter: db, close };
}
