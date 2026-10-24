import type { IncomingMessage, ServerResponse } from 'node:http';
import { Server as SocketIOServer } from 'socket.io';
import type { ViteDevServer } from 'vite';
import { buildBootstrapPayload, createInitialMockDatabase, type MockDatabase } from './mock-data.js';
import type { Channel, Conversation, Message, Role, Server, Sound, User, VoicePeer } from '@haven/shared/types';
import { placeholderIdentity, usernameProblem } from '@haven/shared/auth';

export interface CommunityMember {
  userId: string;
  role: Role;
  joinedAt: number;
  user: User;
  serverMuted?: boolean;
  serverDeafened?: boolean;
}

function generateMockWav(durationMs = 400, frequency = 520): Buffer {
  const sampleRate = 44100;
  const numSamples = Math.floor((durationMs / 1000) * sampleRate);
  const blockAlign = 2;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numSamples * blockAlign;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const sample = Math.sin(2 * Math.PI * frequency * t) * Math.exp(-t * 6) * 0.35;
    const intSample = Math.max(-32768, Math.min(32767, Math.floor(sample * 32767)));
    buffer.writeInt16LE(intSample, 44 + i * 2);
  }

  return buffer;
}

const mockAudioBuffer = generateMockWav(400, 587.33); // D5 chime

function sendJson(res: ServerResponse, status: number, data: unknown) {
  const json = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(json),
    'Cache-Control': 'no-store',
  });
  res.end(json);
}

function parseJsonBody(req: IncomingMessage): Promise<Record<string, any>> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        resolve({});
      }
    });
  });
}


function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise(resolve => {
    const chunks: Buffer[] = [];
    req.on('data', chunk => chunks.push(Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

// Minimal multipart reader for the single-file avatar upload the app sends.
function readUploadedImage(body: Buffer, contentType: string): { mime: string; data: Buffer } | string {
  const boundary = /boundary=(.+)$/.exec(contentType)?.[1];
  if (!boundary) return 'Choose a profile picture up to 1 MB';
  const start = body.indexOf(`--${boundary}`);
  const headerEnd = body.indexOf('\r\n\r\n', start);
  const end = body.indexOf(`\r\n--${boundary}`, headerEnd);
  if (start < 0 || headerEnd < 0 || end < 0) return 'Choose a profile picture up to 1 MB';
  const data = body.subarray(headerEnd + 4, end);
  if (!data.length || data.length > 1024 * 1024) return 'Choose a profile picture up to 1 MB';
  const mime = data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'image/png'
    : data[0] === 0xff && data[1] === 0xd8 ? 'image/jpeg'
    : data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP' ? 'image/webp'
    : data.toString('ascii', 0, 3) === 'GIF' ? 'image/gif' : '';
  return mime ? { mime, data } : 'Choose a valid PNG, JPEG, GIF or WebP image';
}

interface MockAccount { id: string; email: string; password: string; confirmed: boolean }

export function setupMockServer(viteServer: ViteDevServer) {
  const db: MockDatabase = createInitialMockDatabase();
  // Hosted-style accounts for the UI test mode. Like the real backend: a verified email-only account gets a
  // neutral placeholder profile flagged incomplete, and the profile persists here for the life of the dev server.
  const accounts = new Map<string, MockAccount>();
  const profiles = new Map<string, User>();
  const avatars = new Map<string, { mime: string; data: Buffer }>();
  const seededAlex = createInitialMockDatabase().me;
  const takenUsername = (name: string, exceptUserId?: string) => [...db.users.values(), ...profiles.values()].some(user => user.id !== exceptUserId && user.username.toLowerCase() === name.toLowerCase());
  const rememberProfile = () => { if (profiles.has(db.me.id)) profiles.set(db.me.id, { ...db.me }); };

  const serverMembersStore = new Map<string, CommunityMember[]>();
  const getInitialMembers = (serverId: string): CommunityMember[] => {
    const srv = db.servers.get(serverId);
    const isOwner = srv ? srv.role === 'owner' : true;
    const isAdmin = srv ? srv.role === 'admin' : false;
    return [
      { userId: db.me.id, role: isOwner ? 'owner' : isAdmin ? 'admin' : 'member', joinedAt: 1704100000000, user: db.me },
      { userId: 'usr-elena', role: isOwner ? 'admin' : 'owner', joinedAt: 1704200000000, user: db.users.get('usr-elena')!, serverMuted: true },
      { userId: 'usr-marcus', role: 'member', joinedAt: 1704300000000, user: db.users.get('usr-marcus')! },
      { userId: 'usr-sarah', role: 'member', joinedAt: 1704350000000, user: db.users.get('usr-sarah')!, serverDeafened: true },
      { userId: 'usr-devon', role: 'member', joinedAt: 1704400000000, user: db.users.get('usr-devon')! },
      { userId: 'usr-kai', role: 'member', joinedAt: 1704500000000, user: db.users.get('usr-kai')! },
    ];
  };

  // Attach real Socket.IO server to Vite's HTTP server
  const io = new SocketIOServer(viteServer.httpServer!, {
    path: '/socket.io',
    cors: { origin: '*', credentials: true },
  });

  io.on('connection', socket => {
    socket.emit('sync');

    socket.on('typing', payload => {
      socket.broadcast.emit('typing', {
        scope: payload.channelId || payload.conversationId,
        userId: db.me.id,
      });
    });

    socket.on('sound:play', (payload, callback) => {
      const sound = db.sounds.get(payload.soundId);
      if (sound) {
        socket.broadcast.emit('sound:play', { sound, userId: db.me.id });
      }
      if (typeof callback === 'function') callback({});
    });

    socket.on('voice:join', (payload, callback) => {
      const channelId = payload?.channelId;
      const channel = db.channels.get(channelId);
      const referer = socket.handshake.headers.referer || '';
      let isSingle = false;
      let targetCount: number | null = null;
      try {
        const url = new URL(referer, 'http://127.0.0.1:5173');
        const pParam = url.searchParams.get('peers') || url.searchParams.get('participants') || url.searchParams.get('count');
        if (pParam) {
          targetCount = parseInt(pParam, 10);
        }
        isSingle =
          url.searchParams.get('scenario') === 'single' ||
          url.searchParams.get('scenario') === 'solo' ||
          pParam === '1' ||
          url.searchParams.get('mode') === 'single';
      } catch {}

      // Clear any prior membership for this socket or user
      for (const [key, peer] of Array.from(db.voice.entries())) {
        if (peer.socketId === socket.id || peer.user.id === db.me.id) {
          db.voice.delete(key);
        }
      }

      let peers: VoicePeer[];
      if (isSingle || targetCount === 1) {
        peers = [];
      } else if (targetCount !== null && targetCount > 1) {
        // Preferred ordering: Elena, Sarah, Devon, Marcus, Kai, Maya, Liam
        const orderIds = ['usr-elena', 'usr-sarah', 'usr-devon', 'usr-marcus', 'usr-kai', 'usr-maya', 'usr-liam'];
        const remoteUsers: User[] = [];
        for (const uid of orderIds) {
          const u = db.users.get(uid);
          if (u && remoteUsers.length < targetCount - 1) {
            remoteUsers.push(u);
          }
        }
        peers = remoteUsers.map((user, idx) => ({
          socketId: `sock-peer-${user.id}`,
          user,
          channelId,
          muted: idx === 2, // 3rd remote peer muted for realistic testing
          deafened: false,
          sharing: user.id === 'usr-elena' && channelId === 'chn-studio-voice',
          speaking: user.id === 'usr-elena' && channelId === 'chn-studio-voice',
          streamProtocol: user.id === 'usr-elena' ? 1 : undefined,
          broadcastId: user.id === 'usr-elena' ? 'broadcast-studio-elena' : undefined,
        }));
      } else {
        peers = Array.from(db.voice.values()).filter(peer => peer.channelId === channelId);
      }

      const participant: VoicePeer = {
        socketId: socket.id,
        user: db.me,
        channelId,
        muted: false,
        deafened: false,
        sharing: false,
        speaking: false,
      };
      db.voice.set(socket.id, participant);
      socket.broadcast.emit('voice:peer-joined', participant);
      io.emit('sync');

      if (typeof callback === 'function') {
        callback({
          capabilities: { streamSubscriptions: 1 },
          peers,
          moderation: {
            serverId: channel?.serverId || '',
            muted: false,
            deafened: false,
          },
        });
      }
    });

    socket.on('voice:leave', () => {
      let removed = false;
      for (const [key, peer] of Array.from(db.voice.entries())) {
        if (peer.socketId === socket.id || peer.user.id === db.me.id) {
          db.voice.delete(key);
          removed = true;
        }
      }
      if (removed) {
        socket.broadcast.emit('voice:peer-left', { socketId: socket.id });
        io.emit('sync');
      }
    });

    socket.on('disconnect', () => {
      let removed = false;
      for (const [key, peer] of Array.from(db.voice.entries())) {
        if (peer.socketId === socket.id || peer.user.id === db.me.id) {
          db.voice.delete(key);
          removed = true;
        }
      }
      if (removed) {
        socket.broadcast.emit('voice:peer-left', { socketId: socket.id });
        io.emit('sync');
      }
    });

    socket.on('voice:state', state => {
      const peer = db.voice.get(socket.id);
      if (peer) {
        Object.assign(peer, state);
      }
      socket.broadcast.emit('voice:state', { socketId: socket.id, ...state });
    });

    socket.on('voice:activity', activity => {
      const peer = db.voice.get(socket.id);
      if (peer) {
        peer.speaking = Boolean(activity.speaking);
      }
      socket.broadcast.emit('voice:activity', { socketId: socket.id, ...activity });
    });

    socket.on('voice:stream-watch', (payload, callback) => {
      const targetSocket = payload?.target;
      if (targetSocket) {
        io.to(targetSocket).emit('voice:stream-watch', { viewerSocketId: socket.id, broadcastId: payload?.broadcastId });
      }
      if (typeof callback === 'function') {
        callback({ protocol: 1, broadcastId: payload?.broadcastId });
      }
    });

    socket.on('voice:stream-unwatch', (payload, callback) => {
      const targetSocket = payload?.target;
      if (targetSocket) {
        io.to(targetSocket).emit('voice:stream-unwatch', { viewerSocketId: socket.id, broadcastId: payload?.broadcastId });
      }
      if (typeof callback === 'function') {
        callback({});
      }
    });
  });

  // Attach Connect middleware for /api/*
  viteServer.middlewares.use(async (req, res, next) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const pathname = url.pathname;

    if (!pathname.startsWith('/api')) {
      return next();
    }

    const method = req.method?.toUpperCase() || 'GET';

    // 1. GET /api/config
    if (pathname === '/api/config' && method === 'GET') {
      return sendJson(res, 200, {
        mode: 'hosted',
        supabaseUrl: 'https://mock.haven.local',
        supabaseAnonKey: 'mock-anon-key-ui-testing-mode',
        publicUrl: 'http://127.0.0.1:5173',
      });
    }

    // Test-mode stand-in for the hosted sign-in service (Supabase Auth): accounts, verification links, wrong passwords.
    if (pathname.startsWith('/api/__mock/auth/') && method === 'POST') {
      const body = await parseJsonBody(req);
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');
      const action = pathname.slice('/api/__mock/auth/'.length);
      const account = accounts.get(email);
      if (action === 'sign-up') {
        if (!email || password.length < 8) return sendJson(res, 400, { error: 'Password should be at least 8 characters' });
        if (account || email === 'alex.zenith@haven.local') return sendJson(res, 400, { error: 'User already registered' });
        const created: MockAccount = { id: `usr-mock-${accounts.size + 1}-${Date.now().toString(36)}`, email, password, confirmed: /autoverify/.test(email) };
        accounts.set(email, created);
        return sendJson(res, 200, { id: created.id, email, confirmed: created.confirmed });
      }
      if (action === 'sign-in') {
        if (account) {
          if (account.password !== password) return sendJson(res, 400, { error: 'Invalid login credentials' });
          if (!account.confirmed) return sendJson(res, 400, { error: 'Email not confirmed' });
          return sendJson(res, 200, { id: account.id, email });
        }
        if (email === 'alex.zenith@haven.local' && password.length >= 8) return sendJson(res, 200, { id: seededAlex.id, email });
        return sendJson(res, 400, { error: 'Invalid login credentials' });
      }
      if (action === 'confirm') {
        if (!account) return sendJson(res, 404, { error: 'No such account' });
        account.confirmed = true;
        return sendJson(res, 200, { id: account.id, email });
      }
      if (action === 'reset') {
        for (const profileId of profiles.keys()) db.users.delete(profileId);
        accounts.clear(); profiles.clear(); avatars.clear();
        return sendJson(res, 200, { ok: true });
      }
    }

    // 2. GET /api/bootstrap
    if (pathname === '/api/bootstrap' && method === 'GET') {
      const authHeader = req.headers['authorization'];
      const userId = typeof authHeader === 'string' ? /^Bearer mock-ui-token:(.+)$/.exec(authHeader)?.[1] : undefined;
      if (!userId) return sendJson(res, 401, { error: 'Authentication required' });
      db.authSessionActive = true;
      if (userId === seededAlex.id) {
        if (db.me.id !== seededAlex.id) {
          db.me = { ...createInitialMockDatabase().me };
          db.users.set(db.me.id, db.me);
        }
        const payload = buildBootstrapPayload(db);
        const referer = req.headers['referer'] || '';
        try {
          const url = new URL(referer, 'http://127.0.0.1:5173');
          if (
            url.searchParams.get('scenario') === 'single' ||
            url.searchParams.get('scenario') === 'solo' ||
            url.searchParams.get('peers') === '1' ||
            url.searchParams.get('count') === '1' ||
            url.searchParams.get('mode') === 'single'
          ) {
            payload.voice = payload.voice.filter(p => p.user.id === db.me.id);
          }
        } catch {}
        return sendJson(res, 200, payload);
      }
      const account = [...accounts.values()].find(item => item.id === userId);
      if (!account || !account.confirmed) return sendJson(res, 401, { error: 'Authentication required' });
      let profile = profiles.get(userId);
      if (!profile) {
        const placeholder = placeholderIdentity(userId.replace(/[^a-f0-9]/g, '') || userId);
        profile = { id: userId, username: placeholder, displayName: placeholder, bio: '', avatar: '', status: 'online', createdAt: Date.now(), settings: { profileCompleted: false } };
        profiles.set(userId, profile);
      }
      db.me = { ...profile };
      db.users.set(db.me.id, db.me);
      // A new account starts with an empty workspace, not the demo account's communities.
      return sendJson(res, 200, { ...buildBootstrapPayload(db), servers: [], channels: [], conversations: [], friends: [], requests: [], blocked: [], voice: [], users: [db.me] });
    }

    // Profile onboarding (same contract as the real backend)
    if (pathname === '/api/users/username-available' && method === 'GET') {
      const candidate = (url.searchParams.get('username') || '').trim().replace(/^@/, '');
      const problem = usernameProblem(candidate);
      if (problem) return sendJson(res, 200, { available: false, reason: problem });
      const available = !takenUsername(candidate, db.me.id);
      return sendJson(res, 200, available ? { available } : { available, reason: 'That username is already taken' });
    }

    if (pathname === '/api/users/me/profile' && method === 'POST') {
      const body = await parseJsonBody(req);
      const chosen = String(body.username || '').trim().replace(/^@/, '');
      const displayName = String(body.displayName || '').trim();
      const problem = usernameProblem(chosen);
      if (problem) return sendJson(res, 400, { error: `Username: ${problem}` });
      if (!displayName || displayName.length > 50) return sendJson(res, 400, { error: 'Display name is required (50 characters or fewer)' });
      if (db.me.settings?.profileCompleted !== false) return sendJson(res, 409, { error: 'Your profile is already complete' });
      if (takenUsername(chosen, db.me.id)) return sendJson(res, 409, { error: 'That username is already taken' });
      db.me = { ...db.me, username: chosen, displayName, settings: { ...(db.me.settings || {}), profileCompleted: true } };
      db.users.set(db.me.id, { ...db.me });
      rememberProfile();
      io.emit('user:update', db.me);
      return sendJson(res, 200, { user: db.me });
    }

    if (pathname === '/api/users/me/avatar' && method === 'POST') {
      const upload = readUploadedImage(await readBody(req), String(req.headers['content-type'] || ''));
      if (typeof upload === 'string') return sendJson(res, 400, { error: upload });
      const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }[upload.mime];
      avatars.set(db.me.id, upload);
      db.me = { ...db.me, avatar: `/api/users/${db.me.id}/avatar?v=${Date.now().toString(16)}.${extension}` };
      db.users.set(db.me.id, { ...db.me });
      rememberProfile();
      io.emit('user:update', db.me);
      return sendJson(res, 200, { user: db.me });
    }

    const avatarMatch = pathname.match(/^\/api\/users\/([^/]+)\/avatar$/);
    if (avatarMatch && method === 'GET') {
      const stored = avatars.get(decodeURIComponent(avatarMatch[1]));
      if (!stored) return sendJson(res, 404, { error: 'Profile picture not found' });
      res.writeHead(200, { 'Content-Type': stored.mime, 'Content-Length': stored.data.length, 'Cache-Control': 'no-store' });
      return res.end(stored.data);
    }

    // 3. /api/messages
    if (pathname === '/api/messages') {
      if (method === 'GET') {
        const channelId = url.searchParams.get('channelId');
        const conversationId = url.searchParams.get('conversationId');
        const query = (url.searchParams.get('q') || '').toLowerCase().trim();

        let filtered = db.messages.filter(msg => {
          if (channelId && msg.channelId !== channelId) return false;
          if (conversationId && msg.conversationId !== conversationId) return false;
          if (query && !msg.content.toLowerCase().includes(query)) return false;
          return true;
        });

        filtered.sort((a, b) => a.createdAt - b.createdAt);
        return sendJson(res, 200, { messages: filtered, hasMore: false });
      }

      if (method === 'POST') {
        const body = await parseJsonBody(req);
        const newMessage: Message = {
          id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          channelId: body.channelId || null,
          conversationId: body.conversationId || null,
          authorId: db.me.id,
          content: String(body.content || '').trim(),
          replyTo: body.replyTo || null,
          createdAt: Date.now(),
          editedAt: null,
          attachments: (body.attachmentIds || [])
            .map((attId: string) => db.attachments.get(attId))
            .filter(Boolean),
          reactions: [],
        };

        db.messages.push(newMessage);
        io.emit('message', newMessage);
        return sendJson(res, 200, { message: newMessage });
      }
    }

    // 4. /api/messages/:id and /api/messages/:id/reactions
    const messageMatch = pathname.match(/^\/api\/messages\/([^/]+)(\/reactions)?$/);
    if (messageMatch) {
      const msgId = messageMatch[1];
      const isReaction = Boolean(messageMatch[2]);
      const msgIndex = db.messages.findIndex(m => m.id === msgId);

      if (msgIndex === -1) {
        return sendJson(res, 404, { error: 'Message not found' });
      }

      const msg = db.messages[msgIndex];

      if (isReaction && method === 'POST') {
        const body = await parseJsonBody(req);
        const emoji = String(body.emoji || '');
        const existingReaction = msg.reactions.find(r => r.emoji === emoji);

        if (existingReaction) {
          if (existingReaction.userIds.includes(db.me.id)) {
            existingReaction.userIds = existingReaction.userIds.filter(id => id !== db.me.id);
            if (!existingReaction.userIds.length) {
              msg.reactions = msg.reactions.filter(r => r.emoji !== emoji);
            }
          } else {
            existingReaction.userIds.push(db.me.id);
          }
        } else if (emoji) {
          msg.reactions.push({ emoji, userIds: [db.me.id] });
        }

        io.emit('message:update', msg);
        return sendJson(res, 200, { success: true });
      }

      if (method === 'PATCH') {
        const body = await parseJsonBody(req);
        msg.content = String(body.content || msg.content);
        msg.editedAt = Date.now();
        io.emit('message:update', msg);
        return sendJson(res, 200, { message: msg });
      }

      if (method === 'DELETE') {
        db.messages.splice(msgIndex, 1);
        io.emit('message:delete', { id: msgId });
        return sendJson(res, 200, { success: true });
      }
    }

    // 5a. /api/servers/:id/members/:userId/voice
    const serverMemberVoiceMatch = pathname.match(/^\/api\/servers\/([^/]+)\/members\/([^/]+)\/voice$/);
    if (serverMemberVoiceMatch && method === 'POST') {
      const serverId = serverMemberVoiceMatch[1];
      const memberUserId = serverMemberVoiceMatch[2];
      const body = await parseJsonBody(req);
      const action = body.action;
      const enabled = body.enabled ?? true;

      if (action === 'disconnect') {
        let removed = false;
        for (const [key, peer] of Array.from(db.voice.entries())) {
          if (peer.user.id === memberUserId) {
            const ch = db.channels.get(peer.channelId);
            if (ch?.serverId === serverId) {
              db.voice.delete(key);
              io.to(`voice:${peer.channelId}`).emit('voice:peer-left', { socketId: peer.socketId });
              removed = true;
            }
          }
        }
        if (!removed) {
          return sendJson(res, 400, { error: 'Member is not connected to voice' });
        }
        io.emit('sync');
        return sendJson(res, 200, { ok: true });
      }

      if (action === 'mute' || action === 'deafen') {
        const membersList = serverMembersStore.get(serverId) || getInitialMembers(serverId);
        const target = membersList.find(m => m.userId === memberUserId);
        if (target) {
          if (action === 'mute') target.serverMuted = enabled;
          if (action === 'deafen') target.serverDeafened = enabled;
          serverMembersStore.set(serverId, membersList);
        }
        for (const peer of db.voice.values()) {
          if (peer.user.id === memberUserId) {
            const ch = db.channels.get(peer.channelId);
            if (ch?.serverId === serverId) {
              if (action === 'mute') peer.serverMuted = enabled;
              if (action === 'deafen') peer.serverDeafened = enabled;
              if (enabled) {
                if (action === 'mute') peer.muted = true;
                if (action === 'deafen') { peer.muted = true; peer.deafened = true; }
              }
              io.emit('voice:state', {
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
        io.emit('sync');
        return sendJson(res, 200, { ok: true });
      }

      return sendJson(res, 400, { error: 'Invalid voice action' });
    }

    // 5. /api/servers/:id/members/:userId action
    const serverMemberActionMatch = pathname.match(/^\/api\/servers\/([^/]+)\/members\/([^/]+)$/);
    if (serverMemberActionMatch) {
      const serverId = serverMemberActionMatch[1];
      const memberUserId = serverMemberActionMatch[2];
      const membersList = serverMembersStore.get(serverId) || getInitialMembers(serverId);
      if (method === 'PATCH') {
        const body = await parseJsonBody(req);
        const target = membersList.find(m => m.userId === memberUserId);
        if (target && body.role) {
          target.role = body.role;
        }
        serverMembersStore.set(serverId, membersList);
        io.emit('sync');
        return sendJson(res, 200, { success: true });
      }
      if (method === 'DELETE') {
        serverMembersStore.set(serverId, membersList.filter(m => m.userId !== memberUserId));
        io.emit('sync');
        return sendJson(res, 200, { success: true });
      }
    }

    // 5b. /api/servers/:id/members
    const serverMembersMatch = pathname.match(/^\/api\/servers\/([^/]+)\/members$/);
    if (serverMembersMatch && method === 'GET') {
      const serverId = serverMembersMatch[1];
      if (!serverMembersStore.has(serverId)) {
        serverMembersStore.set(serverId, getInitialMembers(serverId));
      }
      return sendJson(res, 200, { members: serverMembersStore.get(serverId) });
    }

    // 5c. /api/servers/:id/icon
    const serverIconMatch = pathname.match(/^\/api\/servers\/([^/]+)\/icon$/);
    if (serverIconMatch && method === 'POST') {
      const serverId = serverIconMatch[1];
      const srv = db.servers.get(serverId);
      if (srv) {
        srv.icon = `/api/servers/${serverId}/icon?v=${Date.now()}`;
        io.emit('sync');
      }
      return sendJson(res, 200, { success: true });
    }

    // 6. /api/servers
    if (pathname === '/api/servers' && method === 'POST') {
      const body = await parseJsonBody(req);
      const newServer: Server = {
        id: `srv-${Date.now()}`,
        name: String(body.name || 'New Community').trim(),
        icon: String(body.icon || '✨').trim(),
        description: 'A space of your own',
        ownerId: db.me.id,
        role: 'owner',
        createdAt: Date.now(),
      };
      const defaultChannel: Channel = {
        id: `chn-${Date.now()}-general`,
        serverId: newServer.id,
        name: 'general',
        type: 'text',
        topic: 'General conversation',
        position: 0,
      };

      db.servers.set(newServer.id, newServer);
      db.channels.set(defaultChannel.id, defaultChannel);
      io.emit('sync');
      return sendJson(res, 200, { server: newServer, channel: defaultChannel });
    }

    // 7. /api/servers/:id
    const serverMatch = pathname.match(/^\/api\/servers\/([^/]+)$/);
    if (serverMatch && method === 'PATCH') {
      const serverId = serverMatch[1];
      const srv = db.servers.get(serverId);
      if (!srv) return sendJson(res, 404, { error: 'Server not found' });
      const body = await parseJsonBody(req);
      if (body.name) srv.name = String(body.name).trim();
      if (body.icon !== undefined) srv.icon = String(body.icon).trim();
      if (body.description !== undefined) srv.description = String(body.description).trim();
      io.emit('sync');
      return sendJson(res, 200, { server: srv });
    }
    if (serverMatch && method === 'DELETE') {
      const serverId = serverMatch[1];
      db.servers.delete(serverId);
      io.emit('sync');
      return sendJson(res, 200, { success: true });
    }

    // 8. /api/servers/:id/channels
    const serverChannelsMatch = pathname.match(/^\/api\/servers\/([^/]+)\/channels$/);
    if (serverChannelsMatch && method === 'POST') {
      const serverId = serverChannelsMatch[1];
      const body = await parseJsonBody(req);
      const newChannel: Channel = {
        id: `chn-${Date.now()}`,
        serverId,
        name: String(body.name || 'new-channel').trim().toLowerCase(),
        type: (body.type === 'voice' ? 'voice' : 'text'),
        topic: String(body.topic || '').trim(),
        position: db.channels.size,
      };
      db.channels.set(newChannel.id, newChannel);
      io.emit('sync');
      return sendJson(res, 200, { channel: newChannel });
    }

    // 9. /api/channels/:id
    const channelMatch = pathname.match(/^\/api\/channels\/([^/]+)$/);
    if (channelMatch) {
      const chnId = channelMatch[1];
      const chn = db.channels.get(chnId);
      if (!chn) return sendJson(res, 404, { error: 'Channel not found' });

      if (method === 'PATCH') {
        const body = await parseJsonBody(req);
        if (body.name) chn.name = String(body.name).trim().toLowerCase();
        if (body.topic !== undefined) chn.topic = String(body.topic).trim();
        if (body.position !== undefined) chn.position = Number(body.position);
        io.emit('sync');
        return sendJson(res, 200, { channel: chn });
      }

      if (method === 'DELETE') {
        db.channels.delete(chnId);
        io.emit('sync');
        return sendJson(res, 200, { success: true });
      }
    }

    // 10. /api/conversations
    if (pathname === '/api/conversations' && method === 'POST') {
      const body = await parseJsonBody(req);
      const memberIds = Array.from(new Set([db.me.id, ...(body.memberIds || [])]));
      const newConv: Conversation = {
        id: `conv-${Date.now()}`,
        name: String(body.name || '').trim(),
        memberIds,
        createdAt: Date.now(),
      };
      db.conversations.set(newConv.id, newConv);
      io.emit('sync');
      return sendJson(res, 200, { conversation: newConv });
    }

    // 11. /api/servers/:id/sounds
    const serverSoundsMatch = pathname.match(/^\/api\/servers\/([^/]+)\/sounds$/);
    if (serverSoundsMatch) {
      const serverId = serverSoundsMatch[1];
      if (method === 'GET') {
        const sounds = Array.from(db.sounds.values()).filter(s => s.serverId === serverId);
        return sendJson(res, 200, { sounds });
      }
      if (method === 'POST') {
        const bodyBuf = await readBody(req);
        const bodyStr = bodyBuf.toString('utf8');
        const nameFieldMatch = bodyStr.match(/name="name"\r?\n\r?\n([^\r\n]+)/);
        const filenameMatch = bodyStr.match(/filename="([^"]+)"/);
        const extractedName = (nameFieldMatch?.[1] || filenameMatch?.[1] || 'Custom Sound Effect').replace(/\.[^.]+$/, '').trim();
        const sound: Sound = {
          id: `snd-${Date.now()}`,
          serverId,
          name: extractedName || 'Custom Sound Effect',
          url: `/api/sounds/snd-${Date.now()}/audio`,
          uploaderId: db.me.id,
        };
        db.sounds.set(sound.id, sound);
        return sendJson(res, 200, { sound });
      }
    }

    // 12. /api/sounds/:id/audio (Synthetic Audio Playback)
    const soundAudioMatch = pathname.match(/^\/api\/sounds\/([^/]+)\/audio$/);
    if (soundAudioMatch && method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'audio/wav',
        'Content-Length': mockAudioBuffer.length,
        'Cache-Control': 'public, max-age=86400',
      });
      return res.end(mockAudioBuffer);
    }

    // 13. /api/sounds/:id
    const soundMatch = pathname.match(/^\/api\/sounds\/([^/]+)$/);
    if (soundMatch && method === 'DELETE') {
      const soundId = soundMatch[1];
      db.sounds.delete(soundId);
      return sendJson(res, 200, { success: true });
    }

    // 14. /api/attachments
    if (pathname === '/api/attachments' && method === 'POST') {
      const attId = `att-${Date.now()}`;
      const attachment = {
        id: attId,
        name: 'test-upload.png',
        mime: 'image/png',
        size: 32400,
        url: `/api/attachments/${attId}`,
      };
      db.attachments.set(attId, {
        ...attachment,
        data: Buffer.from('mock-file-content'),
      });
      return sendJson(res, 200, { attachment });
    }

    // 15. /api/attachments/:id
    const attMatch = pathname.match(/^\/api\/attachments\/([^/]+)$/);
    if (attMatch && method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': 'inline',
      });
      return res.end(Buffer.from('Haven Mock Attachment Content'));
    }

    // 16. /api/invites/:code and /api/servers/:id/invites
    if (pathname.startsWith('/api/invites/')) {
      const code = pathname.replace('/api/invites/', '').replace(/\/join$/, '');
      const isJoin = pathname.endsWith('/join');
      if (isJoin && method === 'POST') {
        return sendJson(res, 200, { serverId: 'srv-zenith' });
      }
      if (method === 'GET') {
        const srv = db.servers.get('srv-zenith');
        return sendJson(res, 200, { server: srv, inviter: db.me });
      }
    }

    if (pathname.startsWith('/api/invites/') && method === 'DELETE') {
      return sendJson(res, 200, { ok: true });
    }

    const serverInvitesMatch = pathname.match(/^\/api\/servers\/([^/]+)\/invites$/);
    if (serverInvitesMatch) {
      if (method === 'GET') {
        return sendJson(res, 200, {
          invites: [
            {
              code: 'cozy-vance-441',
              createdAt: Date.now() - 86400000,
              expiresAt: Date.now() + 6 * 86400000,
              revokedAt: null,
            },
          ],
        });
      }
      if (method === 'POST') {
        const body = await parseJsonBody(req).catch(() => ({}));
        const expiresInHours = (body as any)?.expiresInHours;
        const expiresAt = expiresInHours ? Date.now() + expiresInHours * 3600_000 : null;
        return sendJson(res, 200, {
          code: 'cozy-vance-441',
          expiresAt,
          invite: {
            code: 'cozy-vance-441',
            url: 'http://127.0.0.1:5173/invite/cozy-vance-441',
          },
        });
      }
    }

    // 17. /api/users/me
    if (pathname === '/api/users/me' && method === 'PATCH') {
      const body = await parseJsonBody(req);
      if (body.displayName) db.me.displayName = String(body.displayName).trim();
      if (body.bio !== undefined) db.me.bio = String(body.bio).trim();
      if (body.avatar !== undefined) db.me.avatar = String(body.avatar).trim();
      if (body.status) db.me.status = body.status;
      if (body.settings) db.me.settings = { ...(db.me.settings || {}), ...body.settings };
      db.users.set(db.me.id, { ...db.me });
      rememberProfile();
      io.emit('user:update', db.me);
      return sendJson(res, 200, { user: db.me });
    }

    // 18. /api/friends/request, accept, decline, remove
    if (pathname === '/api/friends/request' && method === 'POST') {
      const body = await parseJsonBody(req);
      const targetUser = Array.from(db.users.values()).find(u => u.username === String(body.username).trim());
      if (!targetUser) {
        return sendJson(res, 404, { error: 'User not found with that username' });
      }
      const reqId = `req-${Date.now()}`;
      db.requests.set(reqId, { id: reqId, fromId: db.me.id, toId: targetUser.id, createdAt: Date.now() });
      io.emit('sync');
      return sendJson(res, 200, { success: true });
    }

    if (pathname === '/api/friends/accept' && method === 'POST') {
      const body = await parseJsonBody(req);
      const fromId = String(body.fromId);
      db.friends.add(fromId);
      for (const [key, val] of Array.from(db.requests.entries())) {
        if (val.fromId === fromId && val.toId === db.me.id) db.requests.delete(key);
      }
      io.emit('sync');
      return sendJson(res, 200, { success: true });
    }

    if (pathname === '/api/friends/decline' && method === 'POST') {
      const body = await parseJsonBody(req);
      const fromId = String(body.fromId);
      for (const [key, val] of Array.from(db.requests.entries())) {
        if (val.fromId === fromId && val.toId === db.me.id) db.requests.delete(key);
      }
      io.emit('sync');
      return sendJson(res, 200, { success: true });
    }

    if (pathname === '/api/friends/remove' && method === 'POST') {
      const body = await parseJsonBody(req);
      db.friends.delete(String(body.friendId));
      io.emit('sync');
      return sendJson(res, 200, { success: true });
    }

    // 19. /api/auth/login, register, logout
    if (pathname === '/api/auth/login' && method === 'POST') {
      const body = await parseJsonBody(req);
      db.authSessionActive = true;
      if (!body.email || body.email === 'alex.zenith@haven.local' || body.email.includes('alex')) {
        const initial = createInitialMockDatabase();
        db.me = { ...initial.me };
        db.users.set(db.me.id, db.me);
      }
      io.emit('sync');
      return sendJson(res, 200, { success: true });
    }

    if (pathname === '/api/auth/register' && method === 'POST') {
      const body = await parseJsonBody(req);
      db.authSessionActive = true;
      if (body.username) {
        const username = String(body.username).trim();
        const displayName = body.displayName ? String(body.displayName).trim() : username;
        db.me = {
          id: `usr-reg-${Date.now()}`,
          username,
          displayName,
          bio: '',
          avatar: '',
          status: 'online',
          createdAt: Date.now(),
          settings: { profileCompleted: false },
        };
        db.users.set(db.me.id, db.me);
      }
      io.emit('sync');
      return sendJson(res, 200, { success: true });
    }

    if (pathname === '/api/auth/logout' && method === 'POST') {
      db.authSessionActive = false;
      const initial = createInitialMockDatabase();
      db.me = { ...initial.me };
      db.users.set(db.me.id, db.me);
      return sendJson(res, 200, { success: true });
    }

    // 20. /api/rtc
    if (pathname === '/api/rtc' && method === 'GET') {
      return sendJson(res, 200, { iceServers: [] });
    }

    // Default fallback for any unhandled /api
    return sendJson(res, 200, {});
  });
}
