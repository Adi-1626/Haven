import pg from 'pg';
import { databaseConnectionConfig } from './tls.js';
import { assertActiveInvite } from './invites.js';
import { AttachmentClaimError, FriendRequestConflictError } from './types.js';
const { Pool } = pg;
import type {
  DatabaseAdapter,
  MessageAttachmentRow,
  MessageReactionRow,
  UserRow,
  ServerRow,
  MemberRow,
  ChannelRow,
  InviteRow,
  ConversationRow,
  MessageRow,
  AttachmentRow,
  FriendRequestRow,
  SoundRow,
  ServerEmojiRow,
  ServerIconRow,
} from './types.js';

type Row = Record<string, any>;

export class PostgresAdapter implements DatabaseAdapter {
  public isPostgres = true;
  private pool: pg.Pool;

  constructor(connectionStringOrConfig: string | pg.PoolConfig) {
    const config = databaseConnectionConfig(connectionStringOrConfig);

    this.pool = new Pool({
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      // Detect half-open TCP connections after a failover or NAT/pooler timeout.
      keepAlive: true,
      ...config,
    });
    // A database restart, failover or pooler recycle terminates idle pooled connections. node-postgres
    // reports that on the pool and, with no listener, the 'error' event would crash the process. The
    // pool has already discarded that client; the next checkout reconnects.
    this.pool.on('error', error => console.error(`PostgreSQL idle connection lost (${(error as { code?: string }).code ?? 'no code'}): ${error.message}`));
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async checkConnection(): Promise<void> {
    await this.run('SELECT 1', []);
  }

  private authSessionCheck: 'unknown' | 'available' | 'unavailable' = 'unknown';

  async isAuthSessionActive(sessionId: string, userId: string): Promise<boolean | undefined> {
    if (this.authSessionCheck === 'unavailable') return undefined;
    try {
      const row = await this.queryOne('SELECT haven.auth_session_active($1::uuid, $2::uuid) AS active', [sessionId, userId]);
      this.authSessionCheck = 'available';
      return Boolean(row?.active);
    } catch (error) {
      const code = (error as { code?: string }).code;
      // 42883: function not installed; 42501: not granted; 3F000: schema missing. The check is optional
      // until its migration is applied; other failures propagate as an availability problem.
      if (code === '42883' || code === '42501' || code === '3F000') {
        console.warn(`Supabase session revocation check unavailable (${code}); falling back to provider and in-process checks.`);
        this.authSessionCheck = 'unavailable';
        return undefined;
      }
      if (code === '22P02') return false; // a session_id that is not a UUID is not a live session
      throw error;
    }
  }

  get authSessionCheckStatus() { return this.authSessionCheck; }

  // Every statement is schema-qualified (haven.*), so no per-checkout `SET search_path`
  // round trip is needed. This also stays correct behind transaction-mode poolers.
  private async run(sql: string, params: any[]): Promise<pg.QueryResult<Row>> {
    const client = await this.pool.connect();
    try {
      return await client.query(sql, params);
    } finally {
      client.release();
    }
  }

  private async query(sql: string, params: any[] = []): Promise<Row[]> {
    return (await this.run(sql, params)).rows;
  }

  private async queryOne(sql: string, params: any[] = []): Promise<Row | undefined> {
    const rows = await this.query(sql, params);
    return rows[0];
  }

  private async execute(sql: string, params: any[] = []): Promise<number> {
    return (await this.run(sql, params)).rowCount ?? 0;
  }

  private mapUser(row: Row): UserRow {
    return {
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      password: row.password ?? '',
      bio: row.bio ?? '',
      avatar: row.avatar ?? '',
      status: row.status,
      settings: typeof row.settings === 'object' ? JSON.stringify(row.settings) : (row.settings ?? '{}'),
      createdAt: Number(row.created_at),
    };
  }

  private mapMessage(row: Row): MessageRow {
    return {
      id: row.id,
      channelId: row.channel_id ?? null,
      conversationId: row.conversation_id ?? null,
      authorId: row.author_id,
      content: row.content,
      replyTo: row.reply_to ?? null,
      createdAt: Number(row.created_at),
      editedAt: row.edited_at ? Number(row.edited_at) : null,
    };
  }

  // Users
  async getUser(userId: string): Promise<UserRow | undefined> {
    const row = await this.queryOne('SELECT * FROM haven.users WHERE id = $1', [userId]);
    return row && this.mapUser(row);
  }

  async getUserByUsername(username: string): Promise<UserRow | undefined> {
    const row = await this.queryOne('SELECT * FROM haven.users WHERE LOWER(username) = LOWER($1)', [username]);
    return row && this.mapUser(row);
  }

  async getUsers(userIds: string[]): Promise<UserRow[]> {
    if (!userIds.length) return [];
    const rows = await this.query('SELECT * FROM haven.users WHERE id = ANY($1::text[])', [userIds]);
    return rows.map(row => this.mapUser(row));
  }

  async createUser(user: { id: string; username: string; displayName: string; password?: string; settings?: string; createdAt: number }): Promise<void> {
    await this.execute(
      `INSERT INTO haven.users(id, username, display_name, password, bio, avatar, status, settings, created_at)
       VALUES($1, $2, $3, $4, '', '', 'online', $5::jsonb, $6)
       ON CONFLICT (id) DO NOTHING`,
      [user.id, user.username, user.displayName, user.password ?? '', user.settings ?? '{}', user.createdAt]
    );
  }

  async setUsername(userId: string, username: string): Promise<boolean> {
    try {
      await this.execute('UPDATE haven.users SET username = $1 WHERE id = $2', [username, userId]);
      return true;
    } catch (error) {
      if ((error as { code?: string })?.code === '23505') return false;
      throw error;
    }
  }

  async completeUserProfile(userId: string, username: string, displayName: string): Promise<'completed' | 'unavailable' | 'already-complete'> {
    try {
      const changed = await this.execute(`UPDATE haven.users SET username = $1, display_name = $2,
        settings = settings || '{"profileCompleted":true}'::jsonb
        WHERE id = $3 AND settings->'profileCompleted' = 'false'::jsonb`, [username, displayName, userId]);
      return changed ? 'completed' : 'already-complete';
    } catch (error) {
      if ((error as { code?: string }).code === '23505') return 'unavailable';
      throw error;
    }
  }

  async updateUser(userId: string, patch: { displayName?: string; bio?: string; avatar?: string; status?: string; settings?: string }): Promise<void> {
    await this.execute(
      `UPDATE haven.users SET
         display_name = COALESCE($1, display_name),
         bio = COALESCE($2, bio),
         avatar = COALESCE($3, avatar),
         status = COALESCE($4, status),
         settings = settings || COALESCE($5::jsonb, '{}'::jsonb)
       WHERE id = $6`,
      [
        patch.displayName ?? null,
        patch.bio ?? null,
        patch.avatar ?? null,
        patch.status ?? null,
        patch.settings ?? null,
        userId,
      ]
    );
  }

  async getVisibleUsers(userId: string): Promise<string[]> {
    const rows = await this.query(
      `SELECT DISTINCT u.user_id FROM (
         SELECT b.user_id FROM haven.members a JOIN haven.members b ON a.server_id = b.server_id WHERE a.user_id = $1
         UNION
         SELECT friend_id AS user_id FROM haven.friends WHERE user_id = $1
         UNION
         SELECT from_id AS user_id FROM haven.friend_requests WHERE from_id = $1 OR to_id = $1
         UNION
         SELECT to_id AS user_id FROM haven.friend_requests WHERE from_id = $1 OR to_id = $1
         UNION
         SELECT b.user_id FROM haven.conversation_members a JOIN haven.conversation_members b ON a.conversation_id = b.conversation_id WHERE a.user_id = $1
         UNION
         SELECT blocked_id AS user_id FROM haven.blocks WHERE user_id = $1
         UNION
         SELECT $1::text AS user_id
       ) u`,
      [userId]
    );
    return rows.map(r => r.user_id);
  }

  // Sessions
  async createSession(tokenHash: string, userId: string, expiresAt: number): Promise<void> {
    await this.execute(
      'INSERT INTO haven.sessions(token, user_id, expires_at) VALUES($1, $2, $3) ON CONFLICT (token) DO UPDATE SET expires_at = EXCLUDED.expires_at',
      [tokenHash, userId, expiresAt]
    );
  }

  async getSessionUserId(tokenHash: string, now: number): Promise<string | undefined> {
    const row = await this.queryOne('SELECT user_id FROM haven.sessions WHERE token = $1 AND expires_at > $2', [tokenHash, now]);
    return row?.user_id;
  }

  async hasValidSession(tokenHash: string, now: number): Promise<boolean> {
    const row = await this.queryOne('SELECT 1 FROM haven.sessions WHERE token = $1 AND expires_at > $2', [tokenHash, now]);
    return Boolean(row);
  }

  async deleteSession(tokenHash: string): Promise<void> {
    await this.execute('DELETE FROM haven.sessions WHERE token = $1', [tokenHash]);
  }

  async deleteExpiredSessions(now: number): Promise<void> {
    await this.execute('DELETE FROM haven.sessions WHERE expires_at < $1', [now]);
  }

  // Servers
  async getUserServers(userId: string): Promise<ServerRow[]> {
    const rows = await this.query(
      `SELECT s.*, m.role FROM haven.servers s
       JOIN haven.members m ON m.server_id = s.id
       WHERE m.user_id = $1
       ORDER BY s.created_at`,
      [userId]
    );
    return rows.map(r => ({
      id: r.id,
      name: r.name,
      icon: r.icon ?? '',
      description: r.description ?? '',
      ownerId: r.owner_id,
      createdAt: Number(r.created_at),
      role: r.role,
    }));
  }

  async getServer(serverId: string): Promise<ServerRow | undefined> {
    const row = await this.queryOne('SELECT * FROM haven.servers WHERE id = $1', [serverId]);
    if (!row) return undefined;
    return {
      id: row.id,
      name: row.name,
      icon: row.icon ?? '',
      description: row.description ?? '',
      ownerId: row.owner_id,
      createdAt: Number(row.created_at),
    };
  }

  async createServer(server: { id: string; name: string; icon: string; description: string; ownerId: string; createdAt: number }, initialChannelId: string, voiceChannelId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'INSERT INTO haven.servers(id, name, icon, owner_id, created_at, description) VALUES($1, $2, $3, $4, $5, $6)',
        [server.id, server.name, server.icon, server.ownerId, server.createdAt, server.description]
      );
      await client.query(
        "INSERT INTO haven.members(server_id, user_id, role) VALUES($1, $2, 'owner')",
        [server.id, server.ownerId]
      );
      await client.query(
        "INSERT INTO haven.channels(id, server_id, name, type, topic, position) VALUES($1, $2, 'general', 'text', '', 0)",
        [initialChannelId, server.id]
      );
      await client.query(
        "INSERT INTO haven.channels(id, server_id, name, type, topic, position) VALUES($1, $2, 'Lounge', 'voice', '', 1)",
        [voiceChannelId, server.id]
      );
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async updateServer(serverId: string, patch: { name?: string; icon?: string; description?: string }): Promise<void> {
    await this.execute(
      `UPDATE haven.servers SET
         name = COALESCE($1, name),
         icon = COALESCE($2, icon),
         description = COALESCE($3, description)
       WHERE id = $4`,
      [
        patch.name ?? null,
        patch.icon ?? null,
        patch.description ?? null,
        serverId,
      ]
    );
  }

  async deleteServer(serverId: string): Promise<{ diskNames: string[] }> {
    const files = await this.query(
      `SELECT a.disk_name FROM haven.attachments a JOIN haven.channels c ON c.id = a.channel_id WHERE c.server_id = $1
       UNION
       SELECT disk_name FROM haven.sounds WHERE server_id = $1
       UNION
       SELECT disk_name FROM haven.server_icons WHERE server_id = $1
       UNION
       SELECT disk_name FROM haven.server_emojis WHERE server_id = $1
       UNION
       SELECT static_disk_name AS disk_name FROM haven.server_emojis WHERE server_id = $1`,
      [serverId]
    );
    await this.execute('DELETE FROM haven.servers WHERE id = $1', [serverId]);
    return { diskNames: files.map(f => f.disk_name) };
  }

  // Members
  async getMember(serverId: string, userId: string): Promise<MemberRow | undefined> {
    const row = await this.queryOne('SELECT * FROM haven.members WHERE server_id = $1 AND user_id = $2', [serverId, userId]);
    if (!row) return undefined;
    return {
      serverId: row.server_id,
      userId: row.user_id,
      role: row.role,
      serverMuted: Boolean(row.server_muted),
      serverDeafened: Boolean(row.server_deafened),
    };
  }

  async getServerMembers(serverId: string): Promise<MemberRow[]> {
    const rows = await this.query('SELECT user_id, role, server_muted, server_deafened FROM haven.members WHERE server_id = $1', [serverId]);
    return rows.map(r => ({
      serverId,
      userId: r.user_id,
      role: r.role,
      serverMuted: Boolean(r.server_muted),
      serverDeafened: Boolean(r.server_deafened),
    }));
  }

  async getServerAudience(serverId: string): Promise<string[]> {
    const rows = await this.query('SELECT user_id FROM haven.members WHERE server_id = $1', [serverId]);
    return rows.map(r => r.user_id);
  }

  async addMember(serverId: string, userId: string, role: 'owner' | 'admin' | 'member' = 'member'): Promise<void> {
    await this.execute(
      'INSERT INTO haven.members(server_id, user_id, role) VALUES($1, $2, $3) ON CONFLICT (server_id, user_id) DO NOTHING',
      [serverId, userId, role]
    );
  }

  async updateMemberRole(serverId: string, userId: string, role: 'admin' | 'member'): Promise<void> {
    await this.execute('UPDATE haven.members SET role = $1 WHERE server_id = $2 AND user_id = $3', [role, serverId, userId]);
  }

  async updateMemberVoice(serverId: string, userId: string, patch: { serverMuted?: boolean; serverDeafened?: boolean }): Promise<void> {
    if (patch.serverMuted !== undefined) {
      await this.execute('UPDATE haven.members SET server_muted = $1 WHERE server_id = $2 AND user_id = $3', [patch.serverMuted, serverId, userId]);
    }
    if (patch.serverDeafened !== undefined) {
      await this.execute('UPDATE haven.members SET server_deafened = $1 WHERE server_id = $2 AND user_id = $3', [patch.serverDeafened, serverId, userId]);
    }
  }

  async removeMember(serverId: string, userId: string): Promise<void> {
    await this.execute('DELETE FROM haven.members WHERE server_id = $1 AND user_id = $2', [serverId, userId]);
  }

  // Channels
  async getUserChannels(userId: string): Promise<ChannelRow[]> {
    const rows = await this.query(
      `SELECT c.* FROM haven.channels c
       JOIN haven.members m ON m.server_id = c.server_id
       WHERE m.user_id = $1
       ORDER BY c.position, c.id`,
      [userId]
    );
    return rows.map(r => ({
      id: r.id,
      serverId: r.server_id,
      name: r.name,
      type: r.type,
      topic: r.topic ?? '',
      position: r.position ?? 0,
    }));
  }

  async getChannel(channelId: string): Promise<ChannelRow | undefined> {
    const row = await this.queryOne('SELECT * FROM haven.channels WHERE id = $1', [channelId]);
    if (!row) return undefined;
    return {
      id: row.id,
      serverId: row.server_id,
      name: row.name,
      type: row.type,
      topic: row.topic ?? '',
      position: row.position ?? 0,
    };
  }

  async getNextChannelPosition(serverId: string): Promise<number> {
    const row = await this.queryOne('SELECT COALESCE(MAX(position), 0) + 1 AS position FROM haven.channels WHERE server_id = $1', [serverId]);
    return row?.position ?? 0;
  }

  async createChannel(channel: { id: string; serverId: string; name: string; type: 'text' | 'voice'; topic: string; position: number }): Promise<void> {
    await this.execute(
      'INSERT INTO haven.channels(id, server_id, name, type, topic, position) VALUES($1, $2, $3, $4, $5, $6)',
      [channel.id, channel.serverId, channel.name, channel.type, channel.topic, channel.position]
    );
  }

  async updateChannel(channelId: string, patch: { name?: string; topic?: string; position?: number }): Promise<void> {
    await this.execute(
      `UPDATE haven.channels SET
         name = COALESCE($1, name),
         topic = COALESCE($2, topic),
         position = COALESCE($3, position)
       WHERE id = $4`,
      [
        patch.name ?? null,
        patch.topic ?? null,
        patch.position ?? null,
        channelId,
      ]
    );
  }

  async deleteChannel(channelId: string): Promise<{ diskNames: string[] }> {
    const files = await this.query('SELECT disk_name FROM haven.attachments WHERE channel_id = $1', [channelId]);
    await this.execute('DELETE FROM haven.channels WHERE id = $1', [channelId]);
    return { diskNames: files.map(f => f.disk_name) };
  }

  // Invites
  async getInvite(code: string): Promise<InviteRow | undefined> {
    const row = await this.queryOne('SELECT * FROM haven.invites WHERE code = $1', [code]);
    if (!row) return undefined;
    return {
      code: row.code,
      serverId: row.server_id,
      createdAt: Number(row.created_at),
      expiresAt: row.expires_at ? Number(row.expires_at) : null,
      revokedAt: row.revoked_at ? Number(row.revoked_at) : null,
    };
  }

  async getServerInvites(serverId: string): Promise<InviteRow[]> {
    const rows = await this.query('SELECT code, server_id, created_at, expires_at, revoked_at FROM haven.invites WHERE server_id = $1 ORDER BY created_at DESC', [serverId]);
    return rows.map(r => ({
      code: r.code,
      serverId: r.server_id,
      createdAt: Number(r.created_at),
      expiresAt: r.expires_at ? Number(r.expires_at) : null,
      revokedAt: r.revoked_at ? Number(r.revoked_at) : null,
    }));
  }

  async createInvite(invite: { code: string; serverId: string; createdAt: number; expiresAt: number | null }): Promise<void> {
    await this.execute(
      'INSERT INTO haven.invites(code, server_id, created_at, expires_at, revoked_at) VALUES($1, $2, $3, $4, NULL)',
      [invite.code, invite.serverId, invite.createdAt, invite.expiresAt]
    );
  }

  async revokeInvite(code: string, now: number): Promise<void> {
    await this.execute('UPDATE haven.invites SET revoked_at = COALESCE(revoked_at, $1) WHERE code = $2', [now, code]);
  }

  async joinInvite(code: string, userId: string): Promise<InviteRow> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Serializes with revokeInvite's UPDATE. Recheck the row returned after
      // waiting for the lock, rather than trusting an earlier HTTP-layer read.
      const res = await client.query('SELECT * FROM haven.invites WHERE code = $1 FOR UPDATE', [code]);
      const row = res.rows[0];
      const invitation: InviteRow | undefined = row && {
        code: row.code, serverId: row.server_id, createdAt: Number(row.created_at),
        expiresAt: row.expires_at === null ? null : Number(row.expires_at),
        revokedAt: row.revoked_at === null ? null : Number(row.revoked_at),
      };
      assertActiveInvite(invitation);
      await client.query(
        "INSERT INTO haven.members(server_id, user_id, role) VALUES($1, $2, 'member') ON CONFLICT DO NOTHING",
        [invitation.serverId, userId]
      );
      await client.query('COMMIT');
      return invitation;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  // Conversations
  async getUserConversations(userId: string): Promise<ConversationRow[]> {
    const rows = await this.query(
      `SELECT c.id, c.name, c.created_at,
         ARRAY(SELECT cm.user_id FROM haven.conversation_members cm WHERE cm.conversation_id = c.id) AS member_ids
       FROM haven.conversations c
       JOIN haven.conversation_members m ON m.conversation_id = c.id
       WHERE m.user_id = $1
       ORDER BY c.created_at DESC`,
      [userId]
    );
    return rows.map(row => ({ id: row.id, name: row.name ?? '', createdAt: Number(row.created_at), memberIds: row.member_ids }));
  }

  async getConversation(conversationId: string): Promise<ConversationRow | undefined> {
    const row = await this.queryOne('SELECT * FROM haven.conversations WHERE id = $1', [conversationId]);
    if (!row) return undefined;
    const memberIds = await this.getConversationMemberIds(conversationId);
    return {
      id: row.id,
      name: row.name ?? '',
      createdAt: Number(row.created_at),
      memberIds,
    };
  }

  async getConversationMemberIds(conversationId: string): Promise<string[]> {
    const rows = await this.query('SELECT user_id FROM haven.conversation_members WHERE conversation_id = $1', [conversationId]);
    return rows.map(r => r.user_id);
  }

  async isConversationMember(conversationId: string, userId: string): Promise<boolean> {
    const row = await this.queryOne('SELECT 1 FROM haven.conversation_members WHERE conversation_id = $1 AND user_id = $2', [conversationId, userId]);
    return Boolean(row);
  }

  async findDirectConversation(user1: string, user2: string): Promise<string | undefined> {
    const row = await this.queryOne(
      `SELECT a.conversation_id AS id FROM haven.conversation_members a
       JOIN haven.conversation_members b ON a.conversation_id = b.conversation_id
       WHERE a.user_id = $1 AND b.user_id = $2
         AND (SELECT count(*) FROM haven.conversation_members c WHERE c.conversation_id = a.conversation_id) = 2`,
      [user1, user2]
    );
    return row?.id;
  }

  async createConversation(conversationId: string, name: string, memberIds: string[], createdAt: number): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('INSERT INTO haven.conversations(id, name, created_at) VALUES($1, $2, $3)', [conversationId, name, createdAt]);
      for (const uid of memberIds) {
        await client.query('INSERT INTO haven.conversation_members(conversation_id, user_id) VALUES($1, $2)', [conversationId, uid]);
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async updateConversation(conversationId: string, name: string): Promise<void> {
    await this.execute('UPDATE haven.conversations SET name = $1 WHERE id = $2', [name, conversationId]);
  }

  async removeConversationMember(conversationId: string, userId: string): Promise<void> {
    await this.execute('DELETE FROM haven.conversation_members WHERE conversation_id = $1 AND user_id = $2', [conversationId, userId]);
  }

  // Messages
  async getMessages(target: { channelId?: string; conversationId?: string }, before: number, query: string, limit: number, beforeId?: string): Promise<string[]> {
    const field = target.channelId ? 'channel_id' : 'conversation_id';
    const value = target.channelId ?? target.conversationId;
    // (created_at, id) is the page cursor, so rows sharing the boundary timestamp are never skipped.
    // strpos keeps search literal ('%' and '_' are not wildcards), matching SQLite's instr().
    const cursor = beforeId === undefined ? 'created_at < $2' : '(created_at, id) < ($2::bigint, $5::text)';
    const rows = await this.query(
      `SELECT id FROM haven.messages
       WHERE ${field} = $1 AND ${cursor} AND strpos(LOWER(content), LOWER($3)) > 0
       ORDER BY created_at DESC, id DESC
       LIMIT $4`,
      beforeId === undefined ? [value, before, query, limit] : [value, before, query, limit, beforeId]
    );
    return rows.map(r => r.id);
  }

  async getMessage(messageId: string): Promise<MessageRow | undefined> {
    const row = await this.queryOne('SELECT * FROM haven.messages WHERE id = $1', [messageId]);
    return row && this.mapMessage(row);
  }

  async getMessagesByIds(messageIds: string[]): Promise<MessageRow[]> {
    if (!messageIds.length) return [];
    const rows = await this.query('SELECT * FROM haven.messages WHERE id = ANY($1::text[])', [messageIds]);
    return rows.map(row => this.mapMessage(row));
  }

  async getAttachmentsForMessages(messageIds: string[]): Promise<MessageAttachmentRow[]> {
    if (!messageIds.length) return [];
    const rows = await this.query('SELECT message_id, id, name, mime, size FROM haven.attachments WHERE message_id = ANY($1::text[])', [messageIds]);
    return rows.map(r => ({ messageId: r.message_id, id: r.id, name: r.name, mime: r.mime, size: Number(r.size) }));
  }

  async getReactionsForMessages(messageIds: string[]): Promise<MessageReactionRow[]> {
    if (!messageIds.length) return [];
    const rows = await this.query('SELECT message_id, emoji, user_id FROM haven.reactions WHERE message_id = ANY($1::text[])', [messageIds]);
    return rows.map(r => ({ messageId: r.message_id, emoji: r.emoji, userId: r.user_id }));
  }

  async createMessage(message: { id: string; channelId?: string | null; conversationId?: string | null; authorId: string; content: string; replyTo?: string | null; attachmentIds: string[] }): Promise<number> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Serialize timestamp allocation until COMMIT: concurrent writers otherwise read the same
      // MAX(created_at) and persist equal timestamps. This also orders attachment claims below.
      await client.query("SELECT pg_advisory_xact_lock(hashtext('haven.messages.created_at'))");
      const maxRow = await client.query('SELECT COALESCE(MAX(created_at), 0) + 1 AS timestamp FROM haven.messages');
      const createdAt = Math.max(Date.now(), Number(maxRow.rows[0].timestamp));
      await client.query(
        `INSERT INTO haven.messages(id, channel_id, conversation_id, author_id, content, reply_to, created_at, edited_at)
         VALUES($1, $2, $3, $4, $5, $6, $7, NULL)`,
        [message.id, message.channelId ?? null, message.conversationId ?? null, message.authorId, message.content, message.replyTo ?? null, createdAt]
      );
      for (const attachmentId of new Set(message.attachmentIds)) {
        // Conditional claim: an attachment another message already took (or that belongs to another
        // uploader/destination) updates zero rows and rolls the whole message back.
        const claimed = await client.query(
          `UPDATE haven.attachments SET message_id = $1
           WHERE id = $2 AND message_id IS NULL AND uploader_id = $3
             AND channel_id IS NOT DISTINCT FROM $4 AND conversation_id IS NOT DISTINCT FROM $5`,
          [message.id, attachmentId, message.authorId, message.channelId ?? null, message.conversationId ?? null]
        );
        if (claimed.rowCount !== 1) throw new AttachmentClaimError();
      }
      await client.query('COMMIT');
      return createdAt;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async updateMessage(messageId: string, content: string, editedAt: number): Promise<void> {
    await this.execute('UPDATE haven.messages SET content = $1, edited_at = $2 WHERE id = $3', [content, editedAt, messageId]);
  }

  async deleteMessage(messageId: string): Promise<{ diskNames: string[] }> {
    const files = await this.query('SELECT disk_name FROM haven.attachments WHERE message_id = $1', [messageId]);
    await this.execute('DELETE FROM haven.messages WHERE id = $1', [messageId]);
    return { diskNames: files.map(f => f.disk_name) };
  }

  // Attachments
  async getAttachment(id: string): Promise<AttachmentRow | undefined> {
    const row = await this.queryOne('SELECT * FROM haven.attachments WHERE id = $1', [id]);
    if (!row) return undefined;
    return {
      id: row.id,
      channelId: row.channel_id ?? null,
      conversationId: row.conversation_id ?? null,
      uploaderId: row.uploader_id,
      messageId: row.message_id ?? null,
      name: row.name,
      mime: row.mime,
      size: Number(row.size),
      diskName: row.disk_name,
    };
  }

  async getMessageAttachments(messageId: string): Promise<Array<{ id: string; name: string; mime: string; size: number }>> {
    const rows = await this.query('SELECT id, name, mime, size FROM haven.attachments WHERE message_id = $1', [messageId]);
    return rows.map(r => ({
      id: r.id,
      name: r.name,
      mime: r.mime,
      size: Number(r.size),
    }));
  }

  async createAttachment(attachment: { id: string; channelId?: string | null; conversationId?: string | null; uploaderId: string; name: string; mime: string; size: number; diskName: string }): Promise<void> {
    await this.execute(
      `INSERT INTO haven.attachments(id, channel_id, conversation_id, uploader_id, message_id, name, mime, size, disk_name)
       VALUES($1, $2, $3, $4, NULL, $5, $6, $7, $8)`,
      [
        attachment.id,
        attachment.channelId ?? null,
        attachment.conversationId ?? null,
        attachment.uploaderId,
        attachment.name,
        attachment.mime,
        attachment.size,
        attachment.diskName,
      ]
    );
  }

  // Reactions
  async getMessageReactions(messageId: string): Promise<Array<{ emoji: string; userId: string }>> {
    const rows = await this.query('SELECT emoji, user_id FROM haven.reactions WHERE message_id = $1', [messageId]);
    return rows.map(r => ({
      emoji: r.emoji,
      userId: r.user_id,
    }));
  }

  async toggleReaction(messageId: string, userId: string, emoji: string): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Serialize the complete toggle, including the absent-row case. A row lock
      // alone cannot protect an insertion of a reaction that does not exist yet.
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [JSON.stringify(['haven.reaction', messageId, userId, emoji])]);
      const removed = await client.query('DELETE FROM haven.reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3 RETURNING 1', [messageId, userId, emoji]);
      if (!removed.rowCount) await client.query('INSERT INTO haven.reactions(message_id, user_id, emoji) VALUES($1, $2, $3)', [messageId, userId, emoji]);
      await client.query('COMMIT');
      return !removed.rowCount;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }

  // Friends & Blocks
  async getFriends(userId: string): Promise<string[]> {
    const rows = await this.query('SELECT friend_id FROM haven.friends WHERE user_id = $1', [userId]);
    return rows.map(r => r.friend_id);
  }

  async isFriend(userId: string, targetId: string): Promise<boolean> {
    const row = await this.queryOne('SELECT 1 FROM haven.friends WHERE user_id = $1 AND friend_id = $2', [userId, targetId]);
    return Boolean(row);
  }

  async getFriendRequests(userId: string): Promise<FriendRequestRow[]> {
    const rows = await this.query('SELECT * FROM haven.friend_requests WHERE from_id = $1 OR to_id = $1', [userId]);
    return rows.map(r => ({
      id: r.id,
      fromId: r.from_id,
      toId: r.to_id,
      createdAt: Number(r.created_at),
    }));
  }

  async getFriendRequest(id: string): Promise<FriendRequestRow | undefined> {
    const row = await this.queryOne('SELECT * FROM haven.friend_requests WHERE id = $1', [id]);
    if (!row) return undefined;
    return {
      id: row.id,
      fromId: row.from_id,
      toId: row.to_id,
      createdAt: Number(row.created_at),
    };
  }

  async findPendingFriendRequest(user1: string, user2: string): Promise<FriendRequestRow | undefined> {
    const row = await this.queryOne(
      'SELECT * FROM haven.friend_requests WHERE (from_id = $1 AND to_id = $2) OR (from_id = $2 AND to_id = $1)',
      [user1, user2]
    );
    if (!row) return undefined;
    return {
      id: row.id,
      fromId: row.from_id,
      toId: row.to_id,
      createdAt: Number(row.created_at),
    };
  }

  async createFriendRequest(id: string, fromId: string, toId: string, createdAt: number): Promise<void> {
    // UNIQUE(from_id, to_id) does not cover the reverse direction, so serialize on the unordered pair.
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`haven.friend_requests:${[fromId, toId].sort().join(':')}`]);
      const existing = await client.query(
        'SELECT from_id FROM haven.friend_requests WHERE (from_id = $1 AND to_id = $2) OR (from_id = $2 AND to_id = $1) LIMIT 1',
        [fromId, toId]
      );
      if (existing.rows[0]) throw new FriendRequestConflictError(existing.rows[0].from_id === toId);
      await client.query('INSERT INTO haven.friend_requests(id, from_id, to_id, created_at) VALUES($1, $2, $3, $4)', [id, fromId, toId, createdAt]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async acceptFriendRequest(id: string, userId: string): Promise<{ fromId: string; toId: string }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const res = await client.query('SELECT * FROM haven.friend_requests WHERE id = $1', [id]);
      const pending = res.rows[0];
      if (!pending || pending.to_id !== userId) throw new Error('Request permission denied');
      await client.query('INSERT INTO haven.friends(user_id, friend_id) VALUES($1, $2) ON CONFLICT DO NOTHING', [pending.from_id, pending.to_id]);
      await client.query('INSERT INTO haven.friends(user_id, friend_id) VALUES($1, $2) ON CONFLICT DO NOTHING', [pending.to_id, pending.from_id]);
      await client.query('DELETE FROM haven.friend_requests WHERE (from_id = $1 AND to_id = $2) OR (from_id = $2 AND to_id = $1)', [pending.from_id, pending.to_id]);
      await client.query('COMMIT');
      return { fromId: pending.from_id, toId: pending.to_id };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async deleteFriendRequest(id: string, userId: string): Promise<{ fromId: string; toId: string } | undefined> {
    const pending = await this.queryOne('SELECT * FROM haven.friend_requests WHERE id = $1', [id]);
    if (!pending || ![pending.from_id, pending.to_id].includes(userId)) return undefined;
    await this.execute('DELETE FROM haven.friend_requests WHERE id = $1', [id]);
    return { fromId: pending.from_id, toId: pending.to_id };
  }

  async removeFriend(userId: string, friendId: string): Promise<void> {
    await this.execute(
      'DELETE FROM haven.friends WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)',
      [userId, friendId]
    );
  }

  async getBlocked(userId: string): Promise<string[]> {
    const rows = await this.query('SELECT blocked_id FROM haven.blocks WHERE user_id = $1', [userId]);
    return rows.map(r => r.blocked_id);
  }

  async isBlockedPair(user1: string, user2: string): Promise<boolean> {
    const row = await this.queryOne(
      'SELECT 1 FROM haven.blocks WHERE (user_id = $1 AND blocked_id = $2) OR (user_id = $2 AND blocked_id = $1)',
      [user1, user2]
    );
    return Boolean(row);
  }

  async addBlock(userId: string, targetId: string, createdAt: number): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'INSERT INTO haven.blocks(user_id, blocked_id, created_at) VALUES($1, $2, $3) ON CONFLICT DO NOTHING',
        [userId, targetId, createdAt]
      );
      await client.query(
        'DELETE FROM haven.friends WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)',
        [userId, targetId]
      );
      await client.query(
        'DELETE FROM haven.friend_requests WHERE (from_id = $1 AND to_id = $2) OR (from_id = $2 AND to_id = $1)',
        [userId, targetId]
      );
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async removeBlock(userId: string, targetId: string): Promise<void> {
    await this.execute('DELETE FROM haven.blocks WHERE user_id = $1 AND blocked_id = $2', [userId, targetId]);
  }

  // Sounds
  async getServerSounds(serverId: string): Promise<SoundRow[]> {
    const rows = await this.query('SELECT * FROM haven.sounds WHERE server_id = $1', [serverId]);
    return rows.map(r => ({
      id: r.id,
      serverId: r.server_id,
      uploaderId: r.uploader_id,
      name: r.name,
      mime: r.mime,
      size: Number(r.size),
      diskName: r.disk_name,
    }));
  }

  async getSound(id: string): Promise<SoundRow | undefined> {
    const row = await this.queryOne('SELECT * FROM haven.sounds WHERE id = $1', [id]);
    if (!row) return undefined;
    return {
      id: row.id,
      serverId: row.server_id,
      uploaderId: row.uploader_id,
      name: row.name,
      mime: row.mime,
      size: Number(row.size),
      diskName: row.disk_name,
    };
  }

  async createSound(sound: { id: string; serverId: string; uploaderId: string; name: string; mime: string; size: number; diskName: string }): Promise<void> {
    await this.execute(
      'INSERT INTO haven.sounds(id, server_id, uploader_id, name, mime, size, disk_name) VALUES($1, $2, $3, $4, $5, $6, $7)',
      [sound.id, sound.serverId, sound.uploaderId, sound.name, sound.mime, sound.size, sound.diskName]
    );
  }

  async deleteSound(id: string): Promise<{ diskName: string }> {
    const row = await this.queryOne('SELECT disk_name FROM haven.sounds WHERE id = $1', [id]);
    if (!row) throw new Error('Sound not found');
    await this.execute('DELETE FROM haven.sounds WHERE id = $1', [id]);
    return { diskName: row.disk_name };
  }

  // Server Emojis
  async getUserServerEmojis(userId: string): Promise<ServerEmojiRow[]> {
    const rows = await this.query(
      `SELECT e.* FROM haven.server_emojis e
       JOIN haven.members m ON m.server_id = e.server_id
       WHERE m.user_id = $1
       ORDER BY e.name`,
      [userId]
    );
    return rows.map(r => ({
      id: r.id,
      serverId: r.server_id,
      name: r.name,
      animated: Boolean(r.animated),
      mime: r.mime,
      diskName: r.disk_name,
      staticDiskName: r.static_disk_name,
      uploaderId: r.uploader_id,
      createdAt: Number(r.created_at),
    }));
  }

  async getServerEmojis(serverId: string): Promise<ServerEmojiRow[]> {
    const rows = await this.query('SELECT * FROM haven.server_emojis WHERE server_id = $1 ORDER BY name', [serverId]);
    return rows.map(r => ({
      id: r.id,
      serverId: r.server_id,
      name: r.name,
      animated: Boolean(r.animated),
      mime: r.mime,
      diskName: r.disk_name,
      staticDiskName: r.static_disk_name,
      uploaderId: r.uploader_id,
      createdAt: Number(r.created_at),
    }));
  }

  async getServerEmoji(id: string): Promise<ServerEmojiRow | undefined> {
    const row = await this.queryOne('SELECT * FROM haven.server_emojis WHERE id = $1', [id]);
    if (!row) return undefined;
    return {
      id: row.id,
      serverId: row.server_id,
      name: row.name,
      animated: Boolean(row.animated),
      mime: row.mime,
      diskName: row.disk_name,
      staticDiskName: row.static_disk_name,
      uploaderId: row.uploader_id,
      createdAt: Number(row.created_at),
    };
  }

  async getServerEmojiByName(serverId: string, name: string): Promise<ServerEmojiRow | undefined> {
    const row = await this.queryOne('SELECT * FROM haven.server_emojis WHERE server_id = $1 AND LOWER(name) = LOWER($2)', [serverId, name]);
    if (!row) return undefined;
    return {
      id: row.id,
      serverId: row.server_id,
      name: row.name,
      animated: Boolean(row.animated),
      mime: row.mime,
      diskName: row.disk_name,
      staticDiskName: row.static_disk_name,
      uploaderId: row.uploader_id,
      createdAt: Number(row.created_at),
    };
  }

  async getServerEmojiCount(serverId: string): Promise<number> {
    const row = await this.queryOne('SELECT COUNT(*) AS count FROM haven.server_emojis WHERE server_id = $1', [serverId]);
    return Number(row?.count ?? 0);
  }

  async createServerEmoji(emoji: { id: string; serverId: string; name: string; animated: boolean; mime: string; diskName: string; staticDiskName: string; uploaderId: string; createdAt: number }): Promise<void> {
    await this.execute(
      `INSERT INTO haven.server_emojis(id, server_id, name, animated, mime, disk_name, static_disk_name, uploader_id, created_at)
       VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        emoji.id,
        emoji.serverId,
        emoji.name,
        emoji.animated,
        emoji.mime,
        emoji.diskName,
        emoji.staticDiskName,
        emoji.uploaderId,
        emoji.createdAt,
      ]
    );
  }

  async updateServerEmojiName(id: string, name: string): Promise<void> {
    await this.execute('UPDATE haven.server_emojis SET name = $1 WHERE id = $2', [name, id]);
  }

  async deleteServerEmoji(id: string): Promise<{ diskName: string; staticDiskName: string }> {
    const row = await this.queryOne('SELECT disk_name, static_disk_name FROM haven.server_emojis WHERE id = $1', [id]);
    if (!row) throw new Error('Emoji not found');
    await this.execute('DELETE FROM haven.server_emojis WHERE id = $1', [id]);
    return { diskName: row.disk_name, staticDiskName: row.static_disk_name };
  }

  // Server Icons
  async getServerIcon(serverId: string): Promise<ServerIconRow | undefined> {
    const row = await this.queryOne('SELECT * FROM haven.server_icons WHERE server_id = $1', [serverId]);
    if (!row) return undefined;
    return {
      serverId: row.server_id,
      mime: row.mime,
      diskName: row.disk_name,
    };
  }

  async upsertServerIcon(serverId: string, mime: string, diskName: string, iconUrl: string): Promise<{ previousDiskName?: string }> {
    const previous = await this.queryOne('SELECT disk_name FROM haven.server_icons WHERE server_id = $1', [serverId]);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO haven.server_icons(server_id, mime, disk_name)
         VALUES($1, $2, $3)
         ON CONFLICT (server_id) DO UPDATE SET mime = EXCLUDED.mime, disk_name = EXCLUDED.disk_name`,
        [serverId, mime, diskName]
      );
      await client.query('UPDATE haven.servers SET icon = $1 WHERE id = $2', [iconUrl, serverId]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    return { previousDiskName: previous?.disk_name };
  }

  async deleteServerIcon(serverId: string): Promise<{ diskName?: string }> {
    const previous = await this.queryOne('SELECT disk_name FROM haven.server_icons WHERE server_id = $1', [serverId]);
    if (previous) {
      await this.pool.query('DELETE FROM haven.server_icons WHERE server_id = $1', [serverId]);
      return { diskName: previous.disk_name };
    }
    return {};
  }
}
