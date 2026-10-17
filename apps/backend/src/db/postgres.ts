import pg from 'pg';
const { Pool } = pg;
import type {
  DatabaseAdapter,
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
    const config: pg.PoolConfig = typeof connectionStringOrConfig === 'string'
      ? { connectionString: connectionStringOrConfig }
      : connectionStringOrConfig;

    // Use SSL for remote/cloud Supabase connections
    if (typeof connectionStringOrConfig === 'string' && (connectionStringOrConfig.includes('supabase.co') || connectionStringOrConfig.includes('pooler.supabase.com'))) {
      config.ssl = { rejectUnauthorized: false };
    }

    this.pool = new Pool({
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      ...config,
    });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async checkConnection(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('SET search_path TO haven, public');
      await client.query('SELECT 1');
    } finally {
      client.release();
    }
  }

  private async query(sql: string, params: any[] = []): Promise<Row[]> {
    const client = await this.pool.connect();
    try {
      // Ensure search path includes haven
      await client.query('SET search_path TO haven, public');
      const res = await client.query(sql, params);
      return res.rows;
    } finally {
      client.release();
    }
  }

  private async queryOne(sql: string, params: any[] = []): Promise<Row | undefined> {
    const rows = await this.query(sql, params);
    return rows[0];
  }

  private async execute(sql: string, params: any[] = []): Promise<number> {
    const client = await this.pool.connect();
    try {
      await client.query('SET search_path TO haven, public');
      const res = await client.query(sql, params);
      return res.rowCount ?? 0;
    } finally {
      client.release();
    }
  }

  // Users
  async getUser(userId: string): Promise<UserRow | undefined> {
    const row = await this.queryOne('SELECT * FROM haven.users WHERE id = $1', [userId]);
    if (!row) return undefined;
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

  async getUserByUsername(username: string): Promise<UserRow | undefined> {
    const row = await this.queryOne('SELECT * FROM haven.users WHERE LOWER(username) = LOWER($1)', [username]);
    if (!row) return undefined;
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

  async createUser(user: { id: string; username: string; displayName: string; password?: string; createdAt: number }): Promise<void> {
    await this.execute(
      `INSERT INTO haven.users(id, username, display_name, password, bio, avatar, status, settings, created_at)
       VALUES($1, $2, $3, $4, '', '', 'online', '{}'::jsonb, $5)
       ON CONFLICT (id) DO UPDATE SET
         username = EXCLUDED.username,
         display_name = EXCLUDED.display_name`,
      [user.id, user.username, user.displayName, user.password ?? '', user.createdAt]
    );
  }

  async updateUser(userId: string, patch: { displayName?: string; bio?: string; avatar?: string; status?: string; settings?: string }): Promise<void> {
    const current = await this.getUser(userId);
    if (!current) return;
    const settingsJson = patch.settings ? JSON.parse(patch.settings) : JSON.parse(current.settings);
    await this.execute(
      `UPDATE haven.users SET
         display_name = $1,
         bio = $2,
         avatar = $3,
         status = $4,
         settings = $5::jsonb
       WHERE id = $6`,
      [
        patch.displayName ?? current.displayName,
        patch.bio ?? current.bio,
        patch.avatar ?? current.avatar,
        patch.status ?? current.status,
        JSON.stringify(settingsJson),
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
    const current = await this.getServer(serverId);
    if (!current) return;
    await this.execute(
      `UPDATE haven.servers SET
         name = $1,
         icon = $2,
         description = $3
       WHERE id = $4`,
      [
        patch.name ?? current.name,
        patch.icon ?? current.icon,
        patch.description ?? current.description,
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
    const current = await this.getChannel(channelId);
    if (!current) return;
    await this.execute(
      `UPDATE haven.channels SET
         name = $1,
         topic = $2,
         position = $3
       WHERE id = $4`,
      [
        patch.name ?? current.name,
        patch.topic ?? current.topic,
        patch.position ?? current.position,
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
      const res = await client.query('SELECT * FROM haven.invites WHERE code = $1', [code]);
      const row = res.rows[0];
      if (!row) throw new Error('Invite not found');
      await client.query(
        "INSERT INTO haven.members(server_id, user_id, role) VALUES($1, $2, 'member') ON CONFLICT DO NOTHING",
        [row.server_id, userId]
      );
      await client.query('COMMIT');
      return {
        code: row.code,
        serverId: row.server_id,
        createdAt: Number(row.created_at),
        expiresAt: row.expires_at ? Number(row.expires_at) : null,
        revokedAt: row.revoked_at ? Number(row.revoked_at) : null,
      };
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
      `SELECT c.id FROM haven.conversations c
       JOIN haven.conversation_members m ON m.conversation_id = c.id
       WHERE m.user_id = $1
       ORDER BY c.created_at DESC`,
      [userId]
    );
    const conversations: ConversationRow[] = [];
    for (const row of rows) {
      const conv = await this.getConversation(row.id);
      if (conv) conversations.push(conv);
    }
    return conversations;
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
  async getMessages(target: { channelId?: string; conversationId?: string }, before: number, query: string, limit: number): Promise<string[]> {
    const field = target.channelId ? 'channel_id' : 'conversation_id';
    const value = target.channelId ?? target.conversationId;
    const rows = await this.query(
      `SELECT id FROM haven.messages
       WHERE ${field} = $1 AND created_at < $2 AND LOWER(content) LIKE '%' || LOWER($3) || '%'
       ORDER BY created_at DESC, id DESC
       LIMIT $4`,
      [value, before, query, limit]
    );
    return rows.map(r => r.id);
  }

  async getMessage(messageId: string): Promise<MessageRow | undefined> {
    const row = await this.queryOne('SELECT * FROM haven.messages WHERE id = $1', [messageId]);
    if (!row) return undefined;
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

  async createMessage(message: { id: string; channelId?: string | null; conversationId?: string | null; authorId: string; content: string; replyTo?: string | null; attachmentIds: string[] }): Promise<number> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const maxRow = await client.query('SELECT COALESCE(MAX(created_at), 0) + 1 AS timestamp FROM haven.messages');
      const createdAt = Math.max(Date.now(), Number(maxRow.rows[0].timestamp));
      await client.query(
        `INSERT INTO haven.messages(id, channel_id, conversation_id, author_id, content, reply_to, created_at, edited_at)
         VALUES($1, $2, $3, $4, $5, $6, $7, NULL)`,
        [message.id, message.channelId ?? null, message.conversationId ?? null, message.authorId, message.content, message.replyTo ?? null, createdAt]
      );
      for (const attachmentId of message.attachmentIds) {
        await client.query('UPDATE haven.attachments SET message_id = $1 WHERE id = $2', [message.id, attachmentId]);
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
    const exists = await this.queryOne('SELECT 1 FROM haven.reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3', [messageId, userId, emoji]);
    if (exists) {
      await this.execute('DELETE FROM haven.reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3', [messageId, userId, emoji]);
      return false;
    } else {
      await this.execute('INSERT INTO haven.reactions(message_id, user_id, emoji) VALUES($1, $2, $3)', [messageId, userId, emoji]);
      return true;
    }
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
    await this.execute(
      'INSERT INTO haven.friend_requests(id, from_id, to_id, created_at) VALUES($1, $2, $3, $4)',
      [id, fromId, toId, createdAt]
    );
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
