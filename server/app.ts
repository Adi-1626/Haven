import express, { type Request, type Response, type NextFunction } from 'express';
import { normalizeLoginUsername, usernameExpression } from '../shared/auth.js';
import { createServer } from 'node:http';
import { randomBytes, randomUUID, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { mkdirSync, unlinkSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import multer from 'multer';
import { Server as SocketServer, type Socket } from 'socket.io';
import { z } from 'zod';
import type { User, Message, VoicePeer } from '../shared/types.js';
import { inspectRaster } from './images.js';

type Row = Record<string, any>;
type AuthRequest = Request & { userId?: string };
class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
const id = () => randomUUID();
const now = () => Date.now();
const text = (maximum: number) => z.string().trim().min(1).max(maximum);
const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
const passwordHash = (password: string, salt: string) => new Promise<Buffer>((resolve, reject) => scrypt(password, salt, 64, (error, derived) => error ? reject(error) : resolve(derived)));
const parseCookies = (cookie = '') => Object.fromEntries(cookie.split(';').map(part => part.trim().split('=')).filter(parts => parts.length === 2));
const scopeSchema = z.object({ channelId: z.string().optional(), conversationId: z.string().optional() }).refine(value => Boolean(value.channelId) !== Boolean(value.conversationId), 'Choose one message destination');

export function createApp({ dataDir = path.resolve('data'), origins = [], publicUrl = process.env.PUBLIC_URL }: { dataDir?: string; origins?: string[]; publicUrl?: string } = {}) {
  let configuredPublicUrl: string | undefined;
  if (publicUrl) {
    const parsed = new URL(publicUrl);
    if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/' || (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)))) throw new Error('PUBLIC_URL must be an HTTPS origin (or HTTP loopback origin for local testing)');
    configuredPublicUrl = parsed.origin;
  }
  mkdirSync(dataDir, { recursive: true });
  const uploadDir = path.join(dataDir, 'uploads');
  mkdirSync(uploadDir, { recursive: true });
  const db = new Database(path.join(dataDir, 'relay.sqlite'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT UNIQUE COLLATE NOCASE NOT NULL, displayName TEXT NOT NULL, password TEXT NOT NULL, bio TEXT NOT NULL DEFAULT '', avatar TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'online', settings TEXT NOT NULL DEFAULT '{}', createdAt INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expiresAt INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS servers (id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT NOT NULL DEFAULT '', ownerId TEXT NOT NULL REFERENCES users(id), createdAt INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS members (serverId TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE, userId TEXT NOT NULL REFERENCES users(id), role TEXT NOT NULL DEFAULT 'member', PRIMARY KEY(serverId,userId));
    CREATE TABLE IF NOT EXISTS channels (id TEXT PRIMARY KEY, serverId TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE, name TEXT NOT NULL, type TEXT NOT NULL, topic TEXT NOT NULL DEFAULT '', position INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS invites (code TEXT PRIMARY KEY, serverId TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE, createdAt INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', createdAt INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS conversationMembers (conversationId TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE, userId TEXT NOT NULL REFERENCES users(id), PRIMARY KEY(conversationId,userId));
    CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, channelId TEXT REFERENCES channels(id) ON DELETE CASCADE, conversationId TEXT REFERENCES conversations(id) ON DELETE CASCADE, authorId TEXT NOT NULL REFERENCES users(id), content TEXT NOT NULL, replyTo TEXT REFERENCES messages(id) ON DELETE SET NULL, createdAt INTEGER NOT NULL, editedAt INTEGER);
    CREATE INDEX IF NOT EXISTS messages_channel ON messages(channelId,createdAt DESC);
    CREATE INDEX IF NOT EXISTS messages_conversation ON messages(conversationId,createdAt DESC);
    CREATE INDEX IF NOT EXISTS messages_created ON messages(createdAt DESC);
    CREATE TABLE IF NOT EXISTS attachments (id TEXT PRIMARY KEY, channelId TEXT REFERENCES channels(id) ON DELETE CASCADE, conversationId TEXT REFERENCES conversations(id) ON DELETE CASCADE, uploaderId TEXT NOT NULL REFERENCES users(id), messageId TEXT REFERENCES messages(id) ON DELETE CASCADE, name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, diskName TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS reactions (messageId TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE, userId TEXT NOT NULL REFERENCES users(id), emoji TEXT NOT NULL, PRIMARY KEY(messageId,userId,emoji));
    CREATE TABLE IF NOT EXISTS friendRequests (id TEXT PRIMARY KEY, fromId TEXT NOT NULL REFERENCES users(id), toId TEXT NOT NULL REFERENCES users(id), createdAt INTEGER NOT NULL, UNIQUE(fromId,toId));
    CREATE TABLE IF NOT EXISTS friends (userId TEXT NOT NULL REFERENCES users(id), friendId TEXT NOT NULL REFERENCES users(id), PRIMARY KEY(userId,friendId));
    CREATE TABLE IF NOT EXISTS blocks (userId TEXT NOT NULL REFERENCES users(id), blockedId TEXT NOT NULL REFERENCES users(id), createdAt INTEGER NOT NULL, PRIMARY KEY(userId,blockedId), CHECK(userId<>blockedId));
    CREATE TABLE IF NOT EXISTS sounds (id TEXT PRIMARY KEY, serverId TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE, uploaderId TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, diskName TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS serverEmojis (id TEXT PRIMARY KEY, serverId TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE, name TEXT NOT NULL COLLATE NOCASE, animated INTEGER NOT NULL DEFAULT 0, mime TEXT NOT NULL, diskName TEXT NOT NULL, staticDiskName TEXT NOT NULL, uploaderId TEXT NOT NULL REFERENCES users(id), createdAt INTEGER NOT NULL, UNIQUE(serverId,name));
    CREATE TABLE IF NOT EXISTS serverIcons (serverId TEXT PRIMARY KEY REFERENCES servers(id) ON DELETE CASCADE, mime TEXT NOT NULL, diskName TEXT NOT NULL);
  `);
  if (!(db.prepare('PRAGMA table_info(servers)').all() as Row[]).some(column => column.name === 'description')) db.exec("ALTER TABLE servers ADD COLUMN description TEXT NOT NULL DEFAULT ''");
  const memberColumns = db.prepare('PRAGMA table_info(members)').all() as Row[];
  for (const column of ['serverMuted', 'serverDeafened']) if (!memberColumns.some(found => found.name === column)) db.exec(`ALTER TABLE members ADD COLUMN ${column} INTEGER NOT NULL DEFAULT 0`);
  const inviteColumns = db.prepare('PRAGMA table_info(invites)').all() as Row[];
  for (const column of ['expiresAt', 'revokedAt']) if (!inviteColumns.some(found => found.name === column)) db.exec(`ALTER TABLE invites ADD COLUMN ${column} INTEGER`);
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS friend_request_pair BEFORE INSERT ON friendRequests
    WHEN EXISTS (SELECT 1 FROM friendRequests WHERE (fromId=NEW.fromId AND toId=NEW.toId) OR (fromId=NEW.toId AND toId=NEW.fromId))
    BEGIN SELECT RAISE(ABORT,'A friend request already exists'); END;
  `);
  const app = express();
  if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
  const httpServer = createServer(app);
  const allowedOrigins = new Set(origins);
  const originAllowed = (origin: string | undefined, host?: string) => !origin || allowedOrigins.has(origin) || (() => { try { return new URL(origin).host === host; } catch { return false; } })();
  const io = new SocketServer(httpServer, { maxHttpBufferSize: 256_000, allowRequest: (request, callback) => callback(null, originAllowed(request.headers.origin, request.headers.host)) });
  const all = (sql: string, ...values: any[]) => db.prepare(sql).all(...values) as Row[];
  const one = (sql: string, ...values: any[]) => db.prepare(sql).get(...values) as Row | undefined;
  const run = (sql: string, ...values: any[]) => db.prepare(sql).run(...values);
  const voice = new Map<string, VoicePeer>();
  const limits = new Map<string, { count: number; until: number }>();
  const rate = (key: string, maximum = 120, window = 60_000) => {
    const bucket = limits.get(key);
    if (!bucket || bucket.until <= now()) { limits.set(key, { count: 1, until: now() + window }); return; }
    if (++bucket.count > maximum) throw new ApiError(429, 'Too many requests. Try again shortly.');
  };
  const cleanupTimer = setInterval(() => {
    for (const [key, value] of limits) if (value.until < now()) limits.delete(key);
    run('DELETE FROM sessions WHERE expiresAt < ?', now());
    for (const socket of io.sockets.sockets.values()) if (!one('SELECT 1 FROM sessions WHERE token=? AND expiresAt>?', socket.data.sessionHash, now())) socket.disconnect(true);
  }, 60_000);
  cleanupTimer.unref();
  const connected = (userId: string) => [...io.sockets.sockets.values()].some(socket => socket.data.userId === userId);
  const user = (userId: string, privateFields = false): User => {
    const row = one('SELECT * FROM users WHERE id=?', userId);
    if (!row) throw new ApiError(404, 'User not found');
    return { id: row.id, username: row.username, displayName: row.displayName, bio: row.bio, avatar: row.avatar, status: connected(userId) ? row.status : 'offline', createdAt: row.createdAt, ...(privateFields ? { settings: JSON.parse(row.settings) } : {}) };
  };
  const sessionUser = (cookie?: string) => {
    const token = parseCookies(cookie).relay_session;
    return token ? one('SELECT userId FROM sessions WHERE token=? AND expiresAt>?', tokenHash(token), now())?.userId as string | undefined : undefined;
  };
  const member = (userId: string, serverId: string, moderate = false) => {
    const found = one('SELECT * FROM members WHERE serverId=? AND userId=?', serverId, userId);
    if (!found || (moderate && !['owner', 'admin'].includes(found.role))) throw new ApiError(403, 'Server permission denied');
    return found;
  };
  const channel = (userId: string, channelId: string, moderate = false) => {
    const found = one('SELECT * FROM channels WHERE id=?', channelId);
    if (!found) throw new ApiError(404, 'Channel not found');
    member(userId, found.serverId, moderate);
    return found;
  };
  const blockedPair = (first: string, second: string) => Boolean(one('SELECT 1 FROM blocks WHERE (userId=? AND blockedId=?) OR (userId=? AND blockedId=?)', first, second, second, first));
  const conversationContact = (userId: string, conversationId: string) => {
    const members = all('SELECT userId FROM conversationMembers WHERE conversationId=?', conversationId);
    if (members.length === 2 && members.some(found => found.userId !== userId && blockedPair(userId, found.userId))) throw new ApiError(403, 'Direct messaging is unavailable because one of you blocked the other');
  };
  const scope = (userId: string, value: { channelId?: string | null; conversationId?: string | null }, textOnly = false, contact = false) => {
    if (Boolean(value.channelId) === Boolean(value.conversationId)) throw new ApiError(400, 'Choose one message destination');
    if (value.channelId) {
      const found = channel(userId, value.channelId);
      if (textOnly && found.type !== 'text') throw new ApiError(400, 'Messages require a text channel');
      return `channel:${found.id}`;
    }
    if (!one('SELECT 1 FROM conversationMembers WHERE conversationId=? AND userId=?', value.conversationId, userId)) throw new ApiError(403, 'Conversation permission denied');
    if (contact) conversationContact(userId, value.conversationId!);
    return `conversation:${value.conversationId}`;
  };
  const message = (messageId: string): Message => {
    const found = one('SELECT * FROM messages WHERE id=?', messageId);
    if (!found) throw new ApiError(404, 'Message not found');
    const reactions = new Map<string, string[]>();
    for (const reaction of all('SELECT emoji,userId FROM reactions WHERE messageId=?', messageId)) reactions.set(reaction.emoji, [...(reactions.get(reaction.emoji) ?? []), reaction.userId]);
    return { ...found, attachments: all('SELECT id,name,mime,size FROM attachments WHERE messageId=?', messageId).map(item => ({ ...item, url: `/api/attachments/${item.id}` })), reactions: [...reactions].map(([emoji, userIds]) => ({ emoji, userIds })) } as Message;
  };
  const conversation = (conversationId: string) => ({ ...one('SELECT * FROM conversations WHERE id=?', conversationId), memberIds: all('SELECT userId FROM conversationMembers WHERE conversationId=?', conversationId).map(row => row.userId) });
  const serverAudience = (serverId: string) => all('SELECT userId FROM members WHERE serverId=?', serverId).map(row => row.userId as string);
  const scopeAudience = (value: Row) => value.channelId ? serverAudience(one('SELECT serverId FROM channels WHERE id=?', value.channelId)!.serverId) : all('SELECT userId FROM conversationMembers WHERE conversationId=?', value.conversationId).map(row => row.userId as string);
  const emitUsers = (userIds: string[], event: string, data?: unknown) => { for (const userId of new Set(userIds)) io.to(`user:${userId}`).emit(event, data); };
  const syncServer = (serverId: string) => emitUsers(serverAudience(serverId), 'sync');
  const emitMessage = (value: Message, updated = false) => emitUsers(scopeAudience(value), updated ? 'message:update' : 'message', value);
  const leaveVoice = (socket: Socket) => {
    const current = voice.get(socket.id);
    if (!current) return;
    socket.leave(`voice:${current.channelId}`);
    voice.delete(socket.id);
    io.to(`voice:${current.channelId}`).emit('voice:peer-left', { socketId: socket.id });
    const row = one('SELECT serverId FROM channels WHERE id=?', current.channelId);
    if (row) syncServer(row.serverId);
  };
  const revoke = (userId: string, serverId: string, reason = 'membership-revoked') => {
    for (const socket of io.sockets.sockets.values()) if (socket.data.userId === userId) {
      const current = voice.get(socket.id);
      if (current && one('SELECT serverId FROM channels WHERE id=?', current.channelId)?.serverId === serverId) { socket.emit('voice:disconnect', { reason }); leaveVoice(socket); }
    }
  };
  const api = (handler: (request: AuthRequest, response: Response) => unknown) => (request: Request, response: Response, next: NextFunction) => { try { Promise.resolve(handler(request as AuthRequest, response)).catch(next); } catch (error) { next(error); } };
  app.disable('x-powered-by');
  app.use((request, response, next) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'same-origin');
    const origin = request.headers.origin;
    if (!originAllowed(origin, request.headers.host)) return response.status(403).json({ error: 'Origin not allowed' });
    if (origin && allowedOrigins.has(origin)) { response.setHeader('Access-Control-Allow-Origin', origin); response.setHeader('Access-Control-Allow-Credentials', 'true'); response.setHeader('Vary', 'Origin'); }
    if (request.method === 'OPTIONS') { response.setHeader('Access-Control-Allow-Headers', 'Content-Type'); response.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE'); return response.sendStatus(204); }
    next();
  });
  app.use(express.json({ limit: '128kb' }));
  app.get('/api/health', (_request, response) => response.json({ ok: true }));
  app.get('/api/config', (_request, response) => response.json({ ...(configuredPublicUrl ? { publicUrl: configuredPublicUrl } : {}) }));
  const validInvite = (code: string) => {
    const found = one('SELECT * FROM invites WHERE code=?', code);
    if (!found || found.revokedAt !== null) throw new ApiError(404, 'Invite is invalid or has been revoked');
    if (found.expiresAt !== null && found.expiresAt <= now()) throw new ApiError(410, 'This invite has expired. Ask for a new invitation.');
    return found;
  };
  app.get('/api/invites/:code', api((request, response) => {
    rate(`invite-preview:${request.ip}`, 60);
    const found = validInvite(request.params.code as string);
    const community = one('SELECT name,icon FROM servers WHERE id=?', found.serverId)!;
    response.setHeader('Cache-Control', 'no-store');
    response.json({ community, expiresAt: found.expiresAt });
  }));
  const issueSession = (request: Request, response: Response, userId: string) => {
    const token = randomBytes(32).toString('hex');
    run('INSERT INTO sessions VALUES(?,?,?)', tokenHash(token), userId, now() + 30 * 24 * 3600_000);
    response.cookie('relay_session', token, { httpOnly: true, sameSite: 'strict', secure: request.secure || process.env.SECURE_COOKIES === '1', maxAge: 30 * 24 * 3600_000, path: '/' });
  };
  const username = z.string().trim().min(3).max(32).regex(usernameExpression, 'Usernames use letters, numbers, underscores, dots or hyphens');
  const credentials = z.object({ username, password: z.string().min(8).max(128), displayName: z.preprocess(value => typeof value === 'string' && !value.trim() ? undefined : value, text(50).optional()) });
  const loginCredentials = z.object({ username: z.string().max(128).transform(normalizeLoginUsername).pipe(username), password: z.string().min(1).max(128) });
  app.post('/api/auth/register', api(async (request, response) => {
    rate(`auth:${request.ip}`, 20, 3600_000);
    const body = credentials.parse(request.body);
    if (one('SELECT 1 FROM users WHERE username=?', body.username)) throw new ApiError(409, 'Username is already taken');
    const userId = id(); const salt = randomBytes(16).toString('hex');
    const hashed = await passwordHash(body.password, salt);
    if (one('SELECT 1 FROM users WHERE username=?', body.username)) throw new ApiError(409, 'Username is already taken');
    run('INSERT INTO users(id,username,displayName,password,createdAt) VALUES(?,?,?,?,?)', userId, body.username, body.displayName ?? body.username, `${salt}:${hashed.toString('hex')}`, now());
    issueSession(request, response, userId);
    response.status(201).json({ user: user(userId, true) });
  }));
  app.post('/api/auth/login', api(async (request, response) => {
    rate(`auth:${request.ip}`, 40, 3600_000);
    const body = loginCredentials.parse(request.body);
    const found = one('SELECT * FROM users WHERE username=?', body.username);
    const [salt, expected] = found?.password.split(':') ?? ['missing-account-salt', '00'.repeat(64)];
    const actual = await passwordHash(body.password, salt);
    if (!timingSafeEqual(actual, Buffer.from(expected, 'hex')) || !found) throw new ApiError(401, 'Invalid username or password');
    issueSession(request, response, found.id);
    response.json({ user: user(found.id, true) });
  }));
  app.use('/api', (request: AuthRequest, response, next) => {
    try {
      request.userId = sessionUser(request.headers.cookie);
      if (!request.userId) return response.status(401).json({ error: 'Sign in to continue' });
      rate(`api:${request.userId}`, 300);
      next();
    } catch (error) { next(error); }
  });
  app.post('/api/auth/logout', api((request, response) => {
    const token = parseCookies(request.headers.cookie).relay_session;
    if (token) run('DELETE FROM sessions WHERE token=?', tokenHash(token));
    for (const socket of io.sockets.sockets.values()) if (socket.data.sessionHash === tokenHash(token ?? '')) socket.disconnect(true);
    response.clearCookie('relay_session', { path: '/', httpOnly: true, sameSite: 'strict', secure: request.secure || process.env.SECURE_COOKIES === '1' }); response.json({ ok: true });
  }));
  app.get('/api/auth/me', api((request, response) => response.json({ user: user(request.userId!, true) })));
  app.get('/api/bootstrap', api((request, response) => {
    const userId = request.userId!;
    const servers = all('SELECT s.*,m.role FROM servers s JOIN members m ON m.serverId=s.id WHERE m.userId=? ORDER BY s.createdAt', userId);
    const channels = all('SELECT c.* FROM channels c JOIN members m ON m.serverId=c.serverId WHERE m.userId=? ORDER BY c.position,c.rowid', userId);
    const conversations = all('SELECT c.id FROM conversations c JOIN conversationMembers m ON m.conversationId=c.id WHERE m.userId=? ORDER BY c.createdAt DESC', userId).map(row => conversation(row.id));
    const requests = all('SELECT * FROM friendRequests WHERE fromId=? OR toId=?', userId, userId);
    const friends = all('SELECT friendId FROM friends WHERE userId=?', userId).map(row => row.friendId);
    const blocked = all('SELECT blockedId FROM blocks WHERE userId=?', userId).map(row => row.blockedId);
    const visible = new Set<string>([userId, ...friends, ...blocked, ...requests.flatMap(row => [row.fromId, row.toId]), ...conversations.flatMap(row => row.memberIds), ...servers.flatMap(row => serverAudience(row.id))]);
    response.json({ user: user(userId, true), servers, channels, conversations, requests, friends, blocked, users: [...visible].map(userId => user(userId)), voice: [...voice.values()].filter(peer => channels.some(row => row.id === peer.channelId)), serverEmojis: all('SELECT e.* FROM serverEmojis e JOIN members m ON m.serverId=e.serverId WHERE m.userId=? ORDER BY e.name', userId).map(serverEmoji) });
  }));
  app.patch('/api/users/me', api((request, response) => {
    const body = z.object({ displayName: text(50).optional(), bio: z.string().max(500).optional(), avatar: z.string().max(300).optional(), status: z.enum(['online', 'idle', 'dnd', 'offline']).optional(), settings: z.record(z.string(), z.unknown()).optional() }).parse(request.body);
    const current = one('SELECT * FROM users WHERE id=?', request.userId)!;
    run('UPDATE users SET displayName=?,bio=?,avatar=?,status=?,settings=? WHERE id=?', body.displayName ?? current.displayName, body.bio ?? current.bio, body.avatar ?? current.avatar, body.status ?? current.status, JSON.stringify({ ...JSON.parse(current.settings), ...body.settings }), request.userId);
    const profile = user(request.userId!);
    for (const peer of voice.values()) if (peer.user.id === request.userId) peer.user = profile;
    if (body.avatar !== undefined || body.displayName !== undefined || body.bio !== undefined || body.status !== undefined) emitUsers(visibleAudience(request.userId!), 'user:update', profile);
    emitUsers(body.avatar !== undefined || body.displayName !== undefined || body.bio !== undefined || body.status !== undefined ? visibleAudience(request.userId!) : [request.userId!], 'sync');
    if (body.status !== undefined) emitUsers(visibleAudience(request.userId!), 'presence', { userId: request.userId, status: profile.status });
    response.json({ user: user(request.userId!, true) });
  }));
  const visibleAudience = (userId: string) => [...new Set([userId, ...all('SELECT DISTINCT b.userId FROM members a JOIN members b ON a.serverId=b.serverId WHERE a.userId=?', userId).map(row => row.userId), ...all('SELECT friendId FROM friends WHERE userId=?', userId).map(row => row.friendId), ...all('SELECT fromId,toId FROM friendRequests WHERE fromId=? OR toId=?', userId, userId).flatMap(row => [row.fromId, row.toId]), ...all('SELECT DISTINCT b.userId FROM conversationMembers a JOIN conversationMembers b ON a.conversationId=b.conversationId WHERE a.userId=?', userId).map(row => row.userId)])];
  const iconValue = z.string().trim().max(300).refine(value => !value || value.startsWith('/api/servers/') || (value.length <= 32 && !/[\/:<>]/.test(value)) || (() => { try { const parsed = new URL(value); return parsed.protocol === 'https:' && !parsed.username && !parsed.password; } catch { return false; } })(), 'Use an HTTPS image URL, emoji or uploaded icon');
  app.post('/api/servers', api((request, response) => {
    const body = z.object({ name: text(80), icon: iconValue.optional(), description: z.string().max(1000).optional() }).parse(request.body);
    if (body.icon?.startsWith('/api/')) throw new ApiError(400, 'Create the server before uploading an icon');
    const serverId = id(); const channelId = id();
    db.transaction(() => { run('INSERT INTO servers(id,name,icon,ownerId,createdAt,description) VALUES(?,?,?,?,?,?)', serverId, body.name, body.icon ?? '', request.userId, now(), body.description ?? ''); run('INSERT INTO members(serverId,userId,role) VALUES(?,?,?)', serverId, request.userId, 'owner'); run('INSERT INTO channels VALUES(?,?,?,?,?,?)', channelId, serverId, 'general', 'text', '', 0); run('INSERT INTO channels VALUES(?,?,?,?,?,?)', id(), serverId, 'Lounge', 'voice', '', 1); })();
    syncServer(serverId); response.status(201).json({ server: { ...one('SELECT * FROM servers WHERE id=?', serverId), role: 'owner' }, channel: one('SELECT * FROM channels WHERE id=?', channelId) });
  }));
  app.patch('/api/servers/:id', api((request, response) => {
    member(request.userId!, request.params.id as string, true);
    const body = z.object({ name: text(80).optional(), icon: iconValue.optional(), description: z.string().max(1000).optional() }).parse(request.body);
    const current = one('SELECT * FROM servers WHERE id=?', request.params.id)!;
    if (body.icon?.startsWith('/api/') && body.icon !== current.icon) throw new ApiError(400, 'Upload this server’s own icon instead');
    run('UPDATE servers SET name=?,icon=?,description=? WHERE id=?', body.name ?? current.name, body.icon ?? current.icon, body.description ?? current.description, request.params.id);
    if (body.icon !== undefined && body.icon !== current.icon) { const previous = one('SELECT diskName FROM serverIcons WHERE serverId=?', current.id); if (previous) { run('DELETE FROM serverIcons WHERE serverId=?', current.id); removeFile(previous.diskName); } }
    syncServer(current.id); response.json({ server: one('SELECT * FROM servers WHERE id=?', current.id) });
  }));
  app.delete('/api/servers/:id', api((request, response) => {
    const serverId = request.params.id as string;
    if (member(request.userId!, serverId).role !== 'owner') throw new ApiError(403, 'Only the owner can delete a server');
    const audience = serverAudience(serverId); audience.forEach(userId => revoke(userId, serverId));
    const files = [...all('SELECT a.diskName FROM attachments a JOIN channels c ON c.id=a.channelId WHERE c.serverId=?', serverId), ...all('SELECT diskName FROM sounds WHERE serverId=?', serverId), ...all('SELECT diskName FROM serverIcons WHERE serverId=?', serverId), ...all('SELECT diskName FROM serverEmojis WHERE serverId=? UNION SELECT staticDiskName AS diskName FROM serverEmojis WHERE serverId=?', serverId, serverId)];
    run('DELETE FROM servers WHERE id=?', serverId); files.forEach(file => removeFile(file.diskName)); emitUsers(audience, 'sync'); response.json({ ok: true });
  }));
  app.get('/api/servers/:id/members', api((request, response) => { member(request.userId!, request.params.id as string); response.json({ members: all('SELECT userId,role,serverMuted,serverDeafened FROM members WHERE serverId=?', request.params.id).map(row => ({ user: user(row.userId), role: row.role, serverMuted: Boolean(row.serverMuted), serverDeafened: Boolean(row.serverDeafened) })) }); }));
  app.post('/api/servers/:id/members/:userId/voice', api((request, response) => {
    const serverId = request.params.id as string; const targetId = request.params.userId as string;
    const actor = member(request.userId!, serverId, true); const target = member(targetId, serverId);
    if (targetId === request.userId || target.role === 'owner' || (actor.role === 'admin' && target.role === 'admin')) throw new ApiError(403, 'Cannot moderate this member');
    const body = z.object({ action: z.enum(['disconnect', 'mute', 'deafen']), enabled: z.boolean().default(true) }).parse(request.body);
    if (body.action === 'disconnect') revoke(targetId, serverId, 'moderator-disconnected');
    else {
      run(`UPDATE members SET ${body.action === 'mute' ? 'serverMuted' : 'serverDeafened'}=? WHERE serverId=? AND userId=?`, body.enabled ? 1 : 0, serverId, targetId);
      const flags = member(targetId, serverId); const moderation = { serverId, muted: Boolean(flags.serverMuted), deafened: Boolean(flags.serverDeafened) };
      emitUsers([targetId], 'voice:moderated', moderation);
      for (const peer of voice.values()) if (peer.user.id === targetId && one('SELECT serverId FROM channels WHERE id=?', peer.channelId)?.serverId === serverId) {
        peer.serverMuted = moderation.muted; peer.serverDeafened = moderation.deafened; peer.muted ||= moderation.muted || moderation.deafened; peer.deafened ||= moderation.deafened; peer.speaking = false;
        emitUsers(serverAudience(serverId), 'voice:state', { socketId: peer.socketId, channelId: peer.channelId, muted: peer.muted, deafened: peer.deafened, sharing: peer.sharing, speaking: false, serverMuted: peer.serverMuted, serverDeafened: peer.serverDeafened });
      }
    }
    syncServer(serverId); response.json({ ok: true });
  }));
  app.patch('/api/servers/:id/members/:userId', api((request, response) => {
    const serverId = request.params.id as string; const target = request.params.userId as string;
    if (member(request.userId!, serverId).role !== 'owner') throw new ApiError(403, 'Only owners can manage roles');
    if (member(target, serverId).role === 'owner') throw new ApiError(400, 'Owner role cannot be changed');
    const body = z.object({ role: z.enum(['admin', 'member']) }).parse(request.body);
    run('UPDATE members SET role=? WHERE serverId=? AND userId=?', body.role, serverId, target); syncServer(serverId); response.json({ ok: true });
  }));
  app.delete('/api/servers/:id/members/:userId', api((request, response) => {
    const serverId = request.params.id as string; const target = request.params.userId as string;
    const actor = member(request.userId!, serverId); const victim = member(target, serverId);
    if (victim.role === 'owner' || (target !== request.userId && (actor.role === 'member' || (actor.role === 'admin' && victim.role === 'admin')))) throw new ApiError(403, 'Cannot remove this member');
    revoke(target, serverId); run('DELETE FROM members WHERE serverId=? AND userId=?', serverId, target); syncServer(serverId); emitUsers([target], 'sync'); response.json({ ok: true });
  }));
  app.post('/api/servers/:id/invites', api((request, response) => {
    member(request.userId!, request.params.id as string, true);
    const body = z.object({ expiresInHours: z.number().int().min(1).max(720).nullable().default(168) }).parse(request.body ?? {});
    const code = randomBytes(9).toString('base64url'); const createdAt = now();
    const expiresAt = body.expiresInHours === null ? null : createdAt + body.expiresInHours * 3600_000;
    run('INSERT INTO invites(code,serverId,createdAt,expiresAt,revokedAt) VALUES(?,?,?,?,NULL)', code, request.params.id, createdAt, expiresAt);
    response.status(201).json({ code, expiresAt });
  }));
  app.get('/api/servers/:id/invites', api((request, response) => {
    member(request.userId!, request.params.id as string, true);
    response.json({ invites: all('SELECT code,createdAt,expiresAt,revokedAt FROM invites WHERE serverId=? ORDER BY createdAt DESC', request.params.id) });
  }));
  app.delete('/api/invites/:code', api((request, response) => {
    const found = one('SELECT * FROM invites WHERE code=?', request.params.code);
    if (!found) throw new ApiError(404, 'Invite not found');
    member(request.userId!, found.serverId, true);
    run('UPDATE invites SET revokedAt=COALESCE(revokedAt,?) WHERE code=?', now(), found.code);
    response.json({ ok: true });
  }));
  app.post('/api/invites/:code/join', api((request, response) => {
    const found = db.transaction(() => {
      const invitation = validInvite(request.params.code as string);
      run("INSERT OR IGNORE INTO members(serverId,userId,role) VALUES(?,?,'member')", invitation.serverId, request.userId);
      return invitation;
    })();
    syncServer(found.serverId); response.json({ serverId: found.serverId });
  }));
  app.post('/api/servers/:id/channels', api((request, response) => {
    member(request.userId!, request.params.id as string, true); const body = z.object({ name: text(80), type: z.enum(['text', 'voice']), topic: z.string().max(500).optional() }).parse(request.body);
    const channelId = id(); const position = one('SELECT COALESCE(MAX(position),0)+1 AS position FROM channels WHERE serverId=?', request.params.id)!.position;
    run('INSERT INTO channels VALUES(?,?,?,?,?,?)', channelId, request.params.id, body.name, body.type, body.topic ?? '', position); syncServer(request.params.id as string); response.status(201).json({ channel: one('SELECT * FROM channels WHERE id=?', channelId) });
  }));
  app.patch('/api/channels/:id', api((request, response) => {
    const current = channel(request.userId!, request.params.id as string, true); const body = z.object({ name: text(80).optional(), topic: z.string().max(500).optional(), position: z.number().int().min(0).max(10000).optional() }).parse(request.body);
    run('UPDATE channels SET name=?,topic=?,position=? WHERE id=?', body.name ?? current.name, body.topic ?? current.topic, body.position ?? current.position, current.id); syncServer(current.serverId); response.json({ channel: one('SELECT * FROM channels WHERE id=?', current.id) });
  }));
  app.delete('/api/channels/:id', api((request, response) => { const current = channel(request.userId!, request.params.id as string, true); for (const socket of io.sockets.sockets.values()) if (voice.get(socket.id)?.channelId === current.id) { socket.emit('voice:disconnect', { reason: 'channel-deleted' }); leaveVoice(socket); } const files = all('SELECT diskName FROM attachments WHERE channelId=?', current.id); run('DELETE FROM channels WHERE id=?', current.id); files.forEach(file => removeFile(file.diskName)); syncServer(current.serverId); response.json({ ok: true }); }));
  app.get('/api/messages', api((request, response) => {
    const value = scopeSchema.parse(request.query); scope(request.userId!, value, true);
    const limit = z.coerce.number().int().min(1).max(100).default(50).parse(request.query.limit);
    const before = z.coerce.number().min(0).default(Number.MAX_SAFE_INTEGER).parse(request.query.before);
    const query = z.string().max(200).default('').parse(request.query.q);
    const rows = all(`SELECT id FROM messages WHERE ${value.channelId ? 'channelId' : 'conversationId'}=? AND createdAt<? AND instr(lower(content),lower(?))>0 ORDER BY createdAt DESC,rowid DESC LIMIT ?`, value.channelId ?? value.conversationId, before, query, limit + 1);
    response.json({ messages: rows.slice(0, limit).reverse().map(row => message(row.id)), hasMore: rows.length > limit });
  }));
  app.post('/api/messages', api((request, response) => {
    rate(`message:${request.userId}`, 60);
    const body = z.object({ channelId: z.string().optional(), conversationId: z.string().optional(), content: z.string().trim().max(4000).default(''), replyTo: z.string().nullable().optional(), attachmentIds: z.array(z.string()).max(10).default([]) }).parse(request.body);
    scope(request.userId!, body, true, true);
    validateEmojiTokens(request.userId!, body.content, body.channelId);
    if (!body.content && !body.attachmentIds.length) throw new ApiError(400, 'Message cannot be empty');
    if (body.replyTo) { const reply = message(body.replyTo); if (reply.channelId !== (body.channelId ?? null) || reply.conversationId !== (body.conversationId ?? null)) throw new ApiError(400, 'Reply must belong to the same conversation'); }
    const messageId = id();
    db.transaction(() => {
      for (const attachmentId of body.attachmentIds) { const found = one('SELECT * FROM attachments WHERE id=?', attachmentId); if (!found || found.uploaderId !== request.userId || found.messageId || found.channelId !== (body.channelId ?? null) || found.conversationId !== (body.conversationId ?? null)) throw new ApiError(403, 'Attachment permission denied'); }
      const createdAt = Math.max(now(), one('SELECT COALESCE(MAX(createdAt),0)+1 AS timestamp FROM messages')!.timestamp);
      run('INSERT INTO messages VALUES(?,?,?,?,?,?,?,NULL)', messageId, body.channelId ?? null, body.conversationId ?? null, request.userId, body.content, body.replyTo ?? null, createdAt);
      for (const attachmentId of body.attachmentIds) run('UPDATE attachments SET messageId=? WHERE id=?', messageId, attachmentId);
    })();
    const result = message(messageId); emitMessage(result); response.status(201).json({ message: result });
  }));
  app.patch('/api/messages/:id', api((request, response) => { const found = message(request.params.id as string); scope(request.userId!, found, false, true); if (found.authorId !== request.userId) throw new ApiError(403, 'You can only edit your messages'); const body = z.object({ content: text(4000) }).parse(request.body); validateEmojiTokens(request.userId!, body.content, found.channelId); run('UPDATE messages SET content=?,editedAt=? WHERE id=?', body.content, now(), found.id); const result = message(found.id); emitMessage(result, true); response.json({ message: result }); }));
  app.delete('/api/messages/:id', api((request, response) => { const found = message(request.params.id as string); scope(request.userId!, found); if (found.authorId !== request.userId) { if (!found.channelId) throw new ApiError(403, 'You can only delete your messages'); channel(request.userId!, found.channelId, true); } const audience = scopeAudience(found); const files = all('SELECT diskName FROM attachments WHERE messageId=?', found.id); run('DELETE FROM messages WHERE id=?', found.id); files.forEach(file => removeFile(file.diskName)); emitUsers(audience, 'message:delete', { id: found.id, channelId: found.channelId, conversationId: found.conversationId }); response.json({ ok: true }); }));
  app.post('/api/messages/:id/reactions', api((request, response) => { const found = message(request.params.id as string); scope(request.userId!, found, false, true); const body = z.object({ emoji: text(64) }).parse(request.body); validateEmojiTokens(request.userId!, body.emoji, found.channelId); const previous = one('SELECT 1 FROM reactions WHERE messageId=? AND userId=? AND emoji=?', found.id, request.userId, body.emoji); if (previous) run('DELETE FROM reactions WHERE messageId=? AND userId=? AND emoji=?', found.id, request.userId, body.emoji); else run('INSERT INTO reactions VALUES(?,?,?)', found.id, request.userId, body.emoji); const result = message(found.id); emitMessage(result, true); response.json({ message: result }); }));
  const upload = multer({ dest: uploadDir, limits: { fileSize: 25 * 1024 * 1024, files: 1, fields: 5 } });
  const removeFile = (diskName: string) => { try { unlinkSync(path.join(uploadDir, path.basename(diskName))); } catch {} };
  const uploadRate = (request: AuthRequest, _response: Response, next: NextFunction) => { try { rate(`upload:${request.userId}`, 20); next(); } catch (error) { next(error); } };
  const imageUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 256 * 1024, files: 2, fields: 1, fieldSize: 128 } });
  const iconUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1024 * 1024, files: 1, fields: 0 } });
  const manageServer = (request: AuthRequest, _response: Response, next: NextFunction) => { try { member(request.userId!, request.params.id as string, true); next(); } catch (error) { next(error); } };
  const raster = (bytes: Buffer, dimension: number) => { try { return inspectRaster(bytes, dimension); } catch (error) { throw new ApiError(400, error instanceof Error ? error.message : 'Invalid image'); } };
  const serverEmoji = (row: Row) => ({ id: row.id, serverId: row.serverId, name: row.name, animated: Boolean(row.animated), url: `/api/emojis/${row.id}/image`, staticUrl: `/api/emojis/${row.id}/static`, uploaderId: row.uploaderId, createdAt: row.createdAt });
  const validateEmojiTokens = (userId: string, content: string, channelId?: string | null) => {
    for (const token of content.matchAll(/:hvn_([A-Za-z0-9-]+):/g)) {
      const found = one('SELECT serverId FROM serverEmojis WHERE id=?', token[1]);
      if (!found || !channelId || channel(userId, channelId).serverId !== found.serverId) throw new ApiError(400, 'Custom emojis can only be used in their own server');
    }
  };
  app.get('/api/servers/:id/emojis', api((request, response) => { member(request.userId!, request.params.id as string); response.json({ emojis: all('SELECT * FROM serverEmojis WHERE serverId=? ORDER BY name', request.params.id).map(serverEmoji) }); }));
  app.post('/api/servers/:id/emojis', manageServer, uploadRate, imageUpload.fields([{ name: 'file', maxCount: 1 }, { name: 'staticFile', maxCount: 1 }]), api((request, response) => {
    const serverId = request.params.id as string; const name = z.string().trim().min(2).max(32).regex(/^[A-Za-z0-9_]+$/, 'Emoji names use letters, numbers and underscores').parse(request.body.name);
    if (one('SELECT 1 FROM serverEmojis WHERE serverId=? AND name=?', serverId, name)) throw new ApiError(409, 'An emoji with this name already exists');
    if (one('SELECT COUNT(*) AS count FROM serverEmojis WHERE serverId=?', serverId)!.count >= 50) throw new ApiError(400, 'This server already has 50 custom emojis');
    const files = request.files as Record<string, Express.Multer.File[]>; const file = files?.file?.[0]; const fallback = files?.staticFile?.[0];
    if (!file) throw new ApiError(400, 'Choose an emoji image up to 256 KB');
    const info = raster(file.buffer, 128);
    if (info.animated && !fallback) throw new ApiError(400, 'Animated emojis require a static PNG preview');
    if (fallback) { const poster = raster(fallback.buffer, 128); if (poster.mime !== 'image/png' || poster.animated || poster.width !== info.width || poster.height !== info.height) throw new ApiError(400, 'Static preview must be a non-animated PNG with matching dimensions'); }
    const emojiId = id(); const diskName = `emoji-${emojiId}`; const staticDiskName = info.animated ? `${diskName}-static` : diskName;
    try {
      writeFileSync(path.join(uploadDir, diskName), file.buffer, { flag: 'wx' });
      if (info.animated) writeFileSync(path.join(uploadDir, staticDiskName), fallback!.buffer, { flag: 'wx' });
      run('INSERT INTO serverEmojis VALUES(?,?,?,?,?,?,?,?,?)', emojiId, serverId, name, info.animated ? 1 : 0, info.mime, diskName, staticDiskName, request.userId, now());
    } catch (error) { removeFile(diskName); if (staticDiskName !== diskName) removeFile(staticDiskName); throw error; }
    syncServer(serverId); response.status(201).json({ emoji: serverEmoji(one('SELECT * FROM serverEmojis WHERE id=?', emojiId)!) });
  }));
  app.patch('/api/emojis/:id', api((request, response) => {
    const found = one('SELECT * FROM serverEmojis WHERE id=?', request.params.id); if (!found) throw new ApiError(404, 'Emoji not found'); member(request.userId!, found.serverId, true);
    const body = z.object({ name: z.string().trim().min(2).max(32).regex(/^[A-Za-z0-9_]+$/) }).parse(request.body);
    if (one('SELECT 1 FROM serverEmojis WHERE serverId=? AND name=? AND id<>?', found.serverId, body.name, found.id)) throw new ApiError(409, 'An emoji with this name already exists');
    run('UPDATE serverEmojis SET name=? WHERE id=?', body.name, found.id); syncServer(found.serverId); response.json({ emoji: serverEmoji(one('SELECT * FROM serverEmojis WHERE id=?', found.id)!) });
  }));
  app.delete('/api/emojis/:id', api((request, response) => { const found = one('SELECT * FROM serverEmojis WHERE id=?', request.params.id); if (!found) throw new ApiError(404, 'Emoji not found'); member(request.userId!, found.serverId, true); run('DELETE FROM serverEmojis WHERE id=?', found.id); removeFile(found.diskName); if (found.diskName !== found.staticDiskName) removeFile(found.staticDiskName); syncServer(found.serverId); response.json({ ok: true }); }));
  const sendImage = (response: Response, mime: string, diskName: string) => { response.setHeader('Content-Type', mime); response.setHeader('Cache-Control', 'private, max-age=0, must-revalidate'); response.setHeader('Content-Security-Policy', "default-src 'none'"); response.sendFile(path.resolve(uploadDir, path.basename(diskName))); };
  app.get('/api/emojis/:id/:variant', api((request, response) => { const found = one('SELECT * FROM serverEmojis WHERE id=?', request.params.id); if (!found || !['image', 'static'].includes(request.params.variant as string)) throw new ApiError(404, 'Emoji not found'); member(request.userId!, found.serverId); const poster = request.params.variant === 'static' && found.animated; sendImage(response, poster ? 'image/png' : found.mime, request.params.variant === 'static' ? found.staticDiskName : found.diskName); }));
  app.post('/api/servers/:id/icon', manageServer, uploadRate, iconUpload.single('file'), api((request, response) => {
    if (!request.file) throw new ApiError(400, 'Choose a static server icon up to 1 MB'); const info = raster(request.file.buffer, 1024); if (info.animated) throw new ApiError(400, 'Server icons must be static images');
    const serverId = request.params.id as string; const diskName = `icon-${id()}`; const previous = one('SELECT diskName FROM serverIcons WHERE serverId=?', serverId);
    try { writeFileSync(path.join(uploadDir, diskName), request.file.buffer, { flag: 'wx' }); db.transaction(() => { run('INSERT INTO serverIcons VALUES(?,?,?) ON CONFLICT(serverId) DO UPDATE SET mime=excluded.mime,diskName=excluded.diskName', serverId, info.mime, diskName); run('UPDATE servers SET icon=? WHERE id=?', `/api/servers/${serverId}/icon?v=${diskName.slice(5)}`, serverId); })(); } catch (error) { removeFile(diskName); throw error; }
    if (previous) removeFile(previous.diskName); syncServer(serverId); response.json({ server: one('SELECT * FROM servers WHERE id=?', serverId) });
  }));
  app.get('/api/servers/:id/icon', api((request, response) => { member(request.userId!, request.params.id as string); const found = one('SELECT * FROM serverIcons WHERE serverId=?', request.params.id); if (!found) throw new ApiError(404, 'Server icon not found'); sendImage(response, found.mime, found.diskName); }));
  app.post('/api/attachments', uploadRate, upload.single('file'), api((request, response) => {
    try {
      const body = scopeSchema.parse(request.body); scope(request.userId!, body, true, true);
      if (!request.file) throw new ApiError(400, 'Choose a file');
      const attachmentId = id(); const name = path.basename(request.file.originalname).slice(0, 255);
      run('INSERT INTO attachments VALUES(?,?,?,?,NULL,?,?,?,?)', attachmentId, body.channelId ?? null, body.conversationId ?? null, request.userId, name, request.file.mimetype, request.file.size, request.file.filename);
      response.status(201).json({ attachment: { id: attachmentId, name, mime: request.file.mimetype, size: request.file.size, url: `/api/attachments/${attachmentId}` } });
    } catch (error) { if (request.file) removeFile(request.file.filename); throw error; }
  }));
  app.get('/api/attachments/:id', api((request, response) => {
    const found = one('SELECT * FROM attachments WHERE id=?', request.params.id); if (!found) throw new ApiError(404, 'Attachment not found'); scope(request.userId!, found);
    response.setHeader('Content-Type', found.mime); response.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(found.name)}`); response.setHeader('Content-Security-Policy', "default-src 'none'; sandbox"); response.sendFile(path.resolve(uploadDir, path.basename(found.diskName)));
  }));
  app.post('/api/friends/requests', api((request, response) => {
    const body = z.object({ username: z.string().trim().transform(value => value.replace(/^@/, '').toLowerCase()).pipe(z.string().regex(/^[a-z0-9_.-]{3,32}$/, 'Enter the account username (3–32 letters, numbers, dots, dashes or underscores)')) }).parse(request.body); const target = one('SELECT id FROM users WHERE username=?', body.username);
    if (!target) throw new ApiError(404, 'User not found'); if (target.id === request.userId) throw new ApiError(400, 'You cannot friend yourself');
    const result = db.transaction(() => {
      if (blockedPair(request.userId!, target.id)) throw new ApiError(403, 'Friend requests are unavailable between these accounts');
      if (one('SELECT 1 FROM friends WHERE userId=? AND friendId=?', request.userId, target.id)) throw new ApiError(409, 'You are already friends');
      const pending = one('SELECT * FROM friendRequests WHERE (fromId=? AND toId=?) OR (fromId=? AND toId=?)', request.userId, target.id, target.id, request.userId);
      if (pending) throw new ApiError(409, pending.toId === request.userId ? 'This person already sent you a request. Accept it in Incoming requests.' : 'You already sent this person a friend request');
      const requestId = id(); run('INSERT INTO friendRequests VALUES(?,?,?,?)', requestId, request.userId, target.id, now());
      return one('SELECT * FROM friendRequests WHERE id=?', requestId);
    })();
    emitUsers([request.userId!, target.id], 'sync'); response.status(201).json({ request: result });
  }));
  app.post('/api/friends/requests/:id/accept', api((request, response) => {
    const found = db.transaction(() => {
      const pending = one('SELECT * FROM friendRequests WHERE id=?', request.params.id);
      if (!pending || pending.toId !== request.userId) throw new ApiError(403, 'Request permission denied');
      if (blockedPair(pending.fromId, pending.toId)) throw new ApiError(403, 'Friend requests are unavailable between these accounts');
      run('INSERT OR IGNORE INTO friends VALUES(?,?)', pending.fromId, pending.toId); run('INSERT OR IGNORE INTO friends VALUES(?,?)', pending.toId, pending.fromId);
      run('DELETE FROM friendRequests WHERE (fromId=? AND toId=?) OR (fromId=? AND toId=?)', pending.fromId, pending.toId, pending.toId, pending.fromId);
      return pending;
    })();
    emitUsers([found.fromId, found.toId], 'sync'); response.json({ ok: true });
  }));
  app.delete('/api/friends/requests/:id', api((request, response) => { const found = one('SELECT * FROM friendRequests WHERE id=?', request.params.id); if (!found || ![found.fromId, found.toId].includes(request.userId)) throw new ApiError(403, 'Request permission denied'); run('DELETE FROM friendRequests WHERE id=?', found.id); emitUsers([found.fromId, found.toId], 'sync'); response.json({ ok: true }); }));
  app.delete('/api/friends/:userId', api((request, response) => { run('DELETE FROM friends WHERE (userId=? AND friendId=?) OR (userId=? AND friendId=?)', request.userId, request.params.userId, request.params.userId, request.userId); emitUsers([request.userId!, request.params.userId as string], 'sync'); response.json({ ok: true }); }));
  app.post('/api/users/:id/block', api((request, response) => {
    const target = request.params.id as string;
    if (target === request.userId) throw new ApiError(400, 'You cannot block yourself');
    user(target);
    db.transaction(() => {
      run('INSERT OR IGNORE INTO blocks VALUES(?,?,?)', request.userId, target, now());
      run('DELETE FROM friends WHERE (userId=? AND friendId=?) OR (userId=? AND friendId=?)', request.userId, target, target, request.userId);
      run('DELETE FROM friendRequests WHERE (fromId=? AND toId=?) OR (fromId=? AND toId=?)', request.userId, target, target, request.userId);
    })();
    emitUsers([request.userId!, target], 'sync'); response.json({ ok: true });
  }));
  app.delete('/api/users/:id/block', api((request, response) => {
    run('DELETE FROM blocks WHERE userId=? AND blockedId=?', request.userId, request.params.id);
    emitUsers([request.userId!, request.params.id as string], 'sync'); response.json({ ok: true });
  }));
  app.post('/api/conversations', api((request, response) => {
    const body = z.object({ memberIds: z.array(z.string()).min(1).max(9), name: z.string().trim().max(80).default('') }).parse(request.body);
    const members = [...new Set([request.userId!, ...body.memberIds])]; if (members.length < 2) throw new ApiError(400, 'Choose another participant');
    for (const first of members) for (const second of members) if (first !== second && blockedPair(first, second)) throw new ApiError(403, 'A blocked account cannot be added to a new conversation');
    for (const target of members.filter(userId => userId !== request.userId)) if (!one('SELECT 1 FROM friends WHERE userId=? AND friendId=?', request.userId, target)) throw new ApiError(403, 'You may invite friends to conversations');
    if (members.length === 2) {
      const existing = one('SELECT a.conversationId AS id FROM conversationMembers a JOIN conversationMembers b ON a.conversationId=b.conversationId WHERE a.userId=? AND b.userId=? AND (SELECT count(*) FROM conversationMembers c WHERE c.conversationId=a.conversationId)=2', members[0], members[1]);
      if (existing) return response.json({ conversation: conversation(existing.id) });
    }
    const conversationId = id(); db.transaction(() => { run('INSERT INTO conversations VALUES(?,?,?)', conversationId, body.name, now()); members.forEach(userId => run('INSERT INTO conversationMembers VALUES(?,?)', conversationId, userId)); })(); emitUsers(members, 'sync'); response.status(201).json({ conversation: conversation(conversationId) });
  }));
  app.patch('/api/conversations/:id', api((request, response) => { scope(request.userId!, { conversationId: request.params.id as string }, false, true); const body = z.object({ name: text(80) }).parse(request.body); run('UPDATE conversations SET name=? WHERE id=?', body.name, request.params.id); emitUsers(scopeAudience({ conversationId: request.params.id }), 'sync'); response.json({ conversation: conversation(request.params.id as string) }); }));
  app.delete('/api/conversations/:id/members/me', api((request, response) => { scope(request.userId!, { conversationId: request.params.id as string }); const audience = scopeAudience({ conversationId: request.params.id }); run('DELETE FROM conversationMembers WHERE conversationId=? AND userId=?', request.params.id, request.userId); emitUsers(audience, 'sync'); response.json({ ok: true }); }));
  const sound = (row: Row) => ({ id: row.id, serverId: row.serverId, uploaderId: row.uploaderId, name: row.name, url: `/api/sounds/${row.id}/audio` });
  app.get('/api/servers/:id/sounds', api((request, response) => { member(request.userId!, request.params.id as string); response.json({ sounds: all('SELECT * FROM sounds WHERE serverId=?', request.params.id).map(sound) }); }));
  app.post('/api/servers/:id/sounds', (request: AuthRequest, _response, next) => { try { member(request.userId!, request.params.id as string); next(); } catch (error) { next(error); } }, uploadRate, upload.single('file'), api((request, response) => {
    try { const body = z.object({ name: text(50) }).parse(request.body); if (!request.file || request.file.size > 5 * 1024 * 1024 || !request.file.mimetype.startsWith('audio/')) throw new ApiError(400, 'Choose an audio file up to 5 MB'); const soundId = id(); run('INSERT INTO sounds VALUES(?,?,?,?,?,?,?)', soundId, request.params.id, request.userId, body.name, request.file.mimetype, request.file.size, request.file.filename); syncServer(request.params.id as string); response.status(201).json({ sound: sound(one('SELECT * FROM sounds WHERE id=?', soundId)!) }); } catch (error) { if (request.file) removeFile(request.file.filename); throw error; }
  }));
  app.get('/api/sounds/:id/audio', api((request, response) => { const found = one('SELECT * FROM sounds WHERE id=?', request.params.id); if (!found) throw new ApiError(404, 'Sound not found'); member(request.userId!, found.serverId); response.setHeader('Content-Type', found.mime); response.sendFile(path.resolve(uploadDir, path.basename(found.diskName))); }));
  app.delete('/api/sounds/:id', api((request, response) => { const found = one('SELECT * FROM sounds WHERE id=?', request.params.id); if (!found) throw new ApiError(404, 'Sound not found'); member(request.userId!, found.serverId, found.uploaderId !== request.userId); run('DELETE FROM sounds WHERE id=?', found.id); removeFile(found.diskName); syncServer(found.serverId); response.json({ ok: true }); }));
  app.get('/api/rtc', api((_request, response) => { let iceServers: unknown = [{ urls: 'stun:stun.l.google.com:19302' }]; if (process.env.ICE_SERVERS_JSON) { try { iceServers = JSON.parse(process.env.ICE_SERVERS_JSON); if (!Array.isArray(iceServers)) throw new Error(); } catch { throw new ApiError(500, 'Invalid ICE_SERVERS_JSON configuration'); } } response.json({ iceServers }); }));
  io.use((socket, next) => { const userId = sessionUser(socket.request.headers.cookie); if (!userId) return next(new Error('Sign in to continue')); socket.data.userId = userId; socket.data.sessionHash = tokenHash(parseCookies(socket.request.headers.cookie).relay_session); next(); });
  io.on('connection', socket => {
    const userId = socket.data.userId as string; socket.join(`user:${userId}`);
    emitUsers(visibleAudience(userId), 'presence', { userId, status: user(userId).status });
    const event = (name: string, handler: (payload: any) => unknown) => socket.on(name, (payload = {}, ack?: (result: unknown) => void) => {
      try {
        if (!one('SELECT 1 FROM sessions WHERE token=? AND expiresAt>?', socket.data.sessionHash, now())) { socket.disconnect(true); throw new ApiError(401, 'Session expired'); }
        if (name === 'voice:activity') rate(`voice-activity:${socket.id}`, 240); else rate(`socket:${userId}`, 300);
        const result = handler(payload); if (typeof ack === 'function') ack(result ?? { ok: true });
      } catch (error) { if (typeof ack === 'function') ack({ error: error instanceof Error ? error.message : 'Request failed' }); }
    });
    event('typing', payload => { const value = scopeSchema.parse(payload); scope(userId, value, true, true); rate(`typing:${userId}`, 30); emitUsers(scopeAudience(value).filter(target => target !== userId), 'typing', { scope: value.channelId ?? value.conversationId, userId }); });
    event('voice:join', payload => {
      const body = z.object({ channelId: z.string() }).parse(payload); const current = channel(userId, body.channelId); if (current.type !== 'voice') throw new ApiError(400, 'Choose a voice channel');
      const peers = [...voice.values()].filter(peer => peer.channelId === current.id && peer.socketId !== socket.id); if (peers.length >= 8) throw new ApiError(409, 'Voice channel is full (8 participants)');
      const flags = member(userId, current.serverId); const moderation = { serverId: current.serverId, muted: Boolean(flags.serverMuted), deafened: Boolean(flags.serverDeafened) };
      if (voice.get(socket.id)?.channelId === current.id) return { peers, moderation };
      leaveVoice(socket); const profile = user(userId); const participant = { socketId: socket.id, user: profile, channelId: current.id, muted: moderation.muted || moderation.deafened, deafened: moderation.deafened, serverMuted: moderation.muted, serverDeafened: moderation.deafened, sharing: false, speaking: false }; voice.set(socket.id, participant); socket.join(`voice:${current.id}`); socket.to(`voice:${current.id}`).emit('voice:peer-joined', participant); syncServer(current.serverId); return { peers, moderation };
    });
    event('voice:leave', () => { leaveVoice(socket); });
    event('voice:signal', payload => {
      const body = z.object({ target: z.string(), description: z.object({ type: z.enum(['offer', 'answer', 'pranswer', 'rollback']), sdp: z.string().max(100_000).optional() }).optional(), candidate: z.object({ candidate: z.string().max(5000).optional(), sdpMid: z.string().nullable().optional(), sdpMLineIndex: z.number().nullable().optional(), usernameFragment: z.string().nullable().optional() }).nullable().optional() }).parse(payload);
      const source = voice.get(socket.id); const target = voice.get(body.target); if (!source || !target || source.channelId !== target.channelId) throw new ApiError(403, 'Voice peer permission denied'); channel(userId, source.channelId); channel(target.user.id, target.channelId); io.to(body.target).emit('voice:signal', { from: socket.id, description: body.description, candidate: body.candidate });
    });
    event('voice:state', payload => {
      const body = z.object({ muted: z.boolean(), deafened: z.boolean(), sharing: z.boolean() }).parse(payload); const current = voice.get(socket.id);
      if (!current) throw new ApiError(400, 'Join voice first');
      const currentChannel = channel(userId, current.channelId);
      Object.assign(current, body, { muted: body.muted || Boolean(current.serverMuted) || Boolean(current.serverDeafened), deafened: body.deafened || Boolean(current.serverDeafened) }); if (current.muted || current.deafened) current.speaking = false;
      emitUsers(serverAudience(currentChannel.serverId), 'voice:state', { socketId: socket.id, channelId: current.channelId, muted: current.muted, deafened: current.deafened, sharing: current.sharing, speaking: current.speaking ?? false, serverMuted: current.serverMuted ?? false, serverDeafened: current.serverDeafened ?? false });
    });
    event('voice:activity', payload => {
      const body = z.object({ speaking: z.boolean() }).parse(payload); const current = voice.get(socket.id);
      if (!current) throw new ApiError(400, 'Join voice first');
      const currentChannel = channel(userId, current.channelId);
      const speaking = body.speaking && !current.muted && !current.deafened;
      if (current.speaking === speaking) return;
      current.speaking = speaking;
      emitUsers(serverAudience(currentChannel.serverId), 'voice:activity', { socketId: socket.id, channelId: current.channelId, speaking });
    });
    event('sound:play', payload => { const body = z.object({ soundId: z.string() }).parse(payload); const current = voice.get(socket.id); if (!current) throw new ApiError(400, 'Join voice first'); const room = channel(userId, current.channelId); const found = one('SELECT * FROM sounds WHERE id=? AND serverId=?', body.soundId, room.serverId); if (!found) throw new ApiError(404, 'Sound not found'); rate(`sound:${userId}`, 10); io.to(`voice:${current.channelId}`).emit('sound:play', { sound: sound(found), userId }); });
    socket.on('disconnect', () => { leaveVoice(socket); if (!connected(userId)) emitUsers(visibleAudience(userId), 'presence', { userId, status: 'offline' }); });
  });
  const dist = path.resolve('dist');
  if (existsSync(dist)) { app.use(express.static(dist)); app.get('/{*path}', (request, response, next) => request.path.startsWith('/api/') ? next() : response.sendFile(path.join(dist, 'index.html'))); }
  app.use('/api', (_request, response) => response.status(404).json({ error: 'Endpoint not found' }));
  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if (error instanceof z.ZodError) return response.status(400).json({ error: error.issues.map(issue => issue.message).join('; ') });
    if (error instanceof ApiError) return response.status(error.status).json({ error: error.message });
    if (error instanceof multer.MulterError) return response.status(400).json({ error: error.message });
    if (error instanceof SyntaxError) return response.status(400).json({ error: 'Invalid JSON' });
    console.error(error); response.status(500).json({ error: 'Internal server error' });
  });
  const close = async () => { clearInterval(cleanupTimer); await new Promise<void>(resolve => io.close(() => resolve())); if (httpServer.listening) await new Promise<void>((resolve, reject) => httpServer.close(error => error ? reject(error) : resolve())); db.close(); };
  return { app, httpServer, io, db, close };
}
