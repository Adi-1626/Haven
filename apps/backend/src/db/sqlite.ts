import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { assertActiveInvite } from './invites.js';
import { AttachmentClaimError, FriendRequestConflictError } from './types.js';
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

export class SqliteAdapter implements DatabaseAdapter {
  public isPostgres = false;
  private db: Database.Database;

  constructor(filePath: string) {
    fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
    this.db = new Database(filePath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');

    this.db.exec(`
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

    if (!(this.db.prepare('PRAGMA table_info(servers)').all() as Row[]).some(column => column.name === 'description')) {
      this.db.exec("ALTER TABLE servers ADD COLUMN description TEXT NOT NULL DEFAULT ''");
    }
    const memberColumns = this.db.prepare('PRAGMA table_info(members)').all() as Row[];
    for (const column of ['serverMuted', 'serverDeafened']) {
      if (!memberColumns.some(found => found.name === column)) {
        this.db.exec(`ALTER TABLE members ADD COLUMN ${column} INTEGER NOT NULL DEFAULT 0`);
      }
    }
    const inviteColumns = this.db.prepare('PRAGMA table_info(invites)').all() as Row[];
    for (const column of ['expiresAt', 'revokedAt']) {
      if (!inviteColumns.some(found => found.name === column)) {
        this.db.exec(`ALTER TABLE invites ADD COLUMN ${column} INTEGER`);
      }
    }
    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS friend_request_pair BEFORE INSERT ON friendRequests
      WHEN EXISTS (SELECT 1 FROM friendRequests WHERE (fromId=NEW.fromId AND toId=NEW.toId) OR (fromId=NEW.toId AND toId=NEW.fromId))
      BEGIN SELECT RAISE(ABORT,'A friend request already exists'); END;
    `);
  }

  public getRawDatabase(): Database.Database {
    return this.db;
  }

  async close(): Promise<void> {
    this.db.close();
  }

  async checkConnection(): Promise<void> {
    this.db.prepare('SELECT 1').get();
  }

  private all(sql: string, ...values: any[]): Row[] {
    return this.db.prepare(sql).all(...values) as Row[];
  }

  private one(sql: string, ...values: any[]): Row | undefined {
    return this.db.prepare(sql).get(...values) as Row | undefined;
  }

  private run(sql: string, ...values: any[]): Database.RunResult {
    return this.db.prepare(sql).run(...values);
  }

  // Users
  async getUser(userId: string): Promise<UserRow | undefined> {
    const row = this.one('SELECT * FROM users WHERE id=?', userId);
    if (!row) return undefined;
    return {
      id: row.id,
      username: row.username,
      displayName: row.displayName,
      password: row.password,
      bio: row.bio,
      avatar: row.avatar,
      status: row.status,
      settings: row.settings,
      createdAt: row.createdAt,
    };
  }

  async getUsers(userIds: string[]): Promise<UserRow[]> {
    if (!userIds.length) return [];
    return this.all(`SELECT * FROM users WHERE id IN (SELECT value FROM json_each(?))`, JSON.stringify(userIds)).map(row => ({
      id: row.id,
      username: row.username,
      displayName: row.displayName,
      password: row.password,
      bio: row.bio,
      avatar: row.avatar,
      status: row.status,
      settings: row.settings,
      createdAt: row.createdAt,
    }));
  }

  async getUserByUsername(username: string): Promise<UserRow | undefined> {
    const row = this.one('SELECT * FROM users WHERE username=?', username);
    if (!row) return undefined;
    return {
      id: row.id,
      username: row.username,
      displayName: row.displayName,
      password: row.password,
      bio: row.bio,
      avatar: row.avatar,
      status: row.status,
      settings: row.settings,
      createdAt: row.createdAt,
    };
  }

  async createUser(user: { id: string; username: string; displayName: string; password?: string; settings?: string; createdAt: number }): Promise<void> {
    this.run(
      'INSERT INTO users(id,username,displayName,password,settings,createdAt) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING',
      user.id,
      user.username,
      user.displayName,
      user.password ?? '',
      user.settings ?? '{}',
      user.createdAt
    );
  }

  async setUsername(userId: string, username: string): Promise<boolean> {
    try {
      this.run('UPDATE users SET username=? WHERE id=?', username, userId);
      return true;
    } catch (error) {
      if (error instanceof Error && /UNIQUE constraint failed/i.test(error.message)) return false;
      throw error;
    }
  }

  async completeUserProfile(userId: string, username: string, displayName: string): Promise<'completed' | 'unavailable' | 'already-complete'> {
    try {
      const result = this.run(`UPDATE users SET username=?, displayName=?, settings=json_set(settings, '$.profileCompleted', json('true'))
        WHERE id=? AND json_type(settings, '$.profileCompleted')='false'`, username, displayName, userId);
      return result.changes ? 'completed' : 'already-complete';
    } catch (error) {
      if (error instanceof Error && /UNIQUE constraint failed/i.test(error.message)) return 'unavailable';
      throw error;
    }
  }

  async updateUser(userId: string, patch: { displayName?: string; bio?: string; avatar?: string; status?: string; settings?: string }): Promise<void> {
    // Keep PostgreSQL's shallow JSONB merge semantics (including JSON null).
    // No await between this read and write: SQLite executes both synchronously.
    const current = this.one('SELECT settings FROM users WHERE id=?', userId);
    if (!current) return;
    const settings = patch.settings === undefined ? null : JSON.stringify({ ...JSON.parse(current.settings), ...JSON.parse(patch.settings) });
    this.run(
      'UPDATE users SET displayName=COALESCE(?,displayName),bio=COALESCE(?,bio),avatar=COALESCE(?,avatar),status=COALESCE(?,status),settings=COALESCE(?,settings) WHERE id=?',
      patch.displayName ?? null,
      patch.bio ?? null,
      patch.avatar ?? null,
      patch.status ?? null,
      settings,
      userId
    );
  }

  async getVisibleUsers(userId: string): Promise<string[]> {
    const serverUserIds = this.all('SELECT DISTINCT b.userId FROM members a JOIN members b ON a.serverId=b.serverId WHERE a.userId=?', userId).map(r => r.userId as string);
    const friendIds = this.all('SELECT friendId FROM friends WHERE userId=?', userId).map(r => r.friendId as string);
    const reqIds = this.all('SELECT fromId,toId FROM friendRequests WHERE fromId=? OR toId=?', userId, userId).flatMap(r => [r.fromId as string, r.toId as string]);
    const convUserIds = this.all('SELECT DISTINCT b.userId FROM conversationMembers a JOIN conversationMembers b ON a.conversationId=b.conversationId WHERE a.userId=?', userId).map(r => r.userId as string);
    const blockedIds = this.all('SELECT blockedId FROM blocks WHERE userId=?', userId).map(r => r.blockedId as string);

    return [...new Set([userId, ...serverUserIds, ...friendIds, ...reqIds, ...convUserIds, ...blockedIds])];
  }

  // Sessions
  async createSession(tokenHash: string, userId: string, expiresAt: number): Promise<void> {
    this.run('INSERT INTO sessions VALUES(?,?,?)', tokenHash, userId, expiresAt);
  }

  async getSessionUserId(tokenHash: string, now: number): Promise<string | undefined> {
    const row = this.one('SELECT userId FROM sessions WHERE token=? AND expiresAt>?', tokenHash, now);
    return row?.userId as string | undefined;
  }

  async hasValidSession(tokenHash: string, now: number): Promise<boolean> {
    return Boolean(this.one('SELECT 1 FROM sessions WHERE token=? AND expiresAt>?', tokenHash, now));
  }

  async deleteSession(tokenHash: string): Promise<void> {
    this.run('DELETE FROM sessions WHERE token=?', tokenHash);
  }

  async deleteExpiredSessions(now: number): Promise<void> {
    this.run('DELETE FROM sessions WHERE expiresAt < ?', now);
  }

  // Servers
  async getUserServers(userId: string): Promise<ServerRow[]> {
    const rows = this.all('SELECT s.*,m.role FROM servers s JOIN members m ON m.serverId=s.id WHERE m.userId=? ORDER BY s.createdAt', userId);
    return rows.map(r => ({
      id: r.id,
      name: r.name,
      icon: r.icon,
      description: r.description ?? '',
      ownerId: r.ownerId,
      createdAt: r.createdAt,
      role: r.role,
    }));
  }

  async getServer(serverId: string): Promise<ServerRow | undefined> {
    const row = this.one('SELECT * FROM servers WHERE id=?', serverId);
    if (!row) return undefined;
    return {
      id: row.id,
      name: row.name,
      icon: row.icon,
      description: row.description ?? '',
      ownerId: row.ownerId,
      createdAt: row.createdAt,
    };
  }

  async createServer(server: { id: string; name: string; icon: string; description: string; ownerId: string; createdAt: number }, initialChannelId: string, voiceChannelId: string): Promise<void> {
    this.db.transaction(() => {
      this.run('INSERT INTO servers(id,name,icon,ownerId,createdAt,description) VALUES(?,?,?,?,?,?)', server.id, server.name, server.icon, server.ownerId, server.createdAt, server.description);
      this.run('INSERT INTO members(serverId,userId,role) VALUES(?,?,?)', server.id, server.ownerId, 'owner');
      this.run('INSERT INTO channels VALUES(?,?,?,?,?,?)', initialChannelId, server.id, 'general', 'text', '', 0);
      this.run('INSERT INTO channels VALUES(?,?,?,?,?,?)', voiceChannelId, server.id, 'Lounge', 'voice', '', 1);
    })();
  }

  async updateServer(serverId: string, patch: { name?: string; icon?: string; description?: string }): Promise<void> {
    const current = await this.getServer(serverId);
    if (!current) return;
    this.run(
      'UPDATE servers SET name=?,icon=?,description=? WHERE id=?',
      patch.name ?? current.name,
      patch.icon ?? current.icon,
      patch.description ?? current.description,
      serverId
    );
  }

  async deleteServer(serverId: string): Promise<{ diskNames: string[] }> {
    const files = [
      ...this.all('SELECT a.diskName FROM attachments a JOIN channels c ON c.id=a.channelId WHERE c.serverId=?', serverId),
      ...this.all('SELECT diskName FROM sounds WHERE serverId=?', serverId),
      ...this.all('SELECT diskName FROM serverIcons WHERE serverId=?', serverId),
      ...this.all('SELECT diskName FROM serverEmojis WHERE serverId=? UNION SELECT staticDiskName AS diskName FROM serverEmojis WHERE serverId=?', serverId, serverId),
    ].map(f => f.diskName as string);

    this.run('DELETE FROM servers WHERE id=?', serverId);
    return { diskNames: files };
  }

  // Members
  async getMember(serverId: string, userId: string): Promise<MemberRow | undefined> {
    const row = this.one('SELECT * FROM members WHERE serverId=? AND userId=?', serverId, userId);
    if (!row) return undefined;
    return {
      serverId: row.serverId,
      userId: row.userId,
      role: row.role,
      serverMuted: Boolean(row.serverMuted),
      serverDeafened: Boolean(row.serverDeafened),
    };
  }

  async getServerMembers(serverId: string): Promise<MemberRow[]> {
    const rows = this.all('SELECT userId,role,serverMuted,serverDeafened FROM members WHERE serverId=?', serverId);
    return rows.map(r => ({
      serverId,
      userId: r.userId,
      role: r.role,
      serverMuted: Boolean(r.serverMuted),
      serverDeafened: Boolean(r.serverDeafened),
    }));
  }

  async getServerAudience(serverId: string): Promise<string[]> {
    return this.all('SELECT userId FROM members WHERE serverId=?', serverId).map(r => r.userId as string);
  }

  async addMember(serverId: string, userId: string, role = 'member'): Promise<void> {
    this.run("INSERT OR IGNORE INTO members(serverId,userId,role) VALUES(?,?,?)", serverId, userId, role);
  }

  async updateMemberRole(serverId: string, userId: string, role: 'admin' | 'member'): Promise<void> {
    this.run('UPDATE members SET role=? WHERE serverId=? AND userId=?', role, serverId, userId);
  }

  async updateMemberVoice(serverId: string, userId: string, patch: { serverMuted?: boolean; serverDeafened?: boolean }): Promise<void> {
    if (patch.serverMuted !== undefined) {
      this.run('UPDATE members SET serverMuted=? WHERE serverId=? AND userId=?', patch.serverMuted ? 1 : 0, serverId, userId);
    }
    if (patch.serverDeafened !== undefined) {
      this.run('UPDATE members SET serverDeafened=? WHERE serverId=? AND userId=?', patch.serverDeafened ? 1 : 0, serverId, userId);
    }
  }

  async removeMember(serverId: string, userId: string): Promise<void> {
    this.run('DELETE FROM members WHERE serverId=? AND userId=?', serverId, userId);
  }

  // Channels
  async getUserChannels(userId: string): Promise<ChannelRow[]> {
    const rows = this.all('SELECT c.* FROM channels c JOIN members m ON m.serverId=c.serverId WHERE m.userId=? ORDER BY c.position,c.rowid', userId);
    return rows.map(r => ({
      id: r.id,
      serverId: r.serverId,
      name: r.name,
      type: r.type,
      topic: r.topic ?? '',
      position: r.position ?? 0,
    }));
  }

  async getChannel(channelId: string): Promise<ChannelRow | undefined> {
    const row = this.one('SELECT * FROM channels WHERE id=?', channelId);
    if (!row) return undefined;
    return {
      id: row.id,
      serverId: row.serverId,
      name: row.name,
      type: row.type,
      topic: row.topic ?? '',
      position: row.position ?? 0,
    };
  }

  async getNextChannelPosition(serverId: string): Promise<number> {
    const row = this.one('SELECT COALESCE(MAX(position),0)+1 AS position FROM channels WHERE serverId=?', serverId);
    return row?.position ?? 0;
  }

  async createChannel(channel: { id: string; serverId: string; name: string; type: 'text' | 'voice'; topic: string; position: number }): Promise<void> {
    this.run('INSERT INTO channels VALUES(?,?,?,?,?,?)', channel.id, channel.serverId, channel.name, channel.type, channel.topic, channel.position);
  }

  async updateChannel(channelId: string, patch: { name?: string; topic?: string; position?: number }): Promise<void> {
    this.run(
      'UPDATE channels SET name=COALESCE(?,name),topic=COALESCE(?,topic),position=COALESCE(?,position) WHERE id=?',
      patch.name ?? null,
      patch.topic ?? null,
      patch.position ?? null,
      channelId
    );
  }

  async deleteChannel(channelId: string): Promise<{ diskNames: string[] }> {
    const files = this.all('SELECT diskName FROM attachments WHERE channelId=?', channelId).map(r => r.diskName as string);
    this.run('DELETE FROM channels WHERE id=?', channelId);
    return { diskNames: files };
  }

  // Invites
  async getInvite(code: string): Promise<InviteRow | undefined> {
    const row = this.one('SELECT * FROM invites WHERE code=?', code);
    if (!row) return undefined;
    return {
      code: row.code,
      serverId: row.serverId,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt ?? null,
      revokedAt: row.revokedAt ?? null,
    };
  }

  async getServerInvites(serverId: string): Promise<InviteRow[]> {
    const rows = this.all('SELECT code,createdAt,expiresAt,revokedAt FROM invites WHERE serverId=? ORDER BY createdAt DESC', serverId);
    return rows.map(r => ({
      code: r.code,
      serverId,
      createdAt: r.createdAt,
      expiresAt: r.expiresAt ?? null,
      revokedAt: r.revokedAt ?? null,
    }));
  }

  async createInvite(invite: { code: string; serverId: string; createdAt: number; expiresAt: number | null }): Promise<void> {
    this.run('INSERT INTO invites(code,serverId,createdAt,expiresAt,revokedAt) VALUES(?,?,?,?,NULL)', invite.code, invite.serverId, invite.createdAt, invite.expiresAt);
  }

  async revokeInvite(code: string, now: number): Promise<void> {
    this.run('UPDATE invites SET revokedAt=COALESCE(revokedAt,?) WHERE code=?', now, code);
  }

  async joinInvite(code: string, userId: string): Promise<InviteRow> {
    return this.db.transaction(() => {
      const row = this.one('SELECT * FROM invites WHERE code=?', code);
      const invitation: InviteRow | undefined = row && {
        code: row.code, serverId: row.serverId, createdAt: row.createdAt,
        expiresAt: row.expiresAt ?? null, revokedAt: row.revokedAt ?? null,
      };
      assertActiveInvite(invitation);
      this.run("INSERT OR IGNORE INTO members(serverId,userId,role) VALUES(?,?,'member')", invitation.serverId, userId);
      return invitation;
    }).immediate();
  }

  // Conversations
  async getUserConversations(userId: string): Promise<ConversationRow[]> {
    const rows = this.all(
      `SELECT c.id, c.name, c.createdAt, (SELECT json_group_array(cm.userId) FROM conversationMembers cm WHERE cm.conversationId=c.id) AS memberIds
       FROM conversations c JOIN conversationMembers m ON m.conversationId=c.id WHERE m.userId=? ORDER BY c.createdAt DESC`,
      userId
    );
    return rows.map(row => ({ id: row.id, name: row.name ?? '', createdAt: row.createdAt, memberIds: JSON.parse(row.memberIds) }));
  }

  async getConversation(conversationId: string): Promise<ConversationRow | undefined> {
    const row = this.one('SELECT * FROM conversations WHERE id=?', conversationId);
    if (!row) return undefined;
    const memberIds = await this.getConversationMemberIds(conversationId);
    return {
      id: row.id,
      name: row.name ?? '',
      createdAt: row.createdAt,
      memberIds,
    };
  }

  async getConversationMemberIds(conversationId: string): Promise<string[]> {
    return this.all('SELECT userId FROM conversationMembers WHERE conversationId=?', conversationId).map(r => r.userId as string);
  }

  async isConversationMember(conversationId: string, userId: string): Promise<boolean> {
    return Boolean(this.one('SELECT 1 FROM conversationMembers WHERE conversationId=? AND userId=?', conversationId, userId));
  }

  async findDirectConversation(user1: string, user2: string): Promise<string | undefined> {
    const row = this.one(
      'SELECT a.conversationId AS id FROM conversationMembers a JOIN conversationMembers b ON a.conversationId=b.conversationId WHERE a.userId=? AND b.userId=? AND (SELECT count(*) FROM conversationMembers c WHERE c.conversationId=a.conversationId)=2',
      user1,
      user2
    );
    return row?.id as string | undefined;
  }

  async createConversation(conversationId: string, name: string, memberIds: string[], createdAt: number): Promise<void> {
    this.db.transaction(() => {
      this.run('INSERT INTO conversations VALUES(?,?,?)', conversationId, name, createdAt);
      for (const uid of memberIds) {
        this.run('INSERT INTO conversationMembers VALUES(?,?)', conversationId, uid);
      }
    })();
  }

  async updateConversation(conversationId: string, name: string): Promise<void> {
    this.run('UPDATE conversations SET name=? WHERE id=?', name, conversationId);
  }

  async removeConversationMember(conversationId: string, userId: string): Promise<void> {
    this.run('DELETE FROM conversationMembers WHERE conversationId=? AND userId=?', conversationId, userId);
  }

  // Messages
  async getMessages(target: { channelId?: string; conversationId?: string }, before: number, query: string, limit: number, beforeId?: string): Promise<string[]> {
    const field = target.channelId ? 'channelId' : 'conversationId';
    const value = target.channelId ?? target.conversationId;
    // Ties on createdAt are ordered by rowid; the cursor continues from the boundary message's rowid.
    const cursor = beforeId === undefined
      ? 'createdAt<?'
      : '(createdAt<? OR (createdAt=? AND rowid<COALESCE((SELECT rowid FROM messages WHERE id=?),-1)))';
    const rows = this.all(
      `SELECT id FROM messages WHERE ${field}=? AND ${cursor} AND instr(lower(content),lower(?))>0 ORDER BY createdAt DESC,rowid DESC LIMIT ?`,
      value,
      ...(beforeId === undefined ? [before] : [before, before, beforeId]),
      query,
      limit
    );
    return rows.map(r => r.id as string);
  }

  private mapMessage(row: Row): MessageRow {
    return {
      id: row.id,
      channelId: row.channelId ?? null,
      conversationId: row.conversationId ?? null,
      authorId: row.authorId,
      content: row.content,
      replyTo: row.replyTo ?? null,
      createdAt: row.createdAt,
      editedAt: row.editedAt ?? null,
    };
  }

  async getMessage(messageId: string): Promise<MessageRow | undefined> {
    const row = this.one('SELECT * FROM messages WHERE id=?', messageId);
    return row && this.mapMessage(row);
  }

  async getMessagesByIds(messageIds: string[]): Promise<MessageRow[]> {
    if (!messageIds.length) return [];
    return this.all('SELECT * FROM messages WHERE id IN (SELECT value FROM json_each(?))', JSON.stringify(messageIds)).map(row => this.mapMessage(row));
  }

  async getAttachmentsForMessages(messageIds: string[]): Promise<MessageAttachmentRow[]> {
    if (!messageIds.length) return [];
    return this.all('SELECT messageId,id,name,mime,size FROM attachments WHERE messageId IN (SELECT value FROM json_each(?)) ORDER BY rowid', JSON.stringify(messageIds))
      .map(r => ({ messageId: r.messageId, id: r.id, name: r.name, mime: r.mime, size: r.size }));
  }

  async getReactionsForMessages(messageIds: string[]): Promise<MessageReactionRow[]> {
    if (!messageIds.length) return [];
    return this.all('SELECT messageId,emoji,userId FROM reactions WHERE messageId IN (SELECT value FROM json_each(?)) ORDER BY rowid', JSON.stringify(messageIds))
      .map(r => ({ messageId: r.messageId, emoji: r.emoji, userId: r.userId }));
  }

  async createMessage(message: { id: string; channelId?: string | null; conversationId?: string | null; authorId: string; content: string; replyTo?: string | null; attachmentIds: string[] }): Promise<number> {
    return this.db.transaction(() => {
      const createdAt = Math.max(Date.now(), this.one('SELECT COALESCE(MAX(createdAt),0)+1 AS timestamp FROM messages')!.timestamp);
      this.run(
        'INSERT INTO messages VALUES(?,?,?,?,?,?,?,NULL)',
        message.id,
        message.channelId ?? null,
        message.conversationId ?? null,
        message.authorId,
        message.content,
        message.replyTo ?? null,
        createdAt
      );
      for (const attachmentId of new Set(message.attachmentIds)) {
        const claimed = this.run(
          'UPDATE attachments SET messageId=? WHERE id=? AND messageId IS NULL AND uploaderId=? AND channelId IS ? AND conversationId IS ?',
          message.id, attachmentId, message.authorId, message.channelId ?? null, message.conversationId ?? null
        );
        if (claimed.changes !== 1) throw new AttachmentClaimError();
      }
      return createdAt;
    })();
  }

  async updateMessage(messageId: string, content: string, editedAt: number): Promise<void> {
    this.run('UPDATE messages SET content=?,editedAt=? WHERE id=?', content, editedAt, messageId);
  }

  async deleteMessage(messageId: string): Promise<{ diskNames: string[] }> {
    const files = this.all('SELECT diskName FROM attachments WHERE messageId=?', messageId).map(r => r.diskName as string);
    this.run('DELETE FROM messages WHERE id=?', messageId);
    return { diskNames: files };
  }

  // Attachments
  async getAttachment(id: string): Promise<AttachmentRow | undefined> {
    const row = this.one('SELECT * FROM attachments WHERE id=?', id);
    if (!row) return undefined;
    return {
      id: row.id,
      channelId: row.channelId ?? null,
      conversationId: row.conversationId ?? null,
      uploaderId: row.uploaderId,
      messageId: row.messageId ?? null,
      name: row.name,
      mime: row.mime,
      size: row.size,
      diskName: row.diskName,
    };
  }

  async getMessageAttachments(messageId: string): Promise<Array<{ id: string; name: string; mime: string; size: number }>> {
    return this.all('SELECT id,name,mime,size FROM attachments WHERE messageId=?', messageId).map(r => ({
      id: r.id,
      name: r.name,
      mime: r.mime,
      size: r.size,
    }));
  }

  async createAttachment(attachment: { id: string; channelId?: string | null; conversationId?: string | null; uploaderId: string; name: string; mime: string; size: number; diskName: string }): Promise<void> {
    this.run(
      'INSERT INTO attachments VALUES(?,?,?,?,NULL,?,?,?,?)',
      attachment.id,
      attachment.channelId ?? null,
      attachment.conversationId ?? null,
      attachment.uploaderId,
      attachment.name,
      attachment.mime,
      attachment.size,
      attachment.diskName
    );
  }

  // Reactions
  async getMessageReactions(messageId: string): Promise<Array<{ emoji: string; userId: string }>> {
    return this.all('SELECT emoji,userId FROM reactions WHERE messageId=?', messageId).map(r => ({
      emoji: r.emoji,
      userId: r.userId,
    }));
  }

  async toggleReaction(messageId: string, userId: string, emoji: string): Promise<boolean> {
    const exists = this.one('SELECT 1 FROM reactions WHERE messageId=? AND userId=? AND emoji=?', messageId, userId, emoji);
    if (exists) {
      this.run('DELETE FROM reactions WHERE messageId=? AND userId=? AND emoji=?', messageId, userId, emoji);
      return false; // Removed
    } else {
      this.run('INSERT INTO reactions VALUES(?,?,?)', messageId, userId, emoji);
      return true; // Added
    }
  }

  // Friends & Blocks
  async getFriends(userId: string): Promise<string[]> {
    return this.all('SELECT friendId FROM friends WHERE userId=?', userId).map(r => r.friendId as string);
  }

  async isFriend(userId: string, targetId: string): Promise<boolean> {
    return Boolean(this.one('SELECT 1 FROM friends WHERE userId=? AND friendId=?', userId, targetId));
  }

  async getFriendRequests(userId: string): Promise<FriendRequestRow[]> {
    return this.all('SELECT * FROM friendRequests WHERE fromId=? OR toId=?', userId, userId).map(r => ({
      id: r.id,
      fromId: r.fromId,
      toId: r.toId,
      createdAt: r.createdAt,
    }));
  }

  async getFriendRequest(id: string): Promise<FriendRequestRow | undefined> {
    const row = this.one('SELECT * FROM friendRequests WHERE id=?', id);
    if (!row) return undefined;
    return {
      id: row.id,
      fromId: row.fromId,
      toId: row.toId,
      createdAt: row.createdAt,
    };
  }

  async findPendingFriendRequest(user1: string, user2: string): Promise<FriendRequestRow | undefined> {
    const row = this.one('SELECT * FROM friendRequests WHERE (fromId=? AND toId=?) OR (fromId=? AND toId=?)', user1, user2, user2, user1);
    if (!row) return undefined;
    return {
      id: row.id,
      fromId: row.fromId,
      toId: row.toId,
      createdAt: row.createdAt,
    };
  }

  async createFriendRequest(id: string, fromId: string, toId: string, createdAt: number): Promise<void> {
    const existing = this.one('SELECT fromId FROM friendRequests WHERE (fromId=? AND toId=?) OR (fromId=? AND toId=?)', fromId, toId, toId, fromId);
    if (existing) throw new FriendRequestConflictError(existing.fromId === toId);
    this.run('INSERT INTO friendRequests VALUES(?,?,?,?)', id, fromId, toId, createdAt);
  }

  async acceptFriendRequest(id: string, userId: string): Promise<{ fromId: string; toId: string }> {
    return this.db.transaction(() => {
      const pending = this.one('SELECT * FROM friendRequests WHERE id=?', id);
      if (!pending || pending.toId !== userId) throw new Error('Request permission denied');
      this.run('INSERT OR IGNORE INTO friends VALUES(?,?)', pending.fromId, pending.toId);
      this.run('INSERT OR IGNORE INTO friends VALUES(?,?)', pending.toId, pending.fromId);
      this.run('DELETE FROM friendRequests WHERE (fromId=? AND toId=?) OR (fromId=? AND toId=?)', pending.fromId, pending.toId, pending.toId, pending.fromId);
      return { fromId: pending.fromId, toId: pending.toId };
    })();
  }

  async deleteFriendRequest(id: string, userId: string): Promise<{ fromId: string; toId: string } | undefined> {
    const pending = this.one('SELECT * FROM friendRequests WHERE id=?', id);
    if (!pending || ![pending.fromId, pending.toId].includes(userId)) return undefined;
    this.run('DELETE FROM friendRequests WHERE id=?', id);
    return { fromId: pending.fromId, toId: pending.toId };
  }

  async removeFriend(userId: string, friendId: string): Promise<void> {
    this.run('DELETE FROM friends WHERE (userId=? AND friendId=?) OR (userId=? AND friendId=?)', userId, friendId, friendId, userId);
  }

  async getBlocked(userId: string): Promise<string[]> {
    return this.all('SELECT blockedId FROM blocks WHERE userId=?', userId).map(r => r.blockedId as string);
  }

  async isBlockedPair(user1: string, user2: string): Promise<boolean> {
    return Boolean(this.one('SELECT 1 FROM blocks WHERE (userId=? AND blockedId=?) OR (userId=? AND blockedId=?)', user1, user2, user2, user1));
  }

  async addBlock(userId: string, targetId: string, createdAt: number): Promise<void> {
    this.db.transaction(() => {
      this.run('INSERT OR IGNORE INTO blocks VALUES(?,?,?)', userId, targetId, createdAt);
      this.run('DELETE FROM friends WHERE (userId=? AND friendId=?) OR (userId=? AND friendId=?)', userId, targetId, targetId, userId);
      this.run('DELETE FROM friendRequests WHERE (fromId=? AND toId=?) OR (fromId=? AND toId=?)', userId, targetId, targetId, userId);
    })();
  }

  async removeBlock(userId: string, targetId: string): Promise<void> {
    this.run('DELETE FROM blocks WHERE userId=? AND blockedId=?', userId, targetId);
  }

  // Sounds
  async getServerSounds(serverId: string): Promise<SoundRow[]> {
    return this.all('SELECT * FROM sounds WHERE serverId=?', serverId).map(r => ({
      id: r.id,
      serverId: r.serverId,
      uploaderId: r.uploaderId,
      name: r.name,
      mime: r.mime,
      size: r.size,
      diskName: r.diskName,
    }));
  }

  async getSound(id: string): Promise<SoundRow | undefined> {
    const row = this.one('SELECT * FROM sounds WHERE id=?', id);
    if (!row) return undefined;
    return {
      id: row.id,
      serverId: row.serverId,
      uploaderId: row.uploaderId,
      name: row.name,
      mime: row.mime,
      size: row.size,
      diskName: row.diskName,
    };
  }

  async createSound(sound: { id: string; serverId: string; uploaderId: string; name: string; mime: string; size: number; diskName: string }): Promise<void> {
    this.run('INSERT INTO sounds VALUES(?,?,?,?,?,?,?)', sound.id, sound.serverId, sound.uploaderId, sound.name, sound.mime, sound.size, sound.diskName);
  }

  async deleteSound(id: string): Promise<{ diskName: string }> {
    const row = this.one('SELECT diskName FROM sounds WHERE id=?', id);
    if (!row) throw new Error('Sound not found');
    this.run('DELETE FROM sounds WHERE id=?', id);
    return { diskName: row.diskName };
  }

  // Server Emojis
  async getUserServerEmojis(userId: string): Promise<ServerEmojiRow[]> {
    const rows = this.all('SELECT e.* FROM serverEmojis e JOIN members m ON m.serverId=e.serverId WHERE m.userId=? ORDER BY e.name', userId);
    return rows.map(r => ({
      id: r.id,
      serverId: r.serverId,
      name: r.name,
      animated: Boolean(r.animated),
      mime: r.mime,
      diskName: r.diskName,
      staticDiskName: r.staticDiskName,
      uploaderId: r.uploaderId,
      createdAt: r.createdAt,
    }));
  }

  async getServerEmojis(serverId: string): Promise<ServerEmojiRow[]> {
    const rows = this.all('SELECT * FROM serverEmojis WHERE serverId=? ORDER BY name', serverId);
    return rows.map(r => ({
      id: r.id,
      serverId: r.serverId,
      name: r.name,
      animated: Boolean(r.animated),
      mime: r.mime,
      diskName: r.diskName,
      staticDiskName: r.staticDiskName,
      uploaderId: r.uploaderId,
      createdAt: r.createdAt,
    }));
  }

  async getServerEmoji(id: string): Promise<ServerEmojiRow | undefined> {
    const row = this.one('SELECT * FROM serverEmojis WHERE id=?', id);
    if (!row) return undefined;
    return {
      id: row.id,
      serverId: row.serverId,
      name: row.name,
      animated: Boolean(row.animated),
      mime: row.mime,
      diskName: row.diskName,
      staticDiskName: row.staticDiskName,
      uploaderId: row.uploaderId,
      createdAt: row.createdAt,
    };
  }

  async getServerEmojiByName(serverId: string, name: string): Promise<ServerEmojiRow | undefined> {
    const row = this.one('SELECT * FROM serverEmojis WHERE serverId=? AND name=?', serverId, name);
    if (!row) return undefined;
    return {
      id: row.id,
      serverId: row.serverId,
      name: row.name,
      animated: Boolean(row.animated),
      mime: row.mime,
      diskName: row.diskName,
      staticDiskName: row.staticDiskName,
      uploaderId: row.uploaderId,
      createdAt: row.createdAt,
    };
  }

  async getServerEmojiCount(serverId: string): Promise<number> {
    const row = this.one('SELECT COUNT(*) AS count FROM serverEmojis WHERE serverId=?', serverId);
    return row?.count ?? 0;
  }

  async createServerEmoji(emoji: { id: string; serverId: string; name: string; animated: boolean; mime: string; diskName: string; staticDiskName: string; uploaderId: string; createdAt: number }): Promise<void> {
    this.run(
      'INSERT INTO serverEmojis VALUES(?,?,?,?,?,?,?,?,?)',
      emoji.id,
      emoji.serverId,
      emoji.name,
      emoji.animated ? 1 : 0,
      emoji.mime,
      emoji.diskName,
      emoji.staticDiskName,
      emoji.uploaderId,
      emoji.createdAt
    );
  }

  async updateServerEmojiName(id: string, name: string): Promise<void> {
    this.run('UPDATE serverEmojis SET name=? WHERE id=?', name, id);
  }

  async deleteServerEmoji(id: string): Promise<{ diskName: string; staticDiskName: string }> {
    const row = this.one('SELECT diskName, staticDiskName FROM serverEmojis WHERE id=?', id);
    if (!row) throw new Error('Emoji not found');
    this.run('DELETE FROM serverEmojis WHERE id=?', id);
    return { diskName: row.diskName, staticDiskName: row.staticDiskName };
  }

  // Server Icons
  async getServerIcon(serverId: string): Promise<ServerIconRow | undefined> {
    const row = this.one('SELECT * FROM serverIcons WHERE serverId=?', serverId);
    if (!row) return undefined;
    return {
      serverId: row.serverId,
      mime: row.mime,
      diskName: row.diskName,
    };
  }

  async upsertServerIcon(serverId: string, mime: string, diskName: string, iconUrl: string): Promise<{ previousDiskName?: string }> {
    const previous = this.one('SELECT diskName FROM serverIcons WHERE serverId=?', serverId);
    this.db.transaction(() => {
      this.run('INSERT INTO serverIcons VALUES(?,?,?) ON CONFLICT(serverId) DO UPDATE SET mime=excluded.mime,diskName=excluded.diskName', serverId, mime, diskName);
      this.run('UPDATE servers SET icon=? WHERE id=?', iconUrl, serverId);
    })();
    return { previousDiskName: previous?.diskName };
  }

  async deleteServerIcon(serverId: string): Promise<{ diskName?: string }> {
    const previous = this.one('SELECT diskName FROM serverIcons WHERE serverId=?', serverId);
    if (previous) {
      this.run('DELETE FROM serverIcons WHERE serverId=?', serverId);
      return { diskName: previous.diskName as string };
    }
    return {};
  }
}
